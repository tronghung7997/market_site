"""Buyer tiers: the criterion figure per buyer, progress, and recomputation.

``accounts.buyer_tier`` is recomputed by the daily tier job (and when an
admin runs it now): every active, real account lands on the level its
criterion figure reaches under the current settings, up or down, and each
change is written to ``buyer_tier_events``. Promotions notify the buyer.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.buyer_tiers.config import get_config, level_for, level_of
from src.models.account import Account
from src.models.buyer_tier import BUYER_TIERS, BuyerCashback, BuyerTierEvent
from src.models.order import Order, OrderStatus
from src.models.wallet import Transaction, TransactionType, Wallet


def _deposits_select():
    return (
        select(Wallet.account_id.label("account_id"), func.sum(Transaction.amount).label("value"))
        .join(Wallet, Wallet.id == Transaction.wallet_id)
        .where(Transaction.type == TransactionType.deposit)
        .group_by(Wallet.account_id)
    )


def _spent_select():
    return (
        select(Order.buyer_id.label("account_id"), func.sum(Order.total_amount - Order.refunded_amount).label("value"))
        .where(Order.status == OrderStatus.completed, Order.is_seeded.is_(False))
        .group_by(Order.buyer_id)
    )


def _metric_select(criterion: str):
    return _deposits_select() if criterion == "total_deposit" else _spent_select()


async def metric_value(db: AsyncSession, account_id: int, criterion: str) -> int:
    sub = _metric_select(criterion).subquery()
    return int(await db.scalar(select(sub.c.value).where(sub.c.account_id == account_id)) or 0)


def _names(level: dict) -> dict:
    return {"name_vi": level["name_vi"], "name_en": level["name_en"]}


def public_levels(cfg: dict) -> list[dict]:
    """What buyers may see about every level."""
    return [
        {"tier": tier, **_names(cfg["levels"][tier]), **{k: cfg["levels"][tier][k] for k in (
            "min_amount", "cashback_percent", "api_requests_per_minute", "api_orders_per_minute")}}
        for tier in BUYER_TIERS
    ]


async def buyer_progress(account: Account, db: AsyncSession) -> dict:
    cfg = await get_config(db)
    criterion = cfg["criterion"]
    value = await metric_value(db, account.id, criterion)
    tier = account.buyer_tier or "l1"
    index = BUYER_TIERS.index(tier) if tier in BUYER_TIERS else 0
    next_tier = BUYER_TIERS[index + 1] if index + 1 < len(BUYER_TIERS) else None
    cashback_total = int(await db.scalar(
        select(func.coalesce(func.sum(BuyerCashback.amount), 0)).where(
            BuyerCashback.buyer_id == account.id, BuyerCashback.clawed_back_at.is_(None),
        )
    ) or 0)
    history = (await db.execute(
        select(BuyerTierEvent).where(BuyerTierEvent.account_id == account.id)
        .order_by(BuyerTierEvent.created_at.desc(), BuyerTierEvent.id.desc()).limit(20)
    )).scalars().all()
    return {
        "tier": tier,
        "criterion": criterion,
        "value": value,
        # The level the figure reaches now; the tier itself moves at the daily run.
        "reached_tier": level_for(cfg, value),
        "next_tier": next_tier,
        "next_min_amount": cfg["levels"][next_tier]["min_amount"] if next_tier else None,
        "current": {"tier": tier, **level_of(cfg, tier)},
        "levels": public_levels(cfg),
        "cashback_total": cashback_total,
        "history": [
            {"old_tier": e.old_tier, "new_tier": e.new_tier, "reason": e.reason, "created_at": e.created_at}
            for e in history
        ],
    }


async def plan_buyer_changes(db: AsyncSession) -> list[dict]:
    """Every active, real account whose stored tier differs from the level
    its criterion figure reaches now. Pure read."""
    cfg = await get_config(db)
    metric = _metric_select(cfg["criterion"]).subquery()
    rows = (await db.execute(
        select(Account.id, Account.email, Account.buyer_tier, func.coalesce(metric.c.value, 0))
        .outerjoin(metric, metric.c.account_id == Account.id)
        .where(Account.is_active.is_(True), Account.is_seeded.is_(False))
        .order_by(Account.id)
    )).all()
    changes = []
    for account_id, email, tier, value in rows:
        target = level_for(cfg, int(value or 0))
        current = tier or "l1"
        if target != current:
            changes.append({
                "account_id": account_id, "email": email, "from": current, "to": target,
                "criterion": cfg["criterion"], "value": int(value or 0),
            })
    return changes


async def apply_buyer_changes(db: AsyncSession, changes: list[dict], *, actor_id: int | None, reason: str) -> int:
    """Write the planned changes (re-checking each stored tier under a row
    lock so a concurrent run cannot double-write). Commits."""
    from src.notifications.history import notify

    applied = 0
    for change in changes:
        account = await db.get(Account, change["account_id"], with_for_update=True)
        if account is None or (account.buyer_tier or "l1") != change["from"]:
            continue
        account.buyer_tier = change["to"]
        db.add(BuyerTierEvent(
            account_id=account.id, old_tier=change["from"], new_tier=change["to"],
            criterion=change["criterion"], metric_value=min(change["value"], 2_147_483_647),
            reason=reason, actor_id=actor_id,
        ))
        if BUYER_TIERS.index(change["to"]) > BUYER_TIERS.index(change["from"]):
            await notify(
                db, account.id, "buyer_tier_changed", category="wallet",
                params={"old": change["from"], "new": change["to"]}, href="/account?tab=tier",
            )
        applied += 1
    await db.commit()
    return applied


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
