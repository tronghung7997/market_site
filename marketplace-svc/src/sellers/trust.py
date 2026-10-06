"""Seller trust score (0–100) and progress toward the next tier.

The score and the per-tier criteria are admin settings (`seller_trust_config`,
defaults below). Nothing here changes a tier: sellers see their progress, and
admins see who meets the next tier's criteria (or has slipped below the
"keep" criteria of their own) and change tiers by hand. Enterprise is by
invitation only, so it is never reported as reachable.

Only real orders count (``Order.is_seeded`` false), and only visible, real
reviews. Rates use a rolling window; GMV and order counts for the criteria
are lifetime totals of completed orders.
"""
from __future__ import annotations

import math
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.order import Dispute, Order, OrderStatus
from src.models.product import Product
from src.models.review import Review
from src.models.seller_tier_event import SellerTierEvent
from src.models.seller_trust_config import SellerTrustConfig
from src.runtime_config import ProcessConfigCache
from src.runtime_config.cache import KeyedProcessCache
from src.sellers.tiers import TIER_ORDER

# Tiers a seller can grow into by the numbers; enterprise is invite-only.
PROMOTABLE = ("verified", "trusted")
CRITERIA = ("min_gmv", "min_orders", "min_days", "max_dispute_pct", "max_one_star_pct", "min_score")
# Checked again for the tier a seller already holds.
KEEP_CRITERIA = ("max_dispute_pct", "max_one_star_pct", "min_score")

DEFAULT_CONFIG: dict = {
    "window_days": 90,
    "min_orders_for_score": 10,
    "score": {
        "dispute": {"points": 40, "zero_at_pct": 10},
        "one_star": {"points": 30, "zero_at_pct": 20},
        "gmv": {"points": 30, "full_at": 100_000_000},
    },
    "criteria": {
        "verified": {"min_gmv": 5_000_000, "min_orders": 20, "min_days": 14,
                     "max_dispute_pct": 5, "max_one_star_pct": 10, "min_score": 60},
        "trusted": {"min_gmv": 50_000_000, "min_orders": 200, "min_days": 60,
                    "max_dispute_pct": 3, "max_one_star_pct": 5, "min_score": 75},
        "enterprise": {"min_gmv": None, "min_orders": None, "min_days": None,
                       "max_dispute_pct": 2, "max_one_star_pct": 3, "min_score": 85},
    },
}

_BOUNDS = {
    "min_gmv": (0, 100_000_000_000), "min_orders": (0, 10_000_000), "min_days": (0, 3650),
    "max_dispute_pct": (0, 100), "max_one_star_pct": (0, 100), "min_score": (0, 100),
}


def _number(name: str, value, low: float, high: float, *, nullable: bool = False):
    if value is None:
        if nullable:
            return None
        raise ValueError(f"{name} is required")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number")
    if not (low <= value <= high):
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


def validate_config(raw: dict) -> dict:
    """Full settings document → normalised copy, or ValueError."""
    cfg: dict = {
        "window_days": int(_number("window_days", raw.get("window_days"), 7, 365)),
        "min_orders_for_score": int(_number("min_orders_for_score", raw.get("min_orders_for_score"), 0, 10_000)),
        "score": {},
        "criteria": {},
    }
    score = raw.get("score") or {}
    for part, limit_key, bounds in (("dispute", "zero_at_pct", (0.1, 100)), ("one_star", "zero_at_pct", (0.1, 100)),
                                    ("gmv", "full_at", (1, 100_000_000_000))):
        item = score.get(part) or {}
        cfg["score"][part] = {
            "points": int(_number(f"score.{part}.points", item.get("points"), 0, 100)),
            limit_key: _number(f"score.{part}.{limit_key}", item.get(limit_key), *bounds),
        }
    total = sum(item["points"] for item in cfg["score"].values())
    if total != 100:
        raise ValueError(f"score points must add up to 100 (got {total})")
    criteria = raw.get("criteria") or {}
    for tier in ("verified", "trusted", "enterprise"):
        item = criteria.get(tier) or {}
        cfg["criteria"][tier] = {
            key: _number(f"criteria.{tier}.{key}", item.get(key), *_BOUNDS[key], nullable=True) for key in CRITERIA
        }
    return cfg


