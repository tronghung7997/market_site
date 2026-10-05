"""Admin bell feed: open operator alerts collapsed by type, newest first.

One row per alert type ("Sổ cái lệch số dư · 44 lần") instead of one per
alert. A row is unread when that type fired again after the admin last
opened the bell (``admin_notification_seen``).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts.admin_view import admin_alert_links, admin_open_clause
from src.models.alert import Alert
from src.models.notification_seen import AdminNotificationSeen

_SEVERITY_RANK = {"critical": 4, "error": 3, "warning": 2, "info": 1}


async def admin_feed(db: AsyncSession, *, account_id: int, limit: int = 8) -> dict:
    seen_at = await db.scalar(
        select(AdminNotificationSeen.seen_at).where(AdminNotificationSeen.account_id == account_id)
    )
    groups = (await db.execute(
        select(
            Alert.type,
            func.count(Alert.id),
            func.max(Alert.last_seen_at),
            func.array_agg(func.distinct(Alert.severity)),
        )
        .where(admin_open_clause())
        .group_by(Alert.type)
        .order_by(func.max(Alert.last_seen_at).desc())
    )).all()

    def unread(last_seen: datetime) -> bool:
        return seen_at is None or last_seen > seen_at

    unread_count = sum(1 for _, _, last_seen, _ in groups if unread(last_seen))
    shown = groups[:limit]
    # The newest alert of each shown type supplies the wording and the link.
    latest: dict[str, Alert] = {}
    if shown:
        newest = (
            select(Alert)
            .where(admin_open_clause(), Alert.type.in_([g[0] for g in shown]))
            .distinct(Alert.type)
            .order_by(Alert.type, Alert.last_seen_at.desc(), Alert.id.desc())
        )
        latest = {a.type: a for a in (await db.execute(newest)).scalars()}
    links = await admin_alert_links(db, list(latest.values())) if latest else {}

    items = []
    for alert_type, count, last_seen, severities in shown:
        alert = latest[alert_type]
        href = (links.get(alert.id) or "/admin/alerts") if count == 1 else f"/admin/alerts?type={alert_type}"
        items.append({
            "type": alert_type,
            "severity": max(severities, key=lambda s: _SEVERITY_RANK.get(s, 0)),
            "label": alert.message,
            "count": count,
            "last_seen_at": last_seen,
            "href": href,
            "unread": unread(last_seen),
        })
    return {"items": items, "unread_count": unread_count}


async def mark_seen(db: AsyncSession, *, account_id: int) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(
        insert(AdminNotificationSeen).values(account_id=account_id, seen_at=now)
        .on_conflict_do_update(index_elements=[AdminNotificationSeen.account_id], set_={"seen_at": now})
    )
    await db.commit()
