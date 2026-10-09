"""Who a new or existing account is attributed to as a referral.

Two entry points, both called inside their caller's transaction:

- ``resolve_signup_referrer`` (``auth.register_account``): a ``?ref=`` sign-up
  counts only inside the admin's ``attribution_days`` window. The window
  starts at the newest click the server recorded for this visitor (the
  ``aff_vid`` id the storefront sends, else the sign-up IP); only when no
  click was recorded (e.g. the click beacon was blocked) does the landing time
  the storefront kept in its cookie stand in. Without either, the code is
  ignored.
- ``attribute_via_promotion`` (``promotions.record_redemption``): a buyer who
  has no referrer yet and orders with a KOL-linked promo code becomes that
  KOL's referral from that moment. An existing referrer is never replaced.

Kept apart from ``affiliate.service`` so auth and promotions depend on a small
module with no wallet/fee imports.
"""
from __future__ import annotations

import ipaddress
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account
from src.models.affiliate import AffiliateClick

from .settings import get_affiliate_settings

logger = structlog.get_logger()

# Clicks are deduplicated per visitor for 24 h (``service.record_click``), so
# the newest recorded click can be up to that much older than the visitor's
# newest landing; the window is widened by the same amount for server clicks.
CLICK_DEDUP_WINDOW = timedelta(hours=24)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def is_public_ip(value: str | None) -> bool:
    if not value:
        return False
    try:
        ip = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    return bool(ip.is_global)


def same_public_ip(a: Account, b: Account) -> bool:
    """Both accounts signed up from the same public IP (self-referral guard)."""
    return (
        is_public_ip(a.registration_ip)
        and is_public_ip(b.registration_ip)
        and a.registration_ip == b.registration_ip
    )


async def resolve_signup_referrer(
    db: AsyncSession,
    code: str | None,
    *,
    visitor_id: str | None = None,
    clicked_at: datetime | None = None,
    ip: str | None = None,
    now: datetime | None = None,
) -> int | None:
    """Referrer id for a sign-up carrying ``code``, or None when the code is
    unknown or its attribution window has passed."""
    if not code:
        return None
    referrer = await db.scalar(select(Account).where(Account.affiliate_code == code))
    if referrer is None:
        return None
    now = now or datetime.now(timezone.utc)
    window = timedelta(days=int((await get_affiliate_settings(db))["attribution_days"]))

    identities = []
    if visitor_id:
        identities.append(AffiliateClick.visitor_id == visitor_id)
    if ip:
        identities.append(AffiliateClick.ip == ip)
    last_click = None
    if identities:
        last_click = await db.scalar(
            select(func.max(AffiliateClick.created_at)).where(
                AffiliateClick.affiliate_account_id == referrer.id, or_(*identities),
            )
        )
    if last_click is not None:
        if _aware(last_click) >= now - window - CLICK_DEDUP_WINDOW:
            return referrer.id
        reason = "expired"
    elif clicked_at is not None:
        landed = min(_aware(clicked_at), now)
        if landed >= now - window:
            return referrer.id
        reason = "expired"
    else:
        reason = "no_click"
    logger.info("affiliate_signup_attribution_skipped", referrer_id=referrer.id, reason=reason)
    return None


async def attribute_via_promotion(
    db: AsyncSession, *, buyer_id: int, affiliate_id: int, promotion_id: int,
) -> bool:
    """Make ``affiliate_id`` the referrer of a buyer who has none yet.

    A conditional update, so two concurrent orders with different KOL codes
    cannot both attribute the buyer: the first commit wins. Self-referral
    (own code, or both accounts signed up from one public IP) never
    attributes. Returns whether the buyer was attributed."""
    if buyer_id == affiliate_id:
        return False
    buyer = await db.get(Account, buyer_id)
    affiliate = await db.get(Account, affiliate_id)
    if buyer is None or affiliate is None or buyer.referred_by_id is not None:
        return False
    if buyer.is_seeded or same_public_ip(buyer, affiliate):
        return False
    result = await db.execute(
        update(Account)
        .where(Account.id == buyer_id, Account.referred_by_id.is_(None))
        .values(referred_by_id=affiliate_id, referred_at=func.now(), referred_via_promotion_id=promotion_id)
        .execution_options(synchronize_session="fetch")
    )
    attributed = result.rowcount == 1
    if attributed:
        logger.info(
            "affiliate_attributed_via_promotion",
            buyer_id=buyer_id, affiliate_id=affiliate_id, promotion_id=promotion_id,
        )
    return attributed