# --------------------------------------------------------------------------- pure maths


@dataclass(frozen=True)
class Metrics:
    gmv_lifetime: int
    orders_lifetime: int
    days_selling: int
    orders_window: int
    disputes_window: int
    reviews_window: int
    one_star_window: int
    gmv_window: int
    completed_window: int

    @property
    def dispute_pct(self) -> float:
        return 100 * self.disputes_window / self.orders_window if self.orders_window else 0.0

    @property
    def one_star_pct(self) -> float:
        return 100 * self.one_star_window / self.reviews_window if self.reviews_window else 0.0


def score_parts(m: Metrics, cfg: dict) -> dict[str, float]:
    s = cfg["score"]
    dispute = s["dispute"]["points"] * max(0.0, 1 - m.dispute_pct / s["dispute"]["zero_at_pct"])
    one_star = s["one_star"]["points"] * max(0.0, 1 - m.one_star_pct / s["one_star"]["zero_at_pct"])
    # Log scale in millions of ₫ (as the design's worked example): 12.5M of a
    # 100M target is ~57 %, while a raw-₫ log would give 1M already ~75 %.
    full_at = s["gmv"]["full_at"] / 1_000_000
    gmv = s["gmv"]["points"] * min(1.0, math.log1p(max(0, m.gmv_window) / 1_000_000) / math.log1p(full_at))
    return {"dispute": dispute, "one_star": one_star, "gmv": gmv}


def trust_score(m: Metrics, cfg: dict) -> int | None:
    """None until the seller has enough completed orders in the window."""
    if m.completed_window < cfg["min_orders_for_score"]:
        return None
    # Whole points per part, so the breakdown a seller sees adds up to the total.
    return sum(round(part) for part in score_parts(m, cfg).values())


def _value(key: str, m: Metrics, score: int | None):
    return {
        "min_gmv": m.gmv_lifetime, "min_orders": m.orders_lifetime, "min_days": m.days_selling,
        "max_dispute_pct": round(m.dispute_pct, 2), "max_one_star_pct": round(m.one_star_pct, 2), "min_score": score,
    }[key]


def check_criteria(tier: str, m: Metrics, score: int | None, cfg: dict, *, keep_only: bool = False) -> list[dict]:
    """One row per configured criterion of ``tier``. ``met`` is None for a
    score criterion while the score is not available yet (it is then skipped)."""
    rows = []
    for key, target in cfg["criteria"].get(tier, {}).items():
        if target is None or (keep_only and key not in KEEP_CRITERIA):
            continue
        value = _value(key, m, score)
        if value is None:
            met = None
        elif key.startswith("max_"):
            met = value <= target
        else:
            met = value >= target
        rows.append({"key": key, "value": value, "target": target, "met": met, "keep": key in KEEP_CRITERIA})
    return rows


def next_tier(tier: str) -> str | None:
    index = TIER_ORDER.index(tier) if tier in TIER_ORDER else 0
    return TIER_ORDER[index + 1] if index + 1 < len(TIER_ORDER) else None


def evaluate(tier: str, m: Metrics, cfg: dict) -> dict:
    score = trust_score(m, cfg)
    target = next_tier(tier)
    criteria = check_criteria(target, m, score, cfg) if target else []
    promotable = target in PROMOTABLE
    at_risk = [row for row in check_criteria(tier, m, score, cfg, keep_only=True) if row["met"] is False] if tier in cfg["criteria"] else []
    return {
        "tier": tier,
        "score": score,
        "score_parts": {k: round(v) for k, v in score_parts(m, cfg).items()} if score is not None else None,
        "next_tier": target,
        "next_tier_promotable": promotable,
        "criteria": criteria,
        "met": sum(1 for row in criteria if row["met"] is not False),
        "eligible": bool(target and promotable and criteria and all(row["met"] is not False for row in criteria)),
        "at_risk": at_risk,
    }


