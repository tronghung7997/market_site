"""Periodic snapshot of money/order state onto the log stream.

Events say what happened; dashboards also need what *is*: money held in
escrow, balances, withdrawals waiting, orders stuck, disputes past their
deadline, provider credit. One `state_snapshot` line (plus one
`provider_credit_state` line per provider that tracks credit) every run.

Read-only aggregates on indexed status columns; amounts are VND.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import and_, func, select

from src.database import SessionLocal
from src.models.alert import Alert
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.payment import DepositIntent, DepositIntentStatus
from src.models.provider import Provider
from src.models.wallet import Wallet, WithdrawRequest, WithdrawStatus

logger = structlog.get_logger("state")

# Orders whose money is still held (not yet released to the seller or refunded).
_OPEN_STATUSES = (OrderStatus.pending, OrderStatus.processing, OrderStatus.delivered, OrderStatus.disputed)
_STUCK_AFTER = timedelta(minutes=30)


async def collect_state(db, now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    state: dict[str, int] = {}

    rows = await db.execute(
        select(Order.status, func.count(), func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0))
        .where(Order.status.in_(_OPEN_STATUSES))
        .group_by(Order.status)
    )
    held = 0
    for status, count, amount in rows:
        state[f"orders_{status.value}"] = int(count)
        held += int(amount)
    for status in _OPEN_STATUSES:
        state.setdefault(f"orders_{status.value}", 0)
    state["escrow_held_vnd"] = held

    state["orders_stuck"] = int(await db.scalar(
        select(func.count()).select_from(Order).where(
            Order.status.in_((OrderStatus.pending, OrderStatus.processing)),
            Order.created_at < now - _STUCK_AFTER,
        )
    ) or 0)

    available, locked = (await db.execute(
        select(func.coalesce(func.sum(Wallet.available_balance), 0), func.coalesce(func.sum(Wallet.locked_balance), 0))
    )).one()
    state["wallet_available_vnd"] = int(available)
    state["wallet_locked_vnd"] = int(locked)

    for status, prefix in ((WithdrawStatus.pending, "withdraw_pending"), (WithdrawStatus.approved, "withdraw_approved_unpaid")):
        count, amount = (await db.execute(
            select(func.count(), func.coalesce(func.sum(WithdrawRequest.amount), 0)).where(WithdrawRequest.status == status)
        )).one()
        state[f"{prefix}_count"] = int(count)
        state[f"{prefix}_vnd"] = int(amount)

    open_dispute = Dispute.status == DisputeStatus.open
    state["disputes_open"] = int(await db.scalar(select(func.count()).select_from(Dispute).where(open_dispute)) or 0)
    state["disputes_seller_overdue"] = int(await db.scalar(
        select(func.count()).select_from(Dispute).where(
            open_dispute, Dispute.seller_deadline_at < now, Dispute.seller_responded_at.is_(None)
        )
    ) or 0)
    state["disputes_resolution_overdue"] = int(await db.scalar(
        select(func.count()).select_from(Dispute).where(open_dispute, Dispute.resolution_deadline_at < now)
    ) or 0)

    state["deposits_pending"] = int(await db.scalar(
        select(func.count()).select_from(DepositIntent).where(DepositIntent.status == DepositIntentStatus.pending)
    ) or 0)

    state["alerts_active"] = int(await db.scalar(
        select(func.count()).select_from(Alert).where(Alert.is_active.is_(True))
    ) or 0)
    return state


async def collect_provider_credit(db) -> list[dict]:
    rows = await db.execute(
        select(Provider.id, Provider.name, Provider.credit_balance_xu, Provider.credit_low_threshold_xu)
        .where(and_(Provider.is_active.is_(True), Provider.credit_balance_xu.is_not(None)))
    )
    return [
        {
            "provider_id": pid,
            "provider_name": name,
            "credit_balance_xu": int(balance),
            "credit_low_threshold_xu": int(threshold) if threshold is not None else None,
            "credit_low": threshold is not None and balance <= threshold,
        }
        for pid, name, balance, threshold in rows
    ]


async def state_snapshot_job() -> None:
    async with SessionLocal() as db:
        state = await collect_state(db)
        providers = await collect_provider_credit(db)
    logger.info("state_snapshot", **state)
    for provider in providers:
        (logger.warning if provider["credit_low"] else logger.info)("provider_credit_state", **provider)
