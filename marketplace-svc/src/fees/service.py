"""Effective money rules for one order / one withdrawal.

Everything money-related reads through here instead of `settings` so the
admin's Settings › Fees & holds page is the single source of truth.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.fees.settings import get_fee_settings
from src.models.order import Order
from src.models.product import Product, ProductVariant
from src.sellers.tiers import escrow_days as tier_escrow_days, fee_discount_pp


def _lookup(mapping: dict, category_id: int | None) -> float | None:
    if category_id is None:
        return None
    value = mapping.get(str(category_id))
    return None if value is None else float(value)


async def platform_fee_percent_for(db: AsyncSession, *, seller_tier: str, category_id: int | None) -> float:
    """Category override (else the platform default) minus the seller-tier discount, never below 0."""
    cfg = await get_fee_settings(db)
    base = _lookup(cfg["category_fee_percent"], category_id)
    if base is None:
        base = float(cfg["platform_fee_percent"])
    return max(0.0, base - fee_discount_pp(seller_tier))


async def escrow_days_for(db: AsyncSession, *, seller_tier: str, product_escrow_days: int, category_id: int | None) -> int:
    """Seller's product setting shortened by tier, but never under the admin's floor."""
    cfg = await get_fee_settings(db)
    floor = _lookup(cfg["category_escrow_min_days"], category_id)
    floor_days = int(floor) if floor is not None else int(cfg["escrow_min_days"])
    return max(tier_escrow_days(seller_tier, product_escrow_days), floor_days)


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
    """The fee percentage an order settles at: its product's category rule
    (or the platform default) minus the seller's tier discount."""
    return await platform_fee_percent_for(db, seller_tier=seller_tier, category_id=await order_category_id(order, db))


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
