"""Admin-tunable seller workspace knobs (singleton row, process-cached).

`get_seller_settings()` is read on every seller products / inventory /
overview request, so it goes through a ProcessConfigCache like the display
money config; admin writes hard-invalidate.
"""
from __future__ import annotations

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.models.seller_runtime_config import SellerRuntimeConfig
from src.runtime_config import ProcessConfigCache

_CONFIG_ID = 1
DEFAULT_LOW_STOCK_THRESHOLD = 20
DEFAULT_EXPORT_ROW_LIMIT = 50_000
LOW_STOCK_THRESHOLD_RANGE = (1, 1_000)
EXPORT_ROW_LIMIT_RANGE = (100, 500_000)
DEFAULT_REVIEW_WINDOW_DAYS = 30
DEFAULT_AUTO_REVIEW_DAYS = 7
REVIEW_WINDOW_DAYS_RANGE = (1, 365)
AUTO_REVIEW_DAYS_RANGE = (1, 90)
_EDITABLE = (
    "low_stock_threshold", "inventory_export_row_limit",
    "review_window_days", "auto_review_days", "auto_review_enabled",
)

_cache: ProcessConfigCache[dict] = ProcessConfigCache("seller_runtime")


def _payload(row: SellerRuntimeConfig) -> dict:
    return {
        "low_stock_threshold": int(row.low_stock_threshold),
        "inventory_export_row_limit": int(row.inventory_export_row_limit),
        "review_window_days": int(row.review_window_days),
        "auto_review_days": int(row.auto_review_days),
        "auto_review_enabled": bool(row.auto_review_enabled),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by_id": row.updated_by_id,
    }


async def ensure_seeded(db: AsyncSession) -> SellerRuntimeConfig:
    row = await db.get(SellerRuntimeConfig, _CONFIG_ID)
    if row is not None:
        return row
    await db.execute(
        pg_insert(SellerRuntimeConfig)
        .values(
            id=_CONFIG_ID,
            low_stock_threshold=DEFAULT_LOW_STOCK_THRESHOLD,
            inventory_export_row_limit=DEFAULT_EXPORT_ROW_LIMIT,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.flush()
    row = await db.get(SellerRuntimeConfig, _CONFIG_ID)
    assert row is not None
    return row


async def get_seller_settings(db: AsyncSession) -> dict:
    cached = _cache.get()
    if cached is not None:
        return cached
    row = await ensure_seeded(db)
    payload = _payload(row)
    _cache.set(payload)
    return payload


async def get_low_stock_threshold(db: AsyncSession) -> int:
    return int((await get_seller_settings(db))["low_stock_threshold"])


async def get_export_row_limit(db: AsyncSession) -> int:
    return int((await get_seller_settings(db))["inventory_export_row_limit"])


async def get_review_window_days(db: AsyncSession) -> int:
    return int((await get_seller_settings(db))["review_window_days"])


async def get_auto_review_policy(db: AsyncSession) -> tuple[bool, int]:
    cfg = await get_seller_settings(db)
    return bool(cfg["auto_review_enabled"]), int(cfg["auto_review_days"])


async def update_seller_settings(
    db: AsyncSession,
    *,
    actor_id: int,
    low_stock_threshold: int | None = None,
    inventory_export_row_limit: int | None = None,
    review_window_days: int | None = None,
    auto_review_days: int | None = None,
    auto_review_enabled: bool | None = None,
) -> dict:
    row = await ensure_seeded(db)
    old = _payload(row)
    if low_stock_threshold is not None:
        row.low_stock_threshold = int(low_stock_threshold)
    if inventory_export_row_limit is not None:
        row.inventory_export_row_limit = int(inventory_export_row_limit)
    if review_window_days is not None:
        row.review_window_days = int(review_window_days)
    if auto_review_days is not None:
        row.auto_review_days = int(auto_review_days)
    if auto_review_enabled is not None:
        row.auto_review_enabled = bool(auto_review_enabled)
    row.updated_by_id = actor_id
    # Read the editable fields back *before* flush: onupdate expires updated_at
    # and a lazy refresh inside log_event's metadata would need a greenlet.
    new = {k: getattr(row, k) for k in _EDITABLE}
    await db.flush()
    await log_event(
        db, "info", "Seller runtime config updated",
        metadata={
            "event": "seller_runtime_config_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "seller_runtime_config",
            "subject_id": _CONFIG_ID,
            "old": {k: old[k] for k in _EDITABLE},
            "new": new,
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    _cache.invalidate()
    return _payload(row)
