"""Admin-tunable third-party analytics tags (singleton row, process-cached).

`public_config()` is read by the storefront layout on every SSR pass, so it
goes through a ProcessConfigCache like the display money config; admin
writes hard-invalidate.
"""
from __future__ import annotations

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.models.site_analytics_config import SiteAnalyticsConfig
from src.runtime_config import ProcessConfigCache

_CONFIG_ID = 1
_EDITABLE = ("clarity_project_id",)

_public_cache: ProcessConfigCache[dict] = ProcessConfigCache("site_analytics_public")


def _public_payload(row: SiteAnalyticsConfig) -> dict:
    return {"clarity_project_id": row.clarity_project_id or None}


def _admin_payload(row: SiteAnalyticsConfig) -> dict:
    return {
        **_public_payload(row),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by_id": row.updated_by_id,
    }


async def ensure_seeded(db: AsyncSession) -> SiteAnalyticsConfig:
    row = await db.get(SiteAnalyticsConfig, _CONFIG_ID)
    if row is not None:
        return row
    await db.execute(
        pg_insert(SiteAnalyticsConfig)
        .values(id=_CONFIG_ID, clarity_project_id=None)
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.flush()
    row = await db.get(SiteAnalyticsConfig, _CONFIG_ID)
    assert row is not None
    return row


async def public_config(db: AsyncSession) -> dict:
    cached = _public_cache.get()
    if cached is not None:
        return cached
    row = await ensure_seeded(db)
    await db.commit()
    payload = _public_payload(row)
    _public_cache.set(payload)
    return payload


async def admin_config(db: AsyncSession) -> dict:
    row = await ensure_seeded(db)
    await db.commit()
    return _admin_payload(row)


async def update_config(db: AsyncSession, *, actor_id: int, clarity_project_id: str | None) -> dict:
    row = await ensure_seeded(db)
    old = {k: getattr(row, k) for k in _EDITABLE}
    row.clarity_project_id = clarity_project_id
    row.updated_by_id = actor_id
    new = {k: getattr(row, k) for k in _EDITABLE}
    await db.flush()
    await log_event(
        db, "info", "Site analytics config updated",
        metadata={
            "event": "site_analytics_config_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "site_analytics_config",
            "subject_id": _CONFIG_ID,
            "old": old,
            "new": new,
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    _public_cache.invalidate()
    _public_cache.set(_public_payload(row))
    return _admin_payload(row)
