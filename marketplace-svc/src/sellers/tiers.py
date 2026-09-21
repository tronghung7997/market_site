"""Seller tiers: order, gates, and the seed values for seller_tier_config.

Tiers are assigned by admins (no automatic promotion yet). The levers each
tier controls — active-product cap, withdrawal ceiling, fee discount, escrow
reduction — live in the database (Settings › Sellers › Tiers) and are read
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
_FEE_DISCOUNT_PP: dict[str, int] = {"new": 0, "verified": 1, "trusted": 2, "enterprise": 3}
_ESCROW_REDUCTION_DAYS: dict[str, int] = {"new": 0, "verified": 0, "trusted": 1, "enterprise": 2}


def seed_defaults() -> dict[str, dict]:
    return {
        tier: {
            "max_active_products": _MAX_ACTIVE_PRODUCTS[tier],
            "withdraw_limit_per_request": _WITHDRAW_LIMIT[tier],
            "fee_discount_pp": _FEE_DISCOUNT_PP[tier],
            "escrow_reduction_days": _ESCROW_REDUCTION_DAYS[tier],
        }
        for tier in TIER_ORDER
    }


def withdraw_limit(tier: str) -> int | None:
    """Seed/fallback only — request-time code uses tier_config.rule_for."""
    return _WITHDRAW_LIMIT.get(tier, _WITHDRAW_LIMIT["new"])


def fee_discount_pp(tier: str) -> int:
    """Seed/fallback only."""
    return _FEE_DISCOUNT_PP.get(tier, 0)


def platform_fee_percent(tier: str) -> int:
    """Env-based fallback only (tests / scripts). Order settlement uses
    `fees.service.platform_fee_percent_for`, which reads the admin config."""
    base = settings.platform_fee_percent
    return max(0, base - _FEE_DISCOUNT_PP.get(tier, 0))


def escrow_days(tier: str, base_days: int, *, reduction_days: int | None = None) -> int:
    reduction = _ESCROW_REDUCTION_DAYS.get(tier, 0) if reduction_days is None else reduction_days
    return max(1, base_days - reduction)


def tier_at_least(tier: str, min_tier: str) -> bool:
    tier_idx = TIER_ORDER.index(tier) if tier in TIER_ORDER else 0
    return tier_idx >= TIER_ORDER.index(min_tier)


def can_use_api_keys(tier: str) -> bool:
    return tier_at_least(tier, _API_KEY_MIN_TIER)
