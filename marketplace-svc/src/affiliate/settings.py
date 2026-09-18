"""Admin-tunable affiliate programme knobs (singleton row, process-cached).

The commission rate is a share of the *platform fee* on each settled order.
`DEFAULT_AFFILIATE_COMMISSION_PERCENT` in env only seeds the first row.
"""
from __future__ import annotations

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.config import settings
from src.logging import current_request_id
from src.models.affiliate_runtime_config import AffiliateRuntimeConfig
from src.runtime_config import ProcessConfigCache

_CONFIG_ID = 1
COMMISSION_PERCENT_RANGE = (0.0, 100.0)
ATTRIBUTION_DAYS_RANGE = (1, 365)
EARNING_DAYS_RANGE = (0, 3650)  # 0 = lifetime
MAX_PER_DAY_RANGE = (1, 10_000)
_EDITABLE = (
    "enabled", "commission_percent_of_fee", "attribution_days", "earning_days", "max_commissions_per_day",
)

_cache: ProcessConfigCache[dict] = ProcessConfigCache("affiliate_runtime")


def _payload(row: AffiliateRuntimeConfig) -> dict:
    return {
        "enabled": bool(row.enabled),
        "commission_percent_of_fee": float(row.commission_percent_of_fee),
        "attribution_days": int(row.attribution_days),
        "earning_days": int(row.earning_days),
        "max_commissions_per_day": int(row.max_commissions_per_day),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by_id": row.updated_by_id,
    }


async def ensure_seeded(db: AsyncSession) -> AffiliateRuntimeConfig:
    row = await db.get(AffiliateRuntimeConfig, _CONFIG_ID)
    if row is not None:
        return row
    await db.execute(
        pg_insert(AffiliateRuntimeConfig)
        .values(
            id=_CONFIG_ID,
            commission_percent_of_fee=float(settings.default_affiliate_commission_percent),
            max_commissions_per_day=int(settings.affiliate_max_commissions_per_day),
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.flush()
    row = await db.get(AffiliateRuntimeConfig, _CONFIG_ID)
    assert row is not None
    return row


async def get_affiliate_settings(db: AsyncSession) -> dict:
    cached = _cache.get()
    if cached is not None:
        return cached
    payload = _payload(await ensure_seeded(db))
    _cache.set(payload)
    return payload


def _check(name: str, value: float, bounds: tuple[float, float]) -> None:
    low, high = bounds
    if not (low <= value <= high):
        raise ValueError(f"{name} must be between {low:g} and {high:g}")


async def update_affiliate_settings(
    db: AsyncSession,
    *,
    actor_id: int,
    enabled: bool | None = None,
    commission_percent_of_fee: float | None = None,
    attribution_days: int | None = None,
    earning_days: int | None = None,
    max_commissions_per_day: int | None = None,
) -> dict:
    row = await ensure_seeded(db)
    old = _payload(row)
    if enabled is not None:
        row.enabled = bool(enabled)
    if commission_percent_of_fee is not None:
        _check("commission_percent_of_fee", commission_percent_of_fee, COMMISSION_PERCENT_RANGE)
        row.commission_percent_of_fee = float(commission_percent_of_fee)
    if attribution_days is not None:
        _check("attribution_days", attribution_days, ATTRIBUTION_DAYS_RANGE)
        row.attribution_days = int(attribution_days)
    if earning_days is not None:
        _check("earning_days", earning_days, EARNING_DAYS_RANGE)
        row.earning_days = int(earning_days)
    if max_commissions_per_day is not None:
        _check("max_commissions_per_day", max_commissions_per_day, MAX_PER_DAY_RANGE)
        row.max_commissions_per_day = int(max_commissions_per_day)
    row.updated_by_id = actor_id
    new = {k: getattr(row, k) for k in _EDITABLE}
    await db.flush()
    await log_event(
        db, "info", "Affiliate runtime config updated",
        request_id=current_request_id(),
        metadata={
            "event": "affiliate_runtime_config_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "affiliate_runtime_config",
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
