"""Move stored images between Postgres and S3/R2, and check that none is missing.

Used by ``scripts/media_migrate.py`` and ``scripts/media_verify.py`` (see
docs/media-storage.md). Each object is moved on its own short transaction and
its bytes are checked against the sha256 recorded at upload, so a run can be
stopped and restarted at any point: rows already moved are skipped, a half-done
copy is simply written again under the same key.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import SessionLocal
from src.media.s3 import S3Error
from src.media.store import MediaStore, S3MediaStore, StorageUnavailable, store_named
from src.media.urls import object_key
from src.models.media import MediaBlob, MediaObject, MediaStatus

logger = structlog.get_logger()


@dataclass
class TransferReport:
    target: str
    dry_run: bool
    pending: int = 0
    moved: int = 0
    bytes_moved: int = 0
    failed: list[str] = field(default_factory=list)


@dataclass
class VerifyReport:
    checked: int = 0
    missing: list[str] = field(default_factory=list)
    corrupt: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing and not self.corrupt


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _to_move(target: str):
    return select(MediaObject.id).where(
        MediaObject.storage != target, MediaObject.status != MediaStatus.removed.value,
    )


async def _read_all(db: AsyncSession, store: MediaStore, obj: MediaObject) -> dict[str, bytes]:
    """Every variant's bytes, checked against the recorded digest."""
    public = obj.visibility == "public"
    out: dict[str, bytes] = {}
    for name, meta in obj.variants.items():
        data = await store.get(db, object_key(obj.key_prefix, name), public=public)
        if data is None:
            raise LookupError(f"{obj.public_id}:{name} missing in {store.name}")
        if _sha(data) != meta["sha256"]:
            raise ValueError(f"{obj.public_id}:{name} does not match its recorded sha256")
        out[name] = data
    return out


async def _move_one(object_id: int, target: MediaStore) -> int:
    """Copy one object to ``target`` and flip its row. Returns bytes moved (0 = skipped)."""
    async with SessionLocal() as db:
        obj = await db.scalar(select(MediaObject).where(MediaObject.id == object_id))
        if obj is None or obj.storage == target.name or obj.status == MediaStatus.removed.value:
            return 0
        source = store_named(obj.storage)
        public = obj.visibility == "public"
        prefix = obj.key_prefix
        payload = await _read_all(db, source, obj)
        keys = [object_key(prefix, name) for name in payload]
        await db.rollback()  # no transaction stays open across the upload below
        if target.name != "db":
            # Outside any transaction; rewriting the same key on a rerun is harmless.
            for name, data in payload.items():
                await target.put(db, object_key(prefix, name), data, public=public)

        locked = await db.scalar(select(MediaObject).where(MediaObject.id == object_id).with_for_update())
        if locked is None or locked.status == MediaStatus.removed.value:
            # Taken down or collected while we copied: the copy must not outlive
            # it (a public one would stay reachable on the CDN domain).
            await db.rollback()
            if target.name != "db":
                await target.delete(db, keys, public=public)
            return 0
        if locked.storage != source.name:
            await db.rollback()
            return 0
        if target.name == "db":
            existing = set(await db.scalars(select(MediaBlob.key).where(MediaBlob.key.in_(keys))))
            for name, data in payload.items():
                if object_key(prefix, name) not in existing:
                    await target.put(db, object_key(prefix, name), data, public=public)
        if source.name == "db":
            await source.delete(db, keys, public=public)  # same transaction as the flip
        locked.storage = target.name
        await db.commit()
    if source.name != "db":
        try:
            async with SessionLocal() as db:
                await source.delete(db, keys, public=public)
        except (S3Error, StorageUnavailable) as exc:
            logger.warning("media_transfer_source_left", object_id=object_id, error=type(exc).__name__)
    return sum(len(data) for data in payload.values())


async def migrate_objects(*, target: str, apply: bool, limit: int | None = None, batch_size: int = 100) -> TransferReport:
    """Move every non-removed object whose bytes are not in ``target`` ("db" or "s3")."""
    target_store = store_named(target)
    report = TransferReport(target=target, dry_run=not apply)
    async with SessionLocal() as db:
        report.pending = await db.scalar(select(func.count()).select_from(_to_move(target).subquery())) or 0
    if not apply:
        return report
    cursor = 0
    while limit is None or report.moved < limit:
        async with SessionLocal() as db:
            ids = list(await db.scalars(
                _to_move(target).where(MediaObject.id > cursor).order_by(MediaObject.id).limit(batch_size)
            ))
        if not ids:
            break
        for object_id in ids:
            cursor = object_id
            if limit is not None and report.moved >= limit:
                break
            try:
                moved = await _move_one(object_id, target_store)
            except (LookupError, ValueError, S3Error, StorageUnavailable) as exc:
                report.failed.append(f"{object_id}: {exc}")
                continue
            if moved:
                report.moved += 1
                report.bytes_moved += moved
    return report


async def verify_objects(*, check_hash: bool = False, batch_size: int = 200) -> VerifyReport:
    """Every variant of every non-removed object exists where its row says (and,
    with ``check_hash``, still has the bytes recorded at upload)."""
    report = VerifyReport()
    cursor = 0
    while True:
        async with SessionLocal() as db:
            rows = list(await db.scalars(
                select(MediaObject)
                .where(MediaObject.id > cursor, MediaObject.status != MediaStatus.removed.value)
                .order_by(MediaObject.id)
                .limit(batch_size)
            ))
            if not rows:
                break
            for obj in rows:
                cursor = obj.id
                report.checked += 1
                public = obj.visibility == "public"
                try:
                    store = store_named(obj.storage)
                except StorageUnavailable:
                    report.missing.append(f"{obj.public_id} ({obj.storage} not configured)")
                    continue
                for name, meta in obj.variants.items():
                    key = object_key(obj.key_prefix, name)
                    label = f"{obj.public_id}:{name} ({obj.storage}:{key})"
                    if check_hash:
                        data = await store.get(db, key, public=public)
                        if data is None:
                            report.missing.append(label)
                        elif _sha(data) != meta["sha256"]:
                            report.corrupt.append(label)
                    elif isinstance(store, S3MediaStore):
                        head = await store.client.head_object(store.bucket(public), key)
                        if head is None:
                            report.missing.append(label)
                        elif head["size"] != meta["bytes"]:
                            report.corrupt.append(label)
                    else:
                        size = await db.scalar(select(func.length(MediaBlob.data)).where(MediaBlob.key == key))
                        if size is None:
                            report.missing.append(label)
                        elif size != meta["bytes"]:
                            report.corrupt.append(label)
    return report
