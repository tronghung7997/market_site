"""Notification history: write (inside the caller's transaction), list, mark
read. Order status changes are written by the session hooks in
``src.models.notification``; everything else calls ``notify``."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.notification import NOTIFICATION_CATEGORIES, Notification

PAGE_MAX = 50
# Read rows older than this are purged; unread ones stay until read.
READ_RETENTION_DAYS = 90


async def notify(
    db: AsyncSession,
    account_id: int,
    kind: str,
    *,
    category: str,
    params: dict | None = None,
    href: str | None = None,
) -> None:
    """Add a notification to the caller's transaction. Never commits."""
    if category not in NOTIFICATION_CATEGORIES:
        raise ValueError(f"unknown notification category: {category}")
    db.add(Notification(account_id=account_id, category=category, kind=kind, params=params or {}, href=href))


async def notify_collapsed(
    db: AsyncSession,
    account_id: int,
    kind: str,
    *,
    category: str,
    collapse_key: str,
    params: dict | None = None,
    href: str | None = None,
) -> None:
    """One unread row per ``collapse_key`` (a chat thread): a repeat bumps its
    time, count and params instead of stacking rows. Never commits."""
    existing = await db.scalar(
        select(Notification)
        .where(
            Notification.account_id == account_id,
            Notification.collapse_key == collapse_key,
            Notification.read_at.is_(None),
        )
        .with_for_update()
    )
    if existing is not None:
        count = int((existing.params or {}).get("count", 1)) + 1
        existing.params = {**(params or {}), "count": count}
        existing.created_at = datetime.now(timezone.utc)
        return
    db.add(Notification(
        account_id=account_id, category=category, kind=kind, collapse_key=collapse_key,
        params={**(params or {}), "count": 1}, href=href,
    ))


async def mark_collapsed_read(db: AsyncSession, account_id: int, collapse_key: str) -> None:
    """The thread was read where it lives (the chat): its notification too."""
    await db.execute(
        update(Notification)
        .where(
            Notification.account_id == account_id,
            Notification.collapse_key == collapse_key,
            Notification.read_at.is_(None),
        )
        .values(read_at=func.now())
    )


def _dto(row: Notification) -> dict:
    return {
        "id": row.id, "category": row.category, "kind": row.kind, "params": row.params or {},
        "href": row.href, "read": row.read_at is not None, "created_at": row.created_at,
    }


async def unread_counts(account_id: int, db: AsyncSession) -> dict:
    rows = (await db.execute(
        select(Notification.category, func.count(Notification.id))
        .where(Notification.account_id == account_id, Notification.read_at.is_(None))
        .group_by(Notification.category)
    )).all()
    by_category = {category: 0 for category in NOTIFICATION_CATEGORIES}
    by_category.update({category: int(count) for category, count in rows})
    return {"unread": sum(by_category.values()), "by_category": by_category}


async def list_notifications(
    account_id: int,
    db: AsyncSession,
    *,
    category: str | None = None,
    unread_only: bool = False,
    before: int | None = None,
    limit: int = 20,
) -> dict:
    """Newest first, keyset-paged by id (``before`` = the last id seen)."""
    limit = max(1, min(limit, PAGE_MAX))
    query = select(Notification).where(Notification.account_id == account_id)
    if category:
        query = query.where(Notification.category == category)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    if before is not None:
        query = query.where(Notification.id < before)
    rows = list((await db.scalars(query.order_by(Notification.id.desc()).limit(limit + 1))).all())
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "items": [_dto(row) for row in rows],
        "next_cursor": rows[-1].id if more and rows else None,
        **await unread_counts(account_id, db),
    }


async def mark_read(account_id: int, db: AsyncSession, *, ids: list[int] | None = None, category: str | None = None) -> dict:
    """Mark the given rows (only the caller's), a whole category, or everything read."""
    query = update(Notification).where(Notification.account_id == account_id, Notification.read_at.is_(None))
    if ids:
        query = query.where(Notification.id.in_(ids))
    elif category:
        query = query.where(Notification.category == category)
    await db.execute(query.values(read_at=func.now()))
    await db.commit()
    return await unread_counts(account_id, db)


async def purge_old(db: AsyncSession, *, now: datetime | None = None) -> int:
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(days=READ_RETENTION_DAYS)
    result = await db.execute(
        delete(Notification).where(Notification.read_at.is_not(None), Notification.created_at < cutoff)
    )
    await db.commit()
    return int(result.rowcount or 0)
