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

from src.audit.service import log_event
from src.logging import current_request_id
from src.models.seller_tier_config import SellerTierConfig
from src.runtime_config import ProcessConfigCache
from src.sellers.tiers import TIER_ORDER, seed_defaults

_cache: ProcessConfigCache[dict] = ProcessConfigCache("seller_tier_rules")
_EDITABLE = ("max_active_products", "withdraw_limit_per_request", "fee_discount_pp", "escrow_reduction_days")
PP_RANGE = (0, 100)
DAYS_RANGE = (0, 90)
LIMIT_RANGE = (0, 1_000_000_000)


@dataclass(frozen=True)
class TierRule:
    tier: str
    max_active_products: int | None
    withdraw_limit_per_request: int | None
    fee_discount_pp: int
    escrow_reduction_days: int
    updated_at: str | None = None
    updated_by_id: int | None = None


def _rule(row: SellerTierConfig) -> TierRule:
    return TierRule(
        tier=row.tier,
        max_active_products=row.max_active_products,
        withdraw_limit_per_request=row.withdraw_limit_per_request,
        fee_discount_pp=int(row.fee_discount_pp),
        escrow_reduction_days=int(row.escrow_reduction_days),
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


async def update_tier_rules(db: AsyncSession, *, actor_id: int, tiers: dict[str, dict]) -> dict[str, TierRule]:
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
        if "fee_discount_pp" in patch:
            v = _check(f"{tier}.fee_discount_pp", patch["fee_discount_pp"], PP_RANGE, nullable=False)
            if v != row.fee_discount_pp:
                diff["fee_discount_pp"] = [row.fee_discount_pp, v]
                row.fee_discount_pp = v
        if "escrow_reduction_days" in patch:
            v = _check(f"{tier}.escrow_reduction_days", patch["escrow_reduction_days"], DAYS_RANGE, nullable=False)
            if v != row.escrow_reduction_days:
                diff["escrow_reduction_days"] = [row.escrow_reduction_days, v]
                row.escrow_reduction_days = v
        if diff:
            row.updated_by_id = actor_id
            changed[tier] = diff
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
