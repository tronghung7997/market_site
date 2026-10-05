"""Admin changelog: releases written by admins, read by every admin.

Drafts are visible only on the changelog page; publishing stamps
``published_at`` once, and an admin's unread count is the published releases
newer than their ``changelog_seen`` marker.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.models.account import Account
from src.models.changelog import ChangelogRelease, ChangelogSeen


class ChangelogError(Exception):
    def __init__(self, detail: str, *, status: int = 422) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status = status


async def _seen_at(db: AsyncSession, account_id: int) -> datetime | None:
    return await db.scalar(select(ChangelogSeen.seen_at).where(ChangelogSeen.account_id == account_id))


def _out(row: ChangelogRelease, author: str | None, seen_at: datetime | None) -> dict:
    return {
        "id": row.id,
        "version": row.version,
        "released_on": row.released_on,
        "title": row.title,
        "items": row.items or [],
        "dev_notes": row.dev_notes,
        "status": row.status,
        "published_at": row.published_at,
        "author": author,
        "unread": row.published_at is not None and (seen_at is None or row.published_at > seen_at),
    }


async def list_releases(db: AsyncSession, *, account_id: int, limit: int | None = None,
                        published_only: bool = False) -> dict:
    seen_at = await _seen_at(db, account_id)
    stmt = (
        select(ChangelogRelease, func.coalesce(Account.display_name, Account.email))
        .outerjoin(Account, Account.id == ChangelogRelease.created_by_id)
        # Drafts first (work in progress), then newest release.
        .order_by((ChangelogRelease.status == "draft").desc(), ChangelogRelease.released_on.desc(),
                  ChangelogRelease.id.desc())
    )
    if published_only:
        stmt = stmt.where(ChangelogRelease.status == "published")
    if limit:
        stmt = stmt.limit(limit)
    rows = [_out(r, author, seen_at) for r, author in (await db.execute(stmt)).all()]
    unread_stmt = select(func.count()).select_from(ChangelogRelease).where(
        ChangelogRelease.status == "published",
    )
    if seen_at is not None:
        unread_stmt = unread_stmt.where(ChangelogRelease.published_at > seen_at)
    return {"items": rows, "unread_count": int(await db.scalar(unread_stmt) or 0)}


async def _get(db: AsyncSession, release_id: int) -> ChangelogRelease:
    row = await db.get(ChangelogRelease, release_id)
    if row is None:
        raise ChangelogError("release not found", status=404)
    return row


async def _ensure_version_free(db: AsyncSession, version: str, *, exclude_id: int | None = None) -> None:
    stmt = select(ChangelogRelease.id).where(func.lower(ChangelogRelease.version) == version.lower())
    if exclude_id is not None:
        stmt = stmt.where(ChangelogRelease.id != exclude_id)
    if await db.scalar(stmt) is not None:
        raise ChangelogError("version already exists", status=409)


def _apply_status(row: ChangelogRelease, status: str) -> None:
    row.status = status
    if status == "published" and row.published_at is None:
        row.published_at = datetime.now(timezone.utc)


async def _single(db: AsyncSession, row: ChangelogRelease, account_id: int) -> dict:
    author = None
    if row.created_by_id is not None:
        acc = await db.get(Account, row.created_by_id)
        author = (acc.display_name or acc.email) if acc else None
    return _out(row, author, await _seen_at(db, account_id))


async def create_release(db: AsyncSession, *, actor_id: int, data: dict) -> dict:
    data["version"] = data["version"].strip()
    await _ensure_version_free(db, data["version"])
    row = ChangelogRelease(
        version=data["version"], released_on=data["released_on"], title=data["title"].strip(),
        items=data["items"], dev_notes=data["dev_notes"], created_by_id=actor_id,
    )
    _apply_status(row, data["status"])
    db.add(row)
    await db.flush()
    await _audit(db, actor_id, "created", row)
    await db.commit()
    await db.refresh(row)
    return await _single(db, row, actor_id)


async def update_release(db: AsyncSession, *, actor_id: int, release_id: int, data: dict) -> dict:
    row = await _get(db, release_id)
    if "version" in data and data["version"] is not None:
        data["version"] = data["version"].strip()
        await _ensure_version_free(db, data["version"], exclude_id=row.id)
        row.version = data["version"]
    for key in ("released_on", "items", "dev_notes"):
        if data.get(key) is not None:
            setattr(row, key, data[key])
    if data.get("title") is not None:
        row.title = data["title"].strip()
    if data.get("status") is not None:
        _apply_status(row, data["status"])
    await _audit(db, actor_id, "updated", row)
    await db.commit()
    await db.refresh(row)
    return await _single(db, row, actor_id)


async def delete_release(db: AsyncSession, *, actor_id: int, release_id: int) -> None:
    row = await _get(db, release_id)
    await _audit(db, actor_id, "deleted", row)
    await db.delete(row)
    await db.commit()


async def mark_seen(db: AsyncSession, *, account_id: int) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(
        insert(ChangelogSeen).values(account_id=account_id, seen_at=now)
        .on_conflict_do_update(index_elements=[ChangelogSeen.account_id], set_={"seen_at": now})
    )
    await db.commit()


async def _audit(db: AsyncSession, actor_id: int, action: str, row: ChangelogRelease) -> None:
    await log_event(
        db, "info", f"Changelog release {action}",
        metadata={
            "event": f"changelog_release_{action}",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "changelog_release",
            "subject_id": row.id,
            "version": row.version,
            "outcome": "success",
            "source": "admin",
        },
    )
