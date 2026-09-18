from __future__ import annotations

from datetime import datetime, timezone
from functools import wraps
from typing import Any, Awaitable, Callable

import structlog
from fastapi import status
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.database import SessionLocal
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.models.site_runtime_config import SiteRuntimeConfig
from src.runtime_config import ProcessConfigCache

_CONFIG_ID = 1
ANNOUNCEMENT_LEVELS = ("info", "warn", "danger")
_EDITABLE = (
    "maintenance_enabled", "maintenance_message_vi", "maintenance_message_en", "maintenance_until",
    "withdrawals_frozen", "deposits_frozen", "orders_frozen", "freeze_reason",
    "announcement_enabled", "announcement_level", "announcement_text_vi", "announcement_text_en",
    "announcement_link_url", "announcement_starts_at", "announcement_ends_at",
)
_ANNOUNCEMENT_TEXT_FIELDS = ("announcement_text_vi", "announcement_text_en", "announcement_link_url", "announcement_level")

_cache: ProcessConfigCache[dict] = ProcessConfigCache("site_runtime")
logger = structlog.get_logger()


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _payload(row: SiteRuntimeConfig) -> dict:
    return {
        "maintenance_enabled": bool(row.maintenance_enabled),
        "maintenance_message_vi": row.maintenance_message_vi or "",
        "maintenance_message_en": row.maintenance_message_en or "",
        "maintenance_until": _iso(row.maintenance_until),
        "withdrawals_frozen": bool(row.withdrawals_frozen),
        "deposits_frozen": bool(row.deposits_frozen),
        "orders_frozen": bool(row.orders_frozen),
        "freeze_reason": row.freeze_reason or "",
        "announcement_enabled": bool(row.announcement_enabled),
        "announcement_level": row.announcement_level or "info",
        "announcement_text_vi": row.announcement_text_vi or "",
        "announcement_text_en": row.announcement_text_en or "",
        "announcement_link_url": row.announcement_link_url or "",
        "announcement_starts_at": _iso(row.announcement_starts_at),
        "announcement_ends_at": _iso(row.announcement_ends_at),
        "announcement_version": int(row.announcement_version or 1),
        "updated_at": _iso(row.updated_at),
        "updated_by_id": row.updated_by_id,
    }


async def ensure_seeded(db: AsyncSession) -> SiteRuntimeConfig:
    row = await db.get(SiteRuntimeConfig, _CONFIG_ID)
    if row is not None:
        return row
    await db.execute(
        pg_insert(SiteRuntimeConfig).values(id=_CONFIG_ID).on_conflict_do_nothing(index_elements=["id"])
    )
    await db.flush()
    row = await db.get(SiteRuntimeConfig, _CONFIG_ID)
    assert row is not None
    return row


async def get_site_status(db: AsyncSession) -> dict:
    cached = _cache.get()
    if cached is not None:
        return cached
    payload = _payload(await ensure_seeded(db))
    _cache.set(payload)
    return payload


def announcement_is_live(cfg: dict, now: datetime | None = None) -> bool:
    """Enabled, has text, and inside its optional schedule window."""
    if not cfg.get("announcement_enabled"):
        return False
    if not (cfg.get("announcement_text_vi") or cfg.get("announcement_text_en")):
        return False
    now = now or datetime.now(timezone.utc)
    starts = cfg.get("announcement_starts_at")
    ends = cfg.get("announcement_ends_at")
    if starts and now < datetime.fromisoformat(starts):
        return False
    if ends and now > datetime.fromisoformat(ends):
        return False
    return True


