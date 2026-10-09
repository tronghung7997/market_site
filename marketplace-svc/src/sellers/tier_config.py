"""Seller-tier levers read from seller_tier_config (process-cached, 5 s).

`get_tier_rules(db)` is the single entry point: it seeds the four rows from
the defaults in src/sellers/tiers.py on first use, then serves the admin's
values. Every update lands in the audit log with old → new per tier.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.media import service as media_service
from src.media.service import public_image
from src.models.media import MediaPurpose
from src.audit.service import log_event
from src.logging import current_request_id
from src.models.seller_tier_config import SellerTierConfig
from src.runtime_config import ProcessConfigCache
from src.sellers.tiers import TIER_ORDER, seed_defaults

_cache: ProcessConfigCache[dict] = ProcessConfigCache("seller_tier_rules")
_EDITABLE = ("max_active_products", "withdraw_limit_per_request", "fee_percent", "escrow_reduction_hours")
PERCENT_RANGE = (0.0, 100.0)
HOURS_RANGE = (0, 2160)
LIMIT_RANGE = (0, 1_000_000_000)


@dataclass(frozen=True)
class TierRule:
    tier: str
    max_active_products: int | None
    withdraw_limit_per_request: int | None
    # Absolute platform fee %; None = the platform default (fees.service).
    fee_percent: float | None
    escrow_reduction_hours: int
    # Badge icon (PublicImage) shown next to the names of sellers in this tier.
    badge: dict | None = None
    updated_at: str | None = None
    updated_by_id: int | None = None


def _rule(row: SellerTierConfig) -> TierRule:
    return TierRule(
        tier=row.tier,
        max_active_products=row.max_active_products,
        withdraw_limit_per_request=row.withdraw_limit_per_request,
        fee_percent=None if row.fee_percent is None else float(row.fee_percent),
        escrow_reduction_hours=int(row.escrow_reduction_hours),
        badge=public_image(row.badge),
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
        updated_by_id=row.updated_by_id,
    )


async def ensure_seeded(db: AsyncSession) -> dict[str, SellerTierConfig]:
    rows = {r.tier: r for r in (await db.execute(select(SellerTierConfig))).scalars()}
    missing = [t for t in TIER_ORDER if t not in rows]
    if missing:
        defaults = seed_defaults()
        await db.execute(
            pg_insert(SellerTierConfig)
            .values([{"tier": t, **defaults[t]} for t in missing])
            .on_conflict_do_nothing(index_elements=["tier"])
        )
        await db.flush()
        rows = {r.tier: r for r in (await db.execute(select(SellerTierConfig))).scalars()}
    return rows


async def get_tier_rules(db: AsyncSession) -> dict[str, TierRule]:
    cached = _cache.get()
    if cached is not None:
        return cached
    rows = await ensure_seeded(db)
    rules = {t: _rule(rows[t]) for t in TIER_ORDER if t in rows}
    _cache.set(rules)
    return rules


async def rule_for(db: AsyncSession, tier: str | None) -> TierRule:
    rules = await get_tier_rules(db)
    return rules.get(tier or "new") or rules["new"]


def _check(name: str, value: int | None, bounds: tuple[int, int], *, nullable: bool) -> int | None:
    if value is None:
        if nullable:
            return None
        raise ValueError(f"{name} is required")
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{name} must be an integer")
    low, high = bounds
    if not (low <= value <= high):
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


def _check_percent(name: str, value) -> float | None:
    """None = inherit the platform default."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    low, high = PERCENT_RANGE
    if not (low <= value <= high):
        raise ValueError(f"{name} must be between {low:g} and {high:g}")
    return round(float(value), 2)


async def update_tier_rules(
    db: AsyncSession, *, actor_id: int, tiers: dict[str, dict], dry_run: bool = False,
) -> dict[str, TierRule] | None:
    """`tiers` = {tier: {field: value}} — only the fields present are changed.
    A key that is present with value None clears a limit (= unlimited)."""
    rows = await ensure_seeded(db)
    old = {t: asdict(_rule(rows[t])) for t in rows}
    changed: dict[str, dict] = {}
    for tier, patch in tiers.items():
        if tier not in rows:
            raise ValueError(f"unknown tier {tier!r}")
        row = rows[tier]
        diff: dict = {}
        if "max_active_products" in patch:
            v = _check(f"{tier}.max_active_products", patch["max_active_products"], LIMIT_RANGE, nullable=True)
            if v != row.max_active_products:
                diff["max_active_products"] = [row.max_active_products, v]
                row.max_active_products = v
        if "withdraw_limit_per_request" in patch:
            v = _check(f"{tier}.withdraw_limit_per_request", patch["withdraw_limit_per_request"], LIMIT_RANGE, nullable=True)
            if v != row.withdraw_limit_per_request:
                diff["withdraw_limit_per_request"] = [row.withdraw_limit_per_request, v]
                row.withdraw_limit_per_request = v
        if "fee_percent" in patch:
            v = _check_percent(f"{tier}.fee_percent", patch["fee_percent"])
            old_fee = None if row.fee_percent is None else float(row.fee_percent)
            if v != old_fee:
                diff["fee_percent"] = [old_fee, v]
                row.fee_percent = v
        if "escrow_reduction_hours" in patch:
            v = _check(f"{tier}.escrow_reduction_hours", patch["escrow_reduction_hours"], HOURS_RANGE, nullable=False)
            if v != row.escrow_reduction_hours:
                diff["escrow_reduction_hours"] = [row.escrow_reduction_hours, v]
                row.escrow_reduction_hours = v
        if "badge_image_id" in patch:
            media_id = patch["badge_image_id"]
            snaps = await media_service.set_subject_media(
                db, actor_id=actor_id, purpose=MediaPurpose.tier_badge, subject_type="seller_tier",
                subject_id=TIER_ORDER.index(tier) + 1, public_ids=[media_id] if media_id else [], max_count=1,
            )
            before = (row.badge or {}).get("id")
            row.badge = snaps[0] if snaps else None
            if before != (row.badge or {}).get("id"):
                diff["badge"] = [before, (row.badge or {}).get("id")]
        if diff:
            row.updated_by_id = actor_id
            changed[tier] = diff
    if dry_run:
        # Validated and staged on the row; the caller (config_approval) rolls back.
        return None
    await db.flush()
    await log_event(
        db, "warning" if changed else "info", "Seller tier config updated",
        request_id=current_request_id(),
        metadata={
            "event": "seller_tier_config_changed",
            "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "seller_tier_config", "subject_id": 0,
            "old": {t: {k: old[t][k] for k in _EDITABLE} for t in old},
            "changed": changed,
            "outcome": "success", "source": "admin",
        },
    )
    await db.commit()
    _cache.invalidate()
    return await get_tier_rules(db)
