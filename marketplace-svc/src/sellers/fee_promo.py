"""Per-seller fee promo: "<x> % fee until <date>" or open-ended (+ optional display badge).

Admins grant it from the seller's account page: any fee from 0 to 100 %, for
a number of days (default 90), until a chosen date, or with no end date (a
standing "phí riêng" for that seller, until changed or revoked). While it runs, ``fees.service`` settles the
seller's orders at the promo rate instead of the category / tier / platform
rule, and ``badge_tier`` (verified = Pro, trusted = Elite + blue tick) is shown
next to the seller's name when it ranks above their real tier. A dated promo
ends by itself at ``ends_at``; nothing has to run. Granting, changing and revoking
are audit-logged (event ``seller_fee_promo_changed``).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.logging import current_request_id
from src.models.account import Account
from src.models.seller_fee_promo import SellerFeePromo
from src.sellers.tiers import TIER_ORDER

DEFAULT_DAYS = 90
MAX_DAYS = 3650
BADGE_TIERS = ("verified", "trusted")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def promo_dict(promo: SellerFeePromo | None, *, now: datetime | None = None) -> dict | None:
    if promo is None:
        return None
    now = now or _now()
    return {
        "fee_percent": float(promo.fee_percent),
        "starts_at": promo.starts_at,
        "ends_at": promo.ends_at,
        "badge_tier": promo.badge_tier,
        "note": promo.note,
        "active": _runs(promo, now),
    }


def _runs(promo: SellerFeePromo, at: datetime) -> bool:
    return promo.starts_at <= at and (promo.ends_at is None or at < promo.ends_at)


async def active_fee_promo(db: AsyncSession, seller_id: int, *, at: datetime | None = None) -> SellerFeePromo | None:
    """The seller's promo if it runs at ``at`` (default now)."""
    promo = await db.get(SellerFeePromo, seller_id)
    if promo is None:
        return None
    at = at or _now()
    return promo if _runs(promo, at) else None


async def promo_badge_tiers(db: AsyncSession, seller_ids: list[int] | set[int]) -> dict[int, str]:
    """``{seller_id: badge tier}`` of running promos that carry a badge."""
    ids = {i for i in seller_ids if i is not None}
    if not ids:
        return {}
    now = _now()
    rows = (await db.execute(
        select(SellerFeePromo.account_id, SellerFeePromo.badge_tier).where(
            SellerFeePromo.account_id.in_(ids),
            SellerFeePromo.badge_tier.is_not(None),
            SellerFeePromo.starts_at <= now,
            or_(SellerFeePromo.ends_at.is_(None), SellerFeePromo.ends_at > now),
        )
    )).all()
    return {account_id: badge for account_id, badge in rows}


def display_tier(real_tier: str | None, promo_badge: str | None) -> str:
    """The tier whose badge is shown: the real one, or the promo badge when it ranks higher."""
    tier = real_tier or "new"
    if promo_badge in BADGE_TIERS and TIER_ORDER.index(promo_badge) > (TIER_ORDER.index(tier) if tier in TIER_ORDER else 0):
        return promo_badge
    return tier


async def _seller(db: AsyncSession, account_id: int) -> Account:
    account = await db.get(Account, account_id)
    if account is None or "seller" not in (account.roles or []):
        raise LookupError("seller not found")
    return account


async def grant_fee_promo(
    db: AsyncSession,
    *,
    account_id: int,
    actor_id: int,
    fee_percent: float = 0.0,
    days: int | None = None,
    ends_at: datetime | None = None,
    open_ended: bool = False,
    badge_tier: str | None = None,
    note: str | None = None,
) -> dict:
    """Create or replace the seller's promo. ``open_ended`` (no end date) wins
    over ``ends_at``, which wins over ``days`` (default 90). Applies at once.
    Raises LookupError (no such seller) or ValueError."""
    await _seller(db, account_id)
    if isinstance(fee_percent, bool) or not isinstance(fee_percent, (int, float)) or not 0 <= fee_percent <= 100:
        raise ValueError("fee_percent must be between 0 and 100")
    if badge_tier is not None and badge_tier not in BADGE_TIERS:
        raise ValueError("badge_tier must be verified or trusted")
    now = _now()
    if open_ended:
        ends_at = None
    elif ends_at is None:
        days = DEFAULT_DAYS if days is None else days
        if not 1 <= days <= MAX_DAYS:
            raise ValueError(f"days must be between 1 and {MAX_DAYS}")
        ends_at = now + timedelta(days=days)
    else:
        if ends_at.tzinfo is None:
            ends_at = ends_at.replace(tzinfo=timezone.utc)
        if ends_at <= now or ends_at > now + timedelta(days=MAX_DAYS):
            raise ValueError("ends_at must be in the future (at most 10 years)")
    note = (note or "").strip()[:500] or None

    promo = await db.get(SellerFeePromo, account_id, with_for_update=True)
    old = promo_dict(promo, now=now)
    if promo is None:
        promo = SellerFeePromo(account_id=account_id)
        db.add(promo)
    promo.fee_percent = round(float(fee_percent), 2)
    promo.starts_at = now
    promo.ends_at = ends_at
    promo.badge_tier = badge_tier
    promo.note = note
    promo.granted_by_id = actor_id
    new = promo_dict(promo, now=now)
    await db.flush()
    await _audit(db, account_id, actor_id, old, new)
    from src.notifications.history import notify
    await notify(
        db, account_id, "seller_fee_promo", category="system",
        params={"fee_percent": new["fee_percent"], **({"ends_at": ends_at.isoformat()} if ends_at else {})},
        href="/seller/tier",
    )
    await db.commit()
    return promo_dict(await db.get(SellerFeePromo, account_id))


async def revoke_fee_promo(db: AsyncSession, *, account_id: int, actor_id: int) -> None:
    await _seller(db, account_id)
    promo = await db.get(SellerFeePromo, account_id, with_for_update=True)
    if promo is None:
        return
    old = promo_dict(promo)
    await db.delete(promo)
    await db.flush()
    await _audit(db, account_id, actor_id, old, None)
    await db.commit()


async def _audit(db: AsyncSession, account_id: int, actor_id: int, old: dict | None, new: dict | None) -> None:
    def clean(value: dict | None) -> dict | None:
        if value is None:
            return None
        return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in value.items() if k != "active"}

    await log_event(
        db, "warning", f"Seller fee promo {'granted' if new else 'revoked'} for account {account_id}",
        request_id=current_request_id(),
        metadata={
            "event": "seller_fee_promo_changed", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "account", "subject_id": account_id,
            "old": clean(old), "new": clean(new), "outcome": "success", "source": "admin",
        },
    )