def public_view(cfg: dict) -> dict:
    """What the storefront may see: no internal reason, no editor id."""
    live = announcement_is_live(cfg)
    return {
        "maintenance_enabled": cfg["maintenance_enabled"],
        "maintenance_message_vi": cfg["maintenance_message_vi"],
        "maintenance_message_en": cfg["maintenance_message_en"],
        "maintenance_until": cfg["maintenance_until"],
        "withdrawals_frozen": cfg["withdrawals_frozen"],
        "deposits_frozen": cfg["deposits_frozen"],
        "orders_frozen": cfg["orders_frozen"],
        "announcement": {
            "level": cfg["announcement_level"],
            "text_vi": cfg["announcement_text_vi"],
            "text_en": cfg["announcement_text_en"],
            "link_url": cfg["announcement_link_url"],
            "version": cfg["announcement_version"],
        } if live else None,
    }


async def update_site_status(
    db: AsyncSession,
    *,
    actor_id: int,
    clear_maintenance_until: bool = False,
    clear_announcement_window: bool = False,
    **changes: Any,
) -> dict:
    """Apply the non-None fields in `changes`. Nullable timestamps are cleared
    only through the explicit flags (JSON null means "leave alone")."""
    row = await ensure_seeded(db)
    old = _payload(row)
    if "announcement_level" in changes and changes["announcement_level"] not in ANNOUNCEMENT_LEVELS:
        raise ValueError("announcement_level must be info, warn or danger")
    for key, value in changes.items():
        if key not in _EDITABLE or value is None:
            continue
        setattr(row, key, value.strip() if isinstance(value, str) else value)
    if clear_maintenance_until:
        row.maintenance_until = None
    if clear_announcement_window:
        row.announcement_starts_at = None
        row.announcement_ends_at = None
    if any(k in changes and changes[k] is not None and old[k] != getattr(row, k) for k in _ANNOUNCEMENT_TEXT_FIELDS):
        row.announcement_version = int(row.announcement_version or 1) + 1
    row.updated_by_id = actor_id
    new = {k: getattr(row, k) for k in _EDITABLE}
    await db.flush()
    changed = {k: (old[k], _iso(v) if isinstance(v, datetime) else v) for k, v in new.items()
               if old[k] != (_iso(v) if isinstance(v, datetime) else v)}
    # Kill-switch and maintenance flips are the events an auditor looks for;
    # keep them loud (warning) and self-describing.
    level = "warning" if any(k in changed for k in (
        "maintenance_enabled", "withdrawals_frozen", "deposits_frozen", "orders_frozen",
    )) else "info"
    await log_event(
        db, level, "Site runtime config updated",
        request_id=current_request_id(),
        metadata={
            "event": "site_runtime_config_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "site_runtime_config",
            "subject_id": _CONFIG_ID,
            "changed": changed,
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    _cache.invalidate()
    return _payload(row)


# ── guards ──────────────────────────────────────────────────────────────────

async def require_orders_open(db: AsyncSession) -> None:
    if (await get_site_status(db))["orders_frozen"]:
        raise api_error(ErrorCode.ORDERS_FROZEN, status.HTTP_503_SERVICE_UNAVAILABLE)


async def require_deposits_open(db: AsyncSession) -> None:
    if (await get_site_status(db))["deposits_frozen"]:
        raise api_error(ErrorCode.DEPOSITS_FROZEN, status.HTTP_503_SERVICE_UNAVAILABLE)


async def require_withdrawals_open(db: AsyncSession) -> None:
    if (await get_site_status(db))["withdrawals_frozen"]:
        raise api_error(ErrorCode.WITHDRAWALS_FROZEN, status.HTTP_503_SERVICE_UNAVAILABLE)


async def maintenance_active(db: AsyncSession) -> bool:
    return bool((await get_site_status(db))["maintenance_enabled"])


def pausable(job: Callable[[], Awaitable[None]]) -> Callable[[], Awaitable[None]]:
    """Skip a scheduler job while maintenance is on, so nothing moves money or
    provisions resources in the middle of an incident."""

    @wraps(job)
    async def runner() -> None:
        async with SessionLocal() as db:
            paused = await maintenance_active(db)
        if paused:
            logger.info("job_skipped_maintenance", job=job.__name__)
            return
        await job()

    return runner
