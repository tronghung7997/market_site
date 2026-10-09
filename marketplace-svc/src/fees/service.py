"""Effective money rules for one order / one withdrawal.

Everything money-related reads through here instead of `settings` so the
admin's Settings › Fees & holds page is the single source of truth.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error
from src.fees.settings import get_fee_settings
from src.models.account import Account
from src.models.order import Order
from src.models.product import Product, ProductVariant
from src.sellers.fee_promo import active_fee_promo
from src.sellers.tier_config import rule_for
from src.sellers.tiers import escrow_hours as tier_escrow_hours


def _lookup(mapping: dict, category_id: int | None) -> float | None:
    if category_id is None:
        return None
    value = mapping.get(str(category_id))
    return None if value is None else float(value)


async def platform_fee_percent_for(
    db: AsyncSession,
    *,
    seller_tier: str,
    category_id: int | None,
    seller_id: int | None = None,
    at: datetime | None = None,
) -> float:
    """The platform fee % for a sale, first rule that applies:

    1. the seller's fee promo, while it runs at ``at`` (default now) —
       e.g. the 0 % onboarding offer (``seller_fee_promos``);
    2. the category's fee, when the admin set one: a category surcharge or
       discount applies to every tier alike;
    3. the seller tier's absolute fee (``seller_tier_config.fee_percent``);
    4. the platform default (Settings › Fees & holds).
    """
    if seller_id is not None:
        promo = await active_fee_promo(db, seller_id, at=at)
        if promo is not None:
            return float(promo.fee_percent)
    cfg = await get_fee_settings(db)
    category_fee = _lookup(cfg["category_fee_percent"], category_id)
    if category_fee is not None:
        return category_fee
    tier_fee = (await rule_for(db, seller_tier)).fee_percent
    if tier_fee is not None:
        return float(tier_fee)
    return float(cfg["platform_fee_percent"])


async def escrow_hours_for(db: AsyncSession, *, seller_tier: str, product_escrow_hours: int, category_id: int | None) -> int:
    """Seller's product hold (hours) shortened by tier, but never under the
    platform hold floor (``escrow_floor_hours``) nor the admin's minimum
    (the category's, else the global ``escrow_min_hours``)."""
    cfg = await get_fee_settings(db)
    floor = _lookup(cfg["category_escrow_min_hours"], category_id)
    min_hours = int(floor) if floor is not None else int(cfg["escrow_min_hours"])
    reduction = (await rule_for(db, seller_tier)).escrow_reduction_hours
    held = tier_escrow_hours(
        seller_tier, product_escrow_hours, reduction_hours=reduction, floor_hours=int(cfg["escrow_floor_hours"]),
    )
    return max(held, min_hours)


async def check_product_hold(db: AsyncSession, hours: int | None, *, current: int | None = None) -> None:
    """A seller may not pick a product hold under the platform floor. A value
    left as it was (set before the floor was raised) is accepted; orders
    still hold at least the floor (``escrow_hours_for``)."""
    if hours is None or hours == current:
        return
    floor = int((await get_fee_settings(db))["escrow_floor_hours"])
    if hours < floor:
        raise api_error(ErrorCode.ESCROW_BELOW_FLOOR, status.HTTP_422_UNPROCESSABLE_CONTENT, floor=floor)


async def escrow_until(
    db: AsyncSession, *, seller_tier: str, product: Product | None, fallback_hours: int = 48,
) -> datetime:
    """When the hold of an order delivered now ends (`Order.escrow_expires_at`)."""
    hours = await escrow_hours_for(
        db, seller_tier=seller_tier,
        product_escrow_hours=product.escrow_hours if product else fallback_hours,
        category_id=product.category_id if product else None,
    )
    return datetime.now(timezone.utc) + timedelta(hours=hours)


async def buyer_escrow_hours(products: list[Product], db: AsyncSession) -> dict[int, int]:
    """``{product_id: hours}`` of buyer protection an order placed now gets —
    the same rule ``create_order`` applies (tier, category floor, tier never
    under one day) — so the storefront never promises the raw product setting."""
    if not products:
        return {}
    seller_ids = {p.seller_id for p in products}
    tiers = dict((await db.execute(
        select(Account.id, Account.seller_tier).where(Account.id.in_(seller_ids))
    )).all())
    out: dict[int, int] = {}
    for product in products:
        tier = tiers.get(product.seller_id)
        out[product.id] = await escrow_hours_for(
            db,
            seller_tier=getattr(tier, "value", tier) or "new",
            product_escrow_hours=product.escrow_hours,
            category_id=product.category_id,
        )
    return out


async def order_category_id(order: Order, db: AsyncSession) -> int | None:
    if order.product_id is not None:
        return await db.scalar(select(Product.category_id).where(Product.id == order.product_id))
    if order.variant_id is not None:
        return await db.scalar(
            select(Product.category_id).join(ProductVariant, ProductVariant.product_id == Product.id)
            .where(ProductVariant.id == order.variant_id)
        )
    return None


async def order_fee_percent(order: Order, seller_tier: str, db: AsyncSession) -> float:
    """The fee percentage an order settles at, decided at settlement time
    (``platform_fee_percent_for``: seller promo → category → tier → platform
    default). The settlement books the resulting amount as the order's
    ``platform_fee`` transaction, which is the fee's record.

    Internal (platform-run) sellers settle at 0%: the platform already owns
    the whole sale, and a fee would only move money between two platform
    accounts. Affiliate commission is a share of this fee, so it is 0 on
    internal-seller orders too (src/affiliate/service.py)."""
    seller = await db.get(Account, order.seller_id) if order.seller_id is not None else None
    if seller is not None and seller.is_internal:
        return 0.0
    return await platform_fee_percent_for(
        db, seller_tier=seller_tier, category_id=await order_category_id(order, db), seller_id=order.seller_id,
    )


def withdraw_fee_amount(amount: int, cfg: dict) -> int:
    """Fixed + percentage, capped so the payout can never go negative."""
    fee = int(cfg["withdraw_fee_fixed"]) + int(amount * float(cfg["withdraw_fee_percent"]) / 100)
    return max(0, min(fee, amount))


async def withdraw_quote(db: AsyncSession, amount: int) -> dict:
    cfg = await get_fee_settings(db)
    fee = withdraw_fee_amount(amount, cfg)
    return {
        "amount": amount, "fee_amount": fee, "net_amount": amount - fee,
        "min_amount": int(cfg["withdraw_min_amount"]),
        "fee_fixed": int(cfg["withdraw_fee_fixed"]), "fee_percent": float(cfg["withdraw_fee_percent"]),
    }
