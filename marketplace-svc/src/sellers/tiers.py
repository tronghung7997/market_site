"""Seller tiers: order, gates, and the seed values for seller_tier_config.

Tiers move automatically (daily job, src/sellers/tier_auto.py) or by an
admin, which locks them. The levers each tier controls — active-product cap,
withdrawal ceiling, platform fee %, escrow reduction — live in the database (Settings › Sellers › Tiers) and are read
through src/sellers/tier_config.py; the dictionaries below only seed a fresh
database and back the sync fallbacks used by scripts.
"""
from src.config import settings

TIER_ORDER = ["new", "verified", "trusted", "enterprise"]
_API_KEY_MIN_TIER = "trusted"

# None = no limit.
_MAX_ACTIVE_PRODUCTS: dict[str, int | None] = {"new": 3, "verified": 5, "trusted": 10, "enterprise": None}
_WITHDRAW_LIMIT: dict[str, int | None] = {
    "new": 2_000_000,
    "verified": 10_000_000,
    "trusted": 50_000_000,
    "enterprise": None,
}
# Absolute platform fee % per tier; None = the platform default. A fresh
# database inherits the default so nothing changes until an admin sets the
# tier fees (the client's ladder is 10 / 6 / 3 %, enterprise negotiated).
_FEE_PERCENT: dict[str, float | None] = {"new": None, "verified": None, "trusted": None, "enterprise": None}
SUGGESTED_FEE_PERCENT: dict[str, float | None] = {"new": 10, "verified": 6, "trusted": 3, "enterprise": None}
# Hours shaved off the product hold.
_ESCROW_REDUCTION_HOURS: dict[str, int] = {"new": 0, "verified": 0, "trusted": 24, "enterprise": 48}
# The shortest hold any order gets (product hold, tier reduction and category
# floors alike). Admin-tunable as `fee_runtime_config.escrow_floor_hours`
# (Settings › Fees & holds); this is its default and the scripts' fallback.
ESCROW_FLOOR_DEFAULT_HOURS = 24


def seed_defaults() -> dict[str, dict]:
    return {
        tier: {
            "max_active_products": _MAX_ACTIVE_PRODUCTS[tier],
            "withdraw_limit_per_request": _WITHDRAW_LIMIT[tier],
            "fee_percent": _FEE_PERCENT[tier],
            "escrow_reduction_hours": _ESCROW_REDUCTION_HOURS[tier],
        }
        for tier in TIER_ORDER
    }


def withdraw_limit(tier: str) -> int | None:
    """Seed/fallback only — request-time code uses tier_config.rule_for."""
    return _WITHDRAW_LIMIT.get(tier, _WITHDRAW_LIMIT["new"])


def platform_fee_percent(tier: str) -> float:
    """Env-based fallback only (tests / scripts). Order settlement uses
    `fees.service.platform_fee_percent_for`, which reads the admin config."""
    fee = _FEE_PERCENT.get(tier)
    return float(settings.platform_fee_percent if fee is None else fee)


def escrow_hours(
    tier: str, base_hours: int, *, reduction_hours: int | None = None,
    floor_hours: int = ESCROW_FLOOR_DEFAULT_HOURS,
) -> int:
    """The product hold minus the tier reduction, never under the platform
    hold floor (``floor_hours``, at least 1 h): neither a short product hold
    nor a tier reduction takes an order under it."""
    reduction = _ESCROW_REDUCTION_HOURS.get(tier, 0) if reduction_hours is None else reduction_hours
    return max(1, int(floor_hours), base_hours - reduction)


def tier_at_least(tier: str, min_tier: str) -> bool:
    tier_idx = TIER_ORDER.index(tier) if tier in TIER_ORDER else 0
    return tier_idx >= TIER_ORDER.index(min_tier)


def can_use_api_keys(tier: str) -> bool:
    return tier_at_least(tier, _API_KEY_MIN_TIER)
