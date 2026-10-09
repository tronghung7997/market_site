"""Buyer tier settings (singleton ``buyer_tier_config``, process-cached).

Three levels l1 / l2 / l3 with admin-editable names. A buyer's level is the
highest one whose ``min_amount`` (VND) their criterion reaches:

- ``total_deposit``: real gateway deposits (``deposit`` transactions; admin
  top-ups are not deposits);
- ``total_spent``: completed real orders, net of refunds.

Each level sets the cashback % paid when an order settles and the public
API limits per minute (``None`` = no per-key limit; the per-IP flood guard
still applies). ``ip_requests_per_minute`` is that flood guard: calls to
``/v1`` per client IP per minute, for every tier, checked before the key is
looked up (documents saved before it existed read as the default). Every
save lands in the audit log with old → new (event
``buyer_tier_config_changed``).
"""
from __future__ import annotations

from copy import deepcopy

from sqlalchemy.ext.asyncio import AsyncSession

from src.models.buyer_tier import BUYER_TIERS, BuyerTierConfig
from src.runtime_config import ProcessConfigCache

CRITERIA = ("total_deposit", "total_spent")
NAME_MAX = 40
AMOUNT_MAX = 100_000_000_000
CASHBACK_MAX = 50.0
API_MAX = 100_000
# Per-IP flood guard of the public API (requests per minute, every tier).
IP_REQUESTS_DEFAULT = 500
IP_REQUESTS_MIN = 60
IP_REQUESTS_MAX = 10_000

# Client ladder in USD (0 / 1 000 / 5 000 $) at ~25 000 ₫ per dollar.
DEFAULT_CONFIG: dict = {
    "criterion": "total_spent",
    "ip_requests_per_minute": IP_REQUESTS_DEFAULT,
    "levels": {
        "l1": {"name_vi": "Thành viên", "name_en": "Member", "min_amount": 0, "cashback_percent": 0,
               "api_requests_per_minute": 30, "api_orders_per_minute": 20},
        "l2": {"name_vi": "Thân thiết", "name_en": "Loyal", "min_amount": 25_000_000, "cashback_percent": 1,
               "api_requests_per_minute": 100, "api_orders_per_minute": 60},
        "l3": {"name_vi": "VIP", "name_en": "VIP", "min_amount": 125_000_000, "cashback_percent": 3,
               "api_requests_per_minute": None, "api_orders_per_minute": None},
    },
}


def _number(name: str, value, low: float, high: float, *, integer: bool, nullable: bool = False):
    if value is None:
        if nullable:
            return None
        raise ValueError(f"{name} is required")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    if integer and float(value) != int(value):
        raise ValueError(f"{name} must be a whole number")
    if not (low <= value <= high):
        raise ValueError(f"{name} must be between {low:g} and {high:g}")
    return int(value) if integer else round(float(value), 2)


def _name(name: str, value) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} is required")
    value = value.strip()
    if len(value) > NAME_MAX:
        raise ValueError(f"{name} must be at most {NAME_MAX} characters")
    return value


def validate_config(raw: dict) -> dict:
    """Full settings document → normalised copy, or ValueError."""
    if not isinstance(raw, dict):
        raise ValueError("settings must be an object")
    criterion = raw.get("criterion")
    if criterion not in CRITERIA:
        raise ValueError(f"criterion must be one of {', '.join(CRITERIA)}")
    levels_raw = raw.get("levels") or {}
    levels: dict[str, dict] = {}
    for tier in BUYER_TIERS:
        item = levels_raw.get(tier)
        if not isinstance(item, dict):
            raise ValueError(f"levels.{tier} is required")
        levels[tier] = {
            "name_vi": _name(f"levels.{tier}.name_vi", item.get("name_vi")),
            "name_en": _name(f"levels.{tier}.name_en", item.get("name_en")),
            "min_amount": _number(f"levels.{tier}.min_amount", item.get("min_amount"), 0, AMOUNT_MAX, integer=True),
            "cashback_percent": _number(f"levels.{tier}.cashback_percent", item.get("cashback_percent"), 0, CASHBACK_MAX, integer=False),
            "api_requests_per_minute": _number(
                f"levels.{tier}.api_requests_per_minute", item.get("api_requests_per_minute"), 1, API_MAX,
                integer=True, nullable=True,
            ),
            "api_orders_per_minute": _number(
                f"levels.{tier}.api_orders_per_minute", item.get("api_orders_per_minute"), 1, API_MAX,
                integer=True, nullable=True,
            ),
        }
    if levels["l1"]["min_amount"] != 0:
        raise ValueError("levels.l1.min_amount must be 0 (every buyer starts at l1)")
    if not levels["l1"]["min_amount"] < levels["l2"]["min_amount"] < levels["l3"]["min_amount"]:
        raise ValueError("min_amount must increase from l1 to l3")
    ip_raw = raw.get("ip_requests_per_minute")
    ip_limit = _number(
        "ip_requests_per_minute", IP_REQUESTS_DEFAULT if ip_raw is None else ip_raw,
        IP_REQUESTS_MIN, IP_REQUESTS_MAX, integer=True,
    )
    return {"criterion": criterion, "ip_requests_per_minute": ip_limit, "levels": levels}


_cache: ProcessConfigCache[dict] = ProcessConfigCache("buyer_tier_config", ttl_seconds=30)


async def get_config(db: AsyncSession) -> dict:
    async def load() -> dict:
        row = await db.get(BuyerTierConfig, 1)
        return validate_config(row.settings) if row else deepcopy(DEFAULT_CONFIG)

    return await _cache.get_or_load(load)


def level_for(cfg: dict, value: int) -> str:
    """Highest level whose threshold ``value`` reaches."""
    tier = "l1"
    for key in BUYER_TIERS:
        if value >= cfg["levels"][key]["min_amount"]:
            tier = key
    return tier


def level_of(cfg: dict, tier: str | None) -> dict:
    return cfg["levels"].get(tier or "l1") or cfg["levels"]["l1"]


async def update_config(db: AsyncSession, raw: dict, *, actor_id: int, dry_run: bool = False) -> dict | None:
    from src.audit.service import log_event
    from src.logging import current_request_id

    cfg = validate_config(raw)
    row = await db.get(BuyerTierConfig, 1, with_for_update=True)
    old = validate_config(row.settings) if row else deepcopy(DEFAULT_CONFIG)
    if row is None:
        db.add(BuyerTierConfig(id=1, settings=cfg, updated_by_id=actor_id))
    else:
        row.settings = cfg
        row.updated_by_id = actor_id
    changed: dict = {}
    for key in ("criterion", "ip_requests_per_minute"):
        if old[key] != cfg[key]:
            changed[key] = [old[key], cfg[key]]
    for tier in BUYER_TIERS:
        for key, value in cfg["levels"][tier].items():
            before = old["levels"][tier].get(key)
            if before != value:
                changed[f"{tier}.{key}"] = [before, value]
    if dry_run:
        # Validated and staged on the row; the caller (config_approval) rolls back.
        return None
    await log_event(
        db, "warning" if changed else "info", "Buyer tier config updated",
        request_id=current_request_id(),
        metadata={
            "event": "buyer_tier_config_changed", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "buyer_tier_config", "subject_id": 1, "old": old, "new": cfg, "changed": changed,
            "outcome": "success", "source": "admin",
        },
    )
    await db.commit()
    _cache.invalidate()
    return cfg