def public_bands(m: Metrics, score: int | None) -> dict:
    """What buyers see: the score and coarse rate bands, never raw counts."""
    if score is None:
        return {"trust_score": None, "dispute_band": None, "one_star_band": None}

    def band(pct: float, low: float, high: float) -> str:
        return "low" if pct < low else "medium" if pct < high else "high"

    return {
        "trust_score": score,
        "dispute_band": band(m.dispute_pct, 2, 5),
        "one_star_band": band(m.one_star_pct, 5, 10),
    }


# --------------------------------------------------------------------------- storage

_config_cache: ProcessConfigCache[dict] = ProcessConfigCache("seller_trust_config", ttl_seconds=30)
_metrics_cache: KeyedProcessCache[int, dict] = KeyedProcessCache("seller_trust_metrics", ttl_seconds=600, max_entries=4096)


async def get_config(db: AsyncSession) -> dict:
    cached = _config_cache.get()
    if cached is not None:
        return cached
    row = await db.get(SellerTrustConfig, 1)
    cfg = validate_config(row.settings) if row else deepcopy(DEFAULT_CONFIG)
    _config_cache.set(cfg)
    return cfg


async def update_config(db: AsyncSession, raw: dict, *, actor_id: int) -> dict:
    from src.audit.service import log_event
    from src.logging import current_request_id

    cfg = validate_config(raw)
    row = await db.get(SellerTrustConfig, 1, with_for_update=True)
    old = row.settings if row else deepcopy(DEFAULT_CONFIG)
    if row is None:
        row = SellerTrustConfig(id=1, settings=cfg, updated_by_id=actor_id)
        db.add(row)
    else:
        row.settings = cfg
        row.updated_by_id = actor_id
    await log_event(
        db, "warning", "Seller trust config updated",
        request_id=current_request_id(),
        metadata={
            "event": "seller_trust_config_changed", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "seller_trust_config", "subject_id": 1, "old": old, "new": cfg,
            "outcome": "success", "source": "admin",
        },
    )
    await db.commit()
    _config_cache.invalidate()
    _metrics_cache.invalidate()
    return cfg


REACHED = (OrderStatus.delivered, OrderStatus.completed, OrderStatus.disputed, OrderStatus.refunded)


async def load_metrics(seller_id: int, db: AsyncSession, *, window_days: int, now: datetime | None = None) -> Metrics:
    """Every figure in one statement: a single FILTERed pass over the seller's
    real orders, plus one-row subqueries for disputes, reviews and the start date."""
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=window_days)
    net = Order.total_amount - Order.refunded_amount
    completed = Order.status == OrderStatus.completed
    recent = Order.created_at >= since
    orders = (
        select(
            func.coalesce(func.sum(net).filter(completed), 0).label("gmv_lifetime"),
            func.count(Order.id).filter(completed).label("orders_lifetime"),
            func.coalesce(func.sum(net).filter(completed, recent), 0).label("gmv_window"),
            func.count(Order.id).filter(completed, recent).label("completed_window"),
            func.count(Order.id).filter(Order.status.in_(REACHED), recent).label("orders_window"),
        )
        .where(Order.seller_id == seller_id, Order.is_seeded.is_(False))
        .subquery("metric_orders")
    )
    disputed = aliased(Order)
    disputes = (
        select(func.count(func.distinct(Dispute.order_id)).label("disputes_window"))
        .join(disputed, disputed.id == Dispute.order_id)
        .where(disputed.seller_id == seller_id, disputed.is_seeded.is_(False), disputed.created_at >= since)
        .subquery("metric_disputes")
    )
    reviews = (
        select(
            func.count(Review.id).label("reviews_window"),
            func.count(Review.id).filter(Review.rating == 1).label("one_star_window"),
        )
        .join(Product, Product.id == Review.product_id)
        .where(
            Product.seller_id == seller_id, Review.is_hidden.is_(False), Review.is_seeded.is_(False),
            Review.created_at >= since,
        )
        .subquery("metric_reviews")
    )
    # Selling since the first approved application, else the first product.
    started = func.coalesce(
        select(func.min(SellerApplication.created_at)).where(
            SellerApplication.account_id == seller_id, SellerApplication.status == ApplicationStatus.approved,
        ).scalar_subquery(),
        select(func.min(Product.created_at)).where(Product.seller_id == seller_id).scalar_subquery(),
    ).label("started")
    # Each subquery yields exactly one row; the joins only line them up.
    row = (await db.execute(
        select(orders, disputes, reviews, started)
        .select_from(orders.join(disputes, true()).join(reviews, true()))
    )).one()
    days_selling = max(0, (now - row.started).days) if row.started else 0
    return Metrics(
        gmv_lifetime=int(row.gmv_lifetime or 0), orders_lifetime=int(row.orders_lifetime or 0),
        days_selling=days_selling,
        orders_window=int(row.orders_window or 0), disputes_window=int(row.disputes_window or 0),
        reviews_window=int(row.reviews_window or 0), one_star_window=int(row.one_star_window or 0),
        gmv_window=int(row.gmv_window or 0), completed_window=int(row.completed_window or 0),
    )


