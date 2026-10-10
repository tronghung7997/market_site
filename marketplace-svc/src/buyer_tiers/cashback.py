"""Buyer-tier cashback: a % of what the buyer paid, credited to their
available balance when the order settles.

Paid inside the settlement transaction (escrow job, buyer confirm, admin
release, dispute settlement), next to the affiliate commission, and only for
a clean sale: the order is ``completed`` with nothing refunded. Seeded/test
orders and self-purchases never earn it. The rate is the buyer's tier rate
at settlement. Idempotent per order (``buyer_cashbacks.order_id`` is unique
and the ledger row is unique per type and ``order-<id>``).

The platform funds it: like ``promo_subsidy`` the ``cashback`` transaction is
money entering the books (ledger reconcile ``_SOURCE_IN``). If the order is
later refunded in full, the cashback is taken back from the buyer's available
balance as far as it reaches (``cashback_clawback``), the same way an
affiliate commission is clawed back.

The cashback never exceeds the platform fee the order settled at (the same
base the affiliate commission uses): a sale that earned the platform nothing
(0 % seller promo, internal seller) pays no cashback, so it cannot be farmed
between two accounts.
"""
from __future__ import annotations

from datetime import datetime, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.buyer_tiers.config import get_config, level_of
from src.models.account import Account
from src.models.buyer_tier import BuyerCashback
from src.models.order import Order, OrderStatus
from src.models.wallet import Transaction, TransactionType
from src.wallet.service import get_wallet_by_account

logger = structlog.get_logger()


def cashback_amount(paid: int, rate_percent: float) -> int:
    """Whole đồng, rounded down: the platform never pays a fraction over the rate."""
    if paid <= 0 or rate_percent <= 0:
        return 0
    return int(paid * rate_percent // 100)


async def apply_buyer_cashback(order: Order, db: AsyncSession) -> int:
    """Credit the buyer's cashback for a settled order. Returns the amount
    paid now (0 when not eligible or already paid). Never commits."""
    if order.status != OrderStatus.completed or order.is_seeded:
        return 0
    if order.refunded_amount or order.total_amount <= 0 or order.buyer_id == order.seller_id:
        return 0
    if await db.scalar(select(BuyerCashback.id).where(BuyerCashback.order_id == order.id)):
        return 0
    buyer = await db.get(Account, order.buyer_id)
    if buyer is None or buyer.is_seeded:
        return 0
    cfg = await get_config(db)
    tier = buyer.buyer_tier or "l1"
    rate = float(level_of(cfg, tier)["cashback_percent"])
    amount = cashback_amount(order.total_amount, rate)
    if amount <= 0:
        return 0
    from src.fees.service import order_fee_percent
    from src.wallet.service import escrow_settlement

    seller = await db.get(Account, order.seller_id) if order.seller_id is not None else None
    fee_percent = await order_fee_percent(order, seller.seller_tier if seller else "new", db)
    _, platform_fee = escrow_settlement(order.total_amount, 0, fee_percent)
    amount = min(amount, platform_fee)
    if amount <= 0:
        return 0
    wallet = await get_wallet_by_account(buyer.id, db, for_update=True)
    reference_id = f"order-{order.id}"
    if await db.scalar(select(Transaction.id).where(
        Transaction.type == TransactionType.cashback, Transaction.reference_id == reference_id,
    )):
        return 0
    wallet.available_balance += amount
    db.add(Transaction(
        wallet_id=wallet.id, type=TransactionType.cashback, amount=amount,
        description=f"Hoàn tiền hạng thành viên {rate:g}%", reference_id=reference_id,
    ))
    db.add(BuyerCashback(
        order_id=order.id, buyer_id=buyer.id, tier=tier, rate_percent=rate,
        base_amount=order.total_amount, amount=amount,
    ))
    from src.notifications.history import notify
    await notify(
        db, buyer.id, "cashback_credited", category="wallet",
        params={"amount": amount, "order_code": order.order_code, "rate": rate}, href="/wallet",
    )
    logger.info("buyer_cashback_paid", order_id=order.id, buyer_id=buyer.id, amount=amount, tier=tier)
    return amount


async def clawback_buyer_cashback(order: Order, db: AsyncSession) -> int:
    """Take back the cashback of an order refunded in full. Returns what was
    recovered (at most the buyer's available balance). Idempotent; never commits."""
    cashback = await db.scalar(
        select(BuyerCashback).where(BuyerCashback.order_id == order.id).with_for_update()
    )
    if cashback is None or cashback.clawed_back_at is not None:
        return 0
    wallet = await get_wallet_by_account(cashback.buyer_id, db, for_update=True)
    reference_id = f"order-{order.id}"
    recovered = 0
    already = await db.scalar(select(Transaction.id).where(
        Transaction.type == TransactionType.cashback_clawback, Transaction.reference_id == reference_id,
    ))
    if not already:
        recovered = min(wallet.available_balance, cashback.amount)
        if recovered > 0:
            wallet.available_balance -= recovered
            db.add(Transaction(
                wallet_id=wallet.id, type=TransactionType.cashback_clawback, amount=recovered,
                description="Thu hồi hoàn tiền hạng thành viên", reference_id=reference_id,
            ))
    cashback.clawed_back_at = datetime.now(timezone.utc)
    cashback.clawback_amount = recovered
    logger.info("buyer_cashback_clawed_back", order_id=order.id, buyer_id=cashback.buyer_id,
                amount=cashback.amount, recovered=recovered)
    return recovered
