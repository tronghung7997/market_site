"""Where image bytes live. Two production adapters behind one port:

- ``DbMediaStore``: rows in ``media_blobs`` (the default until devops brings
  up object storage). Writes join the caller's transaction, so an upload's
  metadata row and its bytes commit together.
- ``S3MediaStore``: any S3-compatible bucket pair (R2, MinIO, S3, B2). Writes
  happen outside the database transaction; see ``media.service`` for ordering.

Every object row names its store (``media_objects.storage``); reads follow the
row, so objects stay readable while ``scripts/media_migrate.py`` moves them.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Protocol

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.media.s3 import S3Client
from src.models.media import MediaBlob

CONTENT_TYPE = "image/webp"
# Keys are immutable (an edit uploads a new object), so caches may keep them.
PUBLIC_CACHE_CONTROL = "public, max-age=31536000, immutable"
# Private images served by the app: the browser may keep them but must ask
# again every time (ETag → 304), so each view re-checks who is signed in.
PRIVATE_CACHE_CONTROL = "private, no-cache"
# Private objects in S3 are only reachable through a short-lived signed URL,
# so the bytes behind one may be cached for the life of that URL.
PRIVATE_OBJECT_CACHE_CONTROL = "private, max-age=3600"


class StorageUnavailable(RuntimeError):
    """An object lives in a store this process is not configured for."""


class MediaStore(Protocol):
    name: str

    async def put(self, db: AsyncSession, key: str, data: bytes, *, public: bool) -> None: ...

    async def get(self, db: AsyncSession, key: str, *, public: bool) -> bytes | None: ...

    async def delete(self, db: AsyncSession, keys: list[str], *, public: bool) -> None: ...


class DbMediaStore:
    name = "db"

    async def put(self, db: AsyncSession, key: str, data: bytes, *, public: bool) -> None:  # noqa: ARG002
        db.add(MediaBlob(key=key, data=data))

    async def get(self, db: AsyncSession, key: str, *, public: bool) -> bytes | None:  # noqa: ARG002
        return await db.scalar(select(MediaBlob.data).where(MediaBlob.key == key))

    async def delete(self, db: AsyncSession, keys: list[str], *, public: bool) -> None:  # noqa: ARG002
        if keys:
            await db.execute(delete(MediaBlob).where(MediaBlob.key.in_(keys)))


class S3MediaStore:
    name = "s3"

    def __init__(self, client: S3Client, *, public_bucket: str, private_bucket: str):
        self.client = client
        self.public_bucket = public_bucket
        self.private_bucket = private_bucket

    def bucket(self, public: bool) -> str:
        return self.public_bucket if public else self.private_bucket

    async def put(self, db: AsyncSession, key: str, data: bytes, *, public: bool) -> None:  # noqa: ARG002
        await self.client.put_object(
            self.bucket(public), key, data, content_type=CONTENT_TYPE,
            cache_control=PUBLIC_CACHE_CONTROL if public else PRIVATE_OBJECT_CACHE_CONTROL,
        )

    async def get(self, db: AsyncSession, key: str, *, public: bool) -> bytes | None:  # noqa: ARG002
        return await self.client.get_object(self.bucket(public), key)

    async def delete(self, db: AsyncSession, keys: list[str], *, public: bool) -> None:  # noqa: ARG002
        for key in keys:
            await self.client.delete_object(self.bucket(public), key)


_DB_STORE = DbMediaStore()


@lru_cache(maxsize=1)
def _configured_s3() -> S3MediaStore | None:
    if not settings.media_s3_configured:
        return None
    client = S3Client(
        endpoint=settings.media_s3_endpoint,
        region=settings.media_s3_region,
        access_key_id=settings.media_s3_access_key_id,
        secret_access_key=settings.media_s3_secret_access_key,
        timeout=settings.media_s3_timeout_seconds,
    )
    return S3MediaStore(
        client, public_bucket=settings.media_s3_public_bucket, private_bucket=settings.media_s3_private_bucket,
    )


def store_named(name: str) -> MediaStore:
    if name == "db":
        return _DB_STORE
    if name == "s3":
        store = _configured_s3()
        if store is None:
            raise StorageUnavailable("media object is in S3 but MEDIA_S3_* is not configured")
        return store
    raise StorageUnavailable(f"unknown media store {name!r}")


def s3_store() -> S3MediaStore:
    store = store_named("s3")
    assert isinstance(store, S3MediaStore)
    return store


def upload_store() -> MediaStore:
    """The store new uploads go to (MEDIA_STORAGE)."""
    return store_named(settings.media_storage)


async def close() -> None:
    """Release pooled S3 connections (app shutdown)."""
    if _configured_s3.cache_info().currsize and (store := _configured_s3()) is not None:
        await store.client.aclose()