def _tier_of(account: Account) -> str:
    tier = account.seller_tier
    return tier.value if hasattr(tier, "value") else str(tier or "new")


async def seller_progress(account: Account, db: AsyncSession) -> dict:
    cfg = await get_config(db)
    m = await load_metrics(account.id, db, window_days=cfg["window_days"])
    result = evaluate(_tier_of(account), m, cfg)
    return {
        **result,
        "window_days": cfg["window_days"],
        "min_orders_for_score": cfg["min_orders_for_score"],
        "score_points": {part: cfg["score"][part]["points"] for part in cfg["score"]},
        "metrics": {
            "gmv_lifetime": m.gmv_lifetime, "orders_lifetime": m.orders_lifetime, "days_selling": m.days_selling,
            "orders_window": m.orders_window, "disputes_window": m.disputes_window,
            "reviews_window": m.reviews_window, "one_star_window": m.one_star_window,
            "gmv_window": m.gmv_window, "completed_window": m.completed_window,
        },
    }


async def public_trust(seller_id: int, db: AsyncSession) -> dict:
    cached = _metrics_cache.get(seller_id)
    if cached is not None:
        return cached
    cfg = await get_config(db)
    m = await load_metrics(seller_id, db, window_days=cfg["window_days"])
    bands = public_bands(m, trust_score(m, cfg))
    _metrics_cache.set(seller_id, bands)
    return bands


async def seeded_order_count(seller_id: int, db: AsyncSession) -> int:
    return int(await db.scalar(
        select(func.count(Order.id)).where(Order.seller_id == seller_id, Order.is_seeded.is_(True))
    ) or 0)


async def tier_history(seller_id: int, db: AsyncSession, *, limit: int = 50) -> list[dict]:
    """Newest first: every tier change with its reason and the acting admin."""
    actor = aliased(Account)
    rows = (await db.execute(
        select(SellerTierEvent, actor.email)
        .outerjoin(actor, actor.id == SellerTierEvent.actor_id)
        .where(SellerTierEvent.account_id == seller_id)
        .order_by(SellerTierEvent.created_at.desc(), SellerTierEvent.id.desc())
        .limit(limit)
    )).all()
    return [
        {"old_tier": e.old_tier, "new_tier": e.new_tier, "reason": e.reason, "actor_email": email, "created_at": e.created_at}
        for e, email in rows
    ]


async def review_queue(db: AsyncSession) -> list[dict]:
    """Every active seller with their evaluation, eligible and at-risk first."""
    from src.sellers.service import approved_business_names

    cfg = await get_config(db)
    sellers = list((await db.scalars(
        select(Account).where(Account.is_active.is_(True), Account.roles.any("seller"))
    )).all())
    names = await approved_business_names([s.id for s in sellers], db)
    rows = []
    for account in sellers:
        m = await load_metrics(account.id, db, window_days=cfg["window_days"])
        result = evaluate(_tier_of(account), m, cfg)
        rows.append({
            "account_id": account.id,
            "public_key": account.public_key,
            "name": names.get(account.id) or (account.email or "").split("@", 1)[0],
            **{k: result[k] for k in ("tier", "score", "next_tier", "next_tier_promotable", "criteria", "met", "eligible", "at_risk")},
            "orders_lifetime": m.orders_lifetime,
            "gmv_lifetime": m.gmv_lifetime,
        })
    rows.sort(key=lambda r: (not r["eligible"], not r["at_risk"], -(r["score"] or -1)))
    return rows
