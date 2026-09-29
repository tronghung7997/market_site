"""When a seller's escrowed money is due to reach their wallet.

Delivered orders release at ``escrow_expires_at`` unless the buyer opens a
dispute first (``scheduler.escrow_release_job``). This module groups those
orders by the seller's local calendar day and estimates the payout with the
same fee rule the release job applies (``fees.service`` category rule minus the
tier discount; 0 % for internal sellers). The estimate can still move: a
dispute, a partial refund or a fee change before the release date all change
what is actually credited.

Seeded (trust-seed) orders never touch a wallet and are left out.
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import status as http_status
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error
from src.fees.service import platform_fee_percent_for
from src.models.account import Account
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.wallet.service import escrow_settlement, promo_subsidy

AWAITING_DELIVERY_STATUSES = (OrderStatus.pending, OrderStatus.processing)
IN_ESCROW_STATUSES = (OrderStatus.delivered, OrderStatus.disputed)


def _zone(tz: str | None) -> ZoneInfo:
    try:
        return ZoneInfo((tz or "UTC").strip())
    except (ZoneInfoNotFoundError, ValueError):
        raise api_error(ErrorCode.DASHBOARD_RANGE_INVALID, http_status.HTTP_400_BAD_REQUEST, detail="Múi giờ không hợp lệ")


def _bucket() -> dict:
    return {"order_count": 0, "gross": 0, "fee": 0, "net": 0}


def _add(bucket: dict, gross: int, fee: int) -> None:
    bucket["order_count"] += 1
    bucket["gross"] += gross
    bucket["fee"] += fee
    bucket["net"] += gross - fee


async def get_escrow_schedule(seller_id: int, tz: str | None, db: AsyncSession, *, now: datetime | None = None) -> dict:
    zone = _zone(tz)
    now = now or datetime.now(timezone.utc)
    seller = await db.get(Account, seller_id)
    tier = str(getattr(getattr(seller, "seller_tier", None), "value", getattr(seller, "seller_tier", None)) or "new")
    internal = bool(seller and seller.is_internal)

    open_dispute = exists().where(Dispute.order_id == Order.id, Dispute.status == DisputeStatus.open)
    product_id = func.coalesce(Order.product_id, ProductVariant.product_id)
    rows = (await db.execute(
        select(
            Order.status, Order.total_amount, Order.refunded_amount, Order.discount_amount, Order.escrow_expires_at,
            Product.category_id, open_dispute.label("disputed"),
        )
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .outerjoin(Product, Product.id == product_id)
        .where(
            Order.seller_id == seller_id,
            Order.is_seeded.is_(False),
            Order.status.in_(AWAITING_DELIVERY_STATUSES + IN_ESCROW_STATUSES),
        )
    )).all()

    fee_by_category: dict[int | None, float] = {}

    async def fee_percent(category_id: int | None) -> float:
        if internal:
            return 0.0
        if category_id not in fee_by_category:
            fee_by_category[category_id] = await platform_fee_percent_for(db, seller_tier=tier, category_id=category_id)
        return fee_by_category[category_id]

    today = now.astimezone(zone).date()
    days: dict[str, dict] = {}
    held = _bucket()
    awaiting = _bucket()
    no_deadline = _bucket()
    in_escrow = _bucket()
    for status, total_amount, refunded_amount, discount, expires_at, category_id, disputed in rows:
        gross, fee = escrow_settlement(total_amount, refunded_amount, await fee_percent(category_id))
        # A promo order settles at list price: the platform adds the discount.
        share, share_fee = promo_subsidy(discount, total_amount, gross, fee)
        gross, fee = gross + share, fee + share_fee
        if status in AWAITING_DELIVERY_STATUSES:
            _add(awaiting, gross, fee)
            continue
        if disputed or status == OrderStatus.disputed:
            _add(held, gross, fee)
            continue
        _add(in_escrow, gross, fee)
        if expires_at is None:
            # Legacy delivered orders without a deadline settle only when the buyer confirms.
            _add(no_deadline, gross, fee)
            continue
        # Past-due rows are waiting for the next run of the release job.
        day = max(expires_at.astimezone(zone).date(), today).isoformat()
        _add(days.setdefault(day, _bucket()), gross, fee)

    return {
        "tz": str(zone.key),
        "days": [{"date": day, **days[day]} for day in sorted(days)],
        "in_escrow": in_escrow,
        "held_by_dispute": held,
        "awaiting_delivery": awaiting,
        "no_deadline": no_deadline,
    }
