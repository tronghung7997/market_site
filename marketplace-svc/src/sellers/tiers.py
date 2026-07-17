from src.config import settings

# Manually assigned by admins for now (no automatic promotion yet). Each tier
# raises the per-request withdrawal ceiling, shaves a discount off the flat
# platform fee, and shortens the escrow hold — the three levers sellers
# actually feel.
_WITHDRAW_LIMIT: dict[str, int | None] = {
    "new": 2_000_000,
    "verified": 10_000_000,
    "trusted": 50_000_000,
    "enterprise": None,
}
_FEE_DISCOUNT_PP: dict[str, int] = {"new": 0, "verified": 1, "trusted": 2, "enterprise": 3}
_ESCROW_REDUCTION_DAYS: dict[str, int] = {"new": 0, "verified": 0, "trusted": 1, "enterprise": 2}

TIER_ORDER = ["new", "verified", "trusted", "enterprise"]
_API_KEY_MIN_TIER = "trusted"


def withdraw_limit(tier: str) -> int | None:
    return _WITHDRAW_LIMIT.get(tier, _WITHDRAW_LIMIT["new"])


def platform_fee_percent(tier: str) -> int:
    base = settings.platform_fee_percent
    return max(0, base - _FEE_DISCOUNT_PP.get(tier, 0))


def escrow_days(tier: str, base_days: int) -> int:
    return max(1, base_days - _ESCROW_REDUCTION_DAYS.get(tier, 0))


def tier_at_least(tier: str, min_tier: str) -> bool:
    tier_idx = TIER_ORDER.index(tier) if tier in TIER_ORDER else 0
    return tier_idx >= TIER_ORDER.index(min_tier)


def can_use_api_keys(tier: str) -> bool:
    return tier_at_least(tier, _API_KEY_MIN_TIER)
