"""Media application interface: upload, attach to a subject, read, collect garbage.

Lifecycle of an object: ``pending`` (uploaded, referenced by nothing) →
``attached`` (a feature saved it on a subject such as a product) → ``detached``
(the subject dropped it; bytes kept for a grace period) → deleted by
:func:`collect_garbage`. Admin takedown sets ``removed`` (phase 4).

Features never touch ``media_objects`` directly. They call
:func:`set_subject_media` inside their own transaction and keep the returned
snapshots on their row, so listings render images without a join.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import SessionLocal
from src.errors.codes import ErrorCode
from src.media.errors import MediaError
from src.media.processing import PRESETS, InvalidImage, process_image
from src.media.s3 import S3Error
from src.media.store import DbMediaStore, StorageUnavailable, store_named, upload_store
from src.media.urls import VARIANTS, key_prefix, new_public_id, object_key, public_url
from src.models.account import Account
from src.models.media import PUBLIC_PURPOSES, MediaObject, MediaPurpose, MediaStatus

logger = structlog.get_logger()

# Roles allowed to upload for a purpose (None = any signed-in account).
UPLOAD_ROLES: dict[MediaPurpose, frozenset[str] | None] = {
    MediaPurpose.product_image: frozenset({"seller", "admin"}),
    MediaPurpose.category_image: frozenset({"admin"}),
    MediaPurpose.seller_logo: frozenset({"seller"}),
    MediaPurpose.seller_banner: frozenset({"seller"}),
    MediaPurpose.avatar: None,
    MediaPurpose.chat_attachment: None,
    MediaPurpose.dispute_evidence: None,
    MediaPurpose.payout_receipt: frozenset({"admin"}),
}
MAX_PENDING_PER_ACCOUNT = 50
PENDING_TTL = timedelta(hours=24)
DETACHED_GRACE = timedelta(days=7)
GC_BATCH_SIZE = 200


def _now() -> datetime:
    return datetime.now(timezone.utc)


def is_public(purpose: str) -> bool:
    return MediaPurpose(purpose) in PUBLIC_PURPOSES


def _roles(account: Account) -> set[str]:
    return {getattr(role, "value", role) for role in (account.roles or [])}


# --------------------------------------------------------------------------- upload

async def upload(db: AsyncSession, account: Account, purpose: MediaPurpose, data: bytes) -> MediaObject:
    """Validate, re-encode and store one image as a ``pending`` object. Commits."""
    allowed = UPLOAD_ROLES[purpose]
    if allowed is not None and not (_roles(account) & allowed):
        raise MediaError(ErrorCode.MEDIA_PURPOSE_FORBIDDEN, 403)
    pending = await db.scalar(
        select(func.count()).select_from(MediaObject).where(
            MediaObject.owner_id == account.id, MediaObject.status == MediaStatus.pending.value,
        )
    )
    if pending >= MAX_PENDING_PER_ACCOUNT:
        raise MediaError(ErrorCode.MEDIA_PENDING_LIMIT, 429, max=MAX_PENDING_PER_ACCOUNT)
    try:
        variants = await asyncio.to_thread(process_image, data, PRESETS[purpose])
    except InvalidImage as exc:
        raise MediaError(ErrorCode.MEDIA_INVALID_IMAGE, 422, reason=exc.reason) from exc

    public = purpose in PUBLIC_PURPOSES
    public_id = new_public_id()
    prefix = key_prefix(public=public, purpose=purpose.value, public_id=public_id, now=_now())
    try:
        store = upload_store()
    except StorageUnavailable as exc:
        raise MediaError(ErrorCode.MEDIA_STORAGE_UNAVAILABLE, 503) from exc

    written: list[str] = []
    try:
        for name, variant in variants.items():
            key = object_key(prefix, name)
            await store.put(db, key, variant.data, public=public)
            written.append(key)
        db.add(MediaObject(
            public_id=public_id,
            owner_id=account.id,
            purpose=purpose.value,
            visibility="public" if public else "private",
            status=MediaStatus.pending.value,
            storage=store.name,
            key_prefix=prefix,
            variants={
                name: {"w": v.width, "h": v.height, "bytes": len(v.data), "sha256": v.sha256}
                for name, v in variants.items()
            },
            bytes_total=sum(len(v.data) for v in variants.values()),
        ))
        await db.commit()
    except S3Error as exc:
        await db.rollback()
        await _forget(store.name, written, public=public)
        logger.warning("media_upload_store_failed", operation=exc.operation, status=exc.status)
        raise MediaError(ErrorCode.MEDIA_STORAGE_UNAVAILABLE, 503) from exc
    except BaseException:
        await db.rollback()
        await _forget(store.name, written, public=public)
        raise
    return await db.scalar(select(MediaObject).where(MediaObject.public_id == public_id))


async def _forget(store_name: str, keys: list[str], *, public: bool) -> None:
    """Best effort: drop objects written to S3 for an upload that did not commit
    (Postgres blobs roll back with the transaction)."""
    if store_name == "db" or not keys:
        return
    try:
        async with SessionLocal() as db:
            await store_named(store_name).delete(db, keys, public=public)
    except Exception as exc:  # noqa: BLE001 — an orphan object is only wasted space
        logger.warning("media_orphan_objects", keys=keys, error=type(exc).__name__)


def upload_view(obj: MediaObject) -> dict:
    """What the uploader gets back. Private objects carry no URL: the client
    previews its local copy until the feature that owns the image serves it."""
    full = obj.variants["full"]
    view = {"id": obj.public_id, "purpose": obj.purpose, "w": full["w"], "h": full["h"], "bytes": obj.bytes_total}
    if obj.visibility == "public":
        view.update(public_image(snapshot(obj)) or {})
    return view


# --------------------------------------------------------------------------- attach

def snapshot(obj: MediaObject) -> dict:
    """Compact reference a feature stores on its own row (JSONB)."""
    full = obj.variants["full"]
    return {"id": obj.public_id, "key": obj.key_prefix, "w": full["w"], "h": full["h"], "thumb": "thumb" in obj.variants}


def public_image(snap: dict | None) -> dict | None:
    """Client shape of a public snapshot: absolute-path or CDN URLs."""
    if not snap or not snap.get("key", "").startswith("pub/"):
        return None
    url = public_url(snap["key"], "full")
    thumb = public_url(snap["key"], "thumb") if snap.get("thumb") else url
    return {"id": snap["id"], "url": url, "thumb_url": thumb, "w": snap["w"], "h": snap["h"]}


def public_images(snaps: list | None) -> list[dict]:
    return [image for image in (public_image(s) for s in (snaps or []) if isinstance(s, dict)) if image]


def private_image(snap: dict | None) -> dict | None:
    """Client shape of a private snapshot. No URL: the owning feature's
    authorised endpoint serves it and the client builds that path."""
    if not snap or not snap.get("key", "").startswith("prv/"):
        return None
    return {"id": snap["id"], "w": snap["w"], "h": snap["h"]}


def private_images(snaps: list | None) -> list[dict]:
    return [image for image in (private_image(s) for s in (snaps or []) if isinstance(s, dict)) if image]


async def set_subject_media(
    db: AsyncSession,
    *,
    actor: Account,
    purpose: MediaPurpose,
    subject_type: str,
    subject_id: int,
    public_ids: list[str],
    max_count: int,
) -> list[dict]:
    """Make ``public_ids`` (in this order) the complete image set of one subject.

    New images must be the actor's own ``pending`` uploads of ``purpose``; images
    already on this subject (even just detached) may stay whoever uploaded them.
    Images the subject no longer lists become ``detached``. Flushes only — the
    caller's transaction commits. Returns the snapshots in order.
    """
    ids = list(dict.fromkeys(public_ids))
    if len(ids) > max_count:
        raise MediaError(ErrorCode.MEDIA_LIMIT_EXCEEDED, 422, max=max_count)
    now = _now()
    rows: dict[str, MediaObject] = {}
    if ids:
        found = await db.scalars(
            select(MediaObject).where(MediaObject.public_id.in_(ids)).with_for_update()
        )
        rows = {obj.public_id: obj for obj in found}
    for public_id in ids:
        obj = rows.get(public_id)
        if obj is None or obj.status == MediaStatus.removed.value:
            raise MediaError(ErrorCode.MEDIA_NOT_FOUND, 422, id=public_id)
        on_subject = obj.subject_type == subject_type and obj.subject_id == subject_id
        if obj.purpose != purpose.value:
            raise MediaError(ErrorCode.MEDIA_NOT_ATTACHABLE, 422, id=public_id)
        if on_subject and obj.status in (MediaStatus.attached.value, MediaStatus.detached.value):
            obj.status = MediaStatus.attached.value
            obj.detached_at = None
            continue
        if obj.status != MediaStatus.pending.value or obj.owner_id != actor.id:
            raise MediaError(ErrorCode.MEDIA_NOT_ATTACHABLE, 422, id=public_id)
        obj.status = MediaStatus.attached.value
        obj.subject_type = subject_type
        obj.subject_id = subject_id
        obj.attached_at = now
    dropped = update(MediaObject).where(
        MediaObject.subject_type == subject_type,
        MediaObject.subject_id == subject_id,
        MediaObject.purpose == purpose.value,
        MediaObject.status == MediaStatus.attached.value,
    )
    if ids:
        dropped = dropped.where(MediaObject.public_id.not_in(ids))
    await db.execute(dropped.values(status=MediaStatus.detached.value, detached_at=now))
    await db.flush()
    return [snapshot(rows[public_id]) for public_id in ids]


async def detach_subjects(db: AsyncSession, *, subject_type: str, subject_ids: list[int]) -> None:
    """Release every image of these subjects (e.g. purged chat messages). Flushes only."""
    if not subject_ids:
        return
    await db.execute(
        update(MediaObject)
        .where(
            MediaObject.subject_type == subject_type,
            MediaObject.subject_id.in_(subject_ids),
            MediaObject.status == MediaStatus.attached.value,
        )
        .values(status=MediaStatus.detached.value, detached_at=_now())
    )


# --------------------------------------------------------------------------- read

async def find_public(db: AsyncSession, prefix: str) -> MediaObject | None:
    return await db.scalar(
        select(MediaObject).where(
            MediaObject.key_prefix == prefix,
            MediaObject.visibility == "public",
            MediaObject.status != MediaStatus.removed.value,
        )
    )


async def find_on_subject(
    db: AsyncSession, public_id: str, *, subject_type: str, subject_ids: list[int],
) -> MediaObject | None:
    """An image still readable on one of these subjects (attached or in grace)."""
    if not subject_ids:
        return None
    return await db.scalar(
        select(MediaObject).where(
            MediaObject.public_id == public_id,
            MediaObject.subject_type == subject_type,
            MediaObject.subject_id.in_(subject_ids),
            MediaObject.status.in_((MediaStatus.attached.value, MediaStatus.detached.value)),
        )
    )


async def read_variant(db: AsyncSession, obj: MediaObject, variant: str) -> bytes | None:
    try:
        return await store_named(obj.storage).get(
            db, object_key(obj.key_prefix, variant), public=obj.visibility == "public",
        )
    except (StorageUnavailable, S3Error) as exc:
        logger.warning("media_read_failed", storage=obj.storage, error=type(exc).__name__)
        raise MediaError(ErrorCode.MEDIA_STORAGE_UNAVAILABLE, 503) from exc


# --------------------------------------------------------------------------- garbage collection

async def collect_garbage(*, now: datetime | None = None, batch_size: int = GC_BATCH_SIZE, max_batches: int = 50) -> int:
    """Delete pending uploads older than a day and detached images past their
    grace period. Rows (and Postgres blobs) go in one transaction per batch;
    S3 objects are deleted after that commit, so a failure there leaves an
    orphan object, never a row pointing at missing bytes."""
    now = now or _now()
    expired = or_(
        and_(MediaObject.status == MediaStatus.pending.value, MediaObject.created_at < now - PENDING_TTL),
        and_(MediaObject.status == MediaStatus.detached.value, MediaObject.detached_at < now - DETACHED_GRACE),
    )
    deleted = 0
    for _ in range(max_batches):
        async with SessionLocal() as db:
            rows = (await db.execute(
                select(MediaObject.id, MediaObject.storage, MediaObject.key_prefix, MediaObject.variants, MediaObject.visibility)
                .where(expired)
                .order_by(MediaObject.id)
                .limit(batch_size)
                .with_for_update(skip_locked=True)
            )).all()
            if not rows:
                break
            db_keys = [
                object_key(row.key_prefix, name)
                for row in rows if row.storage == "db"
                for name in row.variants
            ]
            await DbMediaStore().delete(db, db_keys, public=True)
            await db.execute(delete(MediaObject).where(MediaObject.id.in_([row.id for row in rows])))
            await db.commit()
        for row in rows:
            if row.storage != "db":
                await _forget(row.storage, [object_key(row.key_prefix, n) for n in row.variants], public=row.visibility == "public")
        deleted += len(rows)
        if len(rows) < batch_size:
            break
    return deleted


__all__ = [
    "MAX_PENDING_PER_ACCOUNT", "UPLOAD_ROLES", "VARIANTS",
    "collect_garbage", "detach_subjects", "find_on_subject", "find_public", "is_public",
    "private_image", "private_images", "public_image", "public_images", "read_variant",
    "set_subject_media", "snapshot", "upload", "upload_view",
]
