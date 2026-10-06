"""The owner's ledger page (/transactions): filter, summarise and page a
wallet's rows in SQL, so a shop with years of sales does not ship its whole
history to the browser.

The grouping mirrors the frontend (`frontend/lib/tx-kind.ts`,
`frontend/features/wallet-ledger/model.ts`): each ledger type has a kind
(topup, purchase, sale, …), each kind a group (buy, sell, funds, other).
A row is *open* while its money is not settled: a purchase held for an order
still in progress, or a withdrawal lock whose request is not paid or rejected.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Integer, and_, case, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.i18n.search_text import contains_folded
from src.models.order import Order, OrderStatus
from src.models.wallet import (
    TRANSACTION_DIRECTION, Transaction, TransactionDirection, TransactionType as T, WithdrawRequest, WithdrawStatus,
)

KIND_TYPES: dict[str, tuple[T, ...]] = {
    "topup": (T.topup, T.deposit),
    "purchase": (T.purchase_hold,),
    "sale": (T.purchase_release, T.platform_fee, T.promo_subsidy),
    "refund": (T.refund,),
    "affiliate": (T.affiliate_commission, T.affiliate_clawback),
    "withdraw": (T.withdraw, T.withdraw_lock, T.withdraw_unlock, T.withdraw_fee),
    "adjustment": (T.adjustment_credit, T.adjustment_debit),
}
GROUP_KINDS: dict[str, tuple[str, ...]] = {
    "buy": ("purchase", "refund"),
    "sell": ("sale",),
    "funds": ("topup", "withdraw"),
    "other": ("affiliate", "adjustment"),
}
KINDS = tuple(KIND_TYPES)
GROUPS = tuple(GROUP_KINDS)
HELD_ORDER = (OrderStatus.pending, OrderStatus.processing, OrderStatus.delivered, OrderStatus.disputed)
OPEN_WITHDRAW = (WithdrawStatus.pending, WithdrawStatus.approved)

_MAPPED = {t for types in KIND_TYPES.values() for t in types}
# A type added later without a kind lands in "adjustment" (as on the frontend).
KIND_TYPES["adjustment"] = (*KIND_TYPES["adjustment"], *(t for t in T if t not in _MAPPED))


def group_types(group: str) -> tuple[T, ...]:
    return tuple(t for kind in GROUP_KINDS[group] for t in KIND_TYPES[kind])


def kind_of(tx_type: T) -> str:
    return next(kind for kind, types in KIND_TYPES.items() if tx_type in types)


def group_of(tx_type: T) -> str:
    kind = kind_of(tx_type)
    return next(group for group, kinds in GROUP_KINDS.items() if kind in kinds)


@dataclass(frozen=True)
class LedgerQuery:
    group: str | None = None
    kind: str | None = None
    direction: str | None = None  # "in" | "out"
    open: bool = False
    channel: str | None = None  # "bank" | "usdt"
    start: datetime | None = None
    end: datetime | None = None
    q: str | None = None
    # Ledger types whose label (translated on the client) matches every word of `q`.
    q_types: tuple[str, ...] = ()


def _order_ref():
    """Order id behind `reference_id`: `order-<id>[suffix]`, or a bare `<id>` (affiliate)."""
    return case(
        (Transaction.reference_id.op("~")(r"^order-\d{1,9}([:-]|$)"),
         cast(func.substring(Transaction.reference_id, r"^order-(\d{1,9})"), Integer)),
        (Transaction.reference_id.op("~")(r"^\d{1,9}$"), cast(Transaction.reference_id, Integer)),
        else_=None,
    )


def _withdraw_ref():
    return case(
        (Transaction.reference_id.op("~")(r"^withdraw-\d{1,9}$"),
         cast(func.substring(Transaction.reference_id, r"^withdraw-(\d{1,9})$"), Integer)),
        else_=None,
    )


def _usdt_deposit():
    return or_(
        func.lower(func.coalesce(Transaction.description, "")).contains("usdt"),
        func.lower(func.coalesce(Transaction.reference_id, "")).contains("usdt"),
        func.lower(func.coalesce(Transaction.reference_id, "")).contains("nowpayments"),
        func.lower(func.coalesce(Transaction.description, "")).contains("nowpayments"),
    )


def _open_clause():
    return or_(
        and_(Transaction.type == T.purchase_hold, Order.status.in_(HELD_ORDER)),
        and_(Transaction.type == T.withdraw_lock, WithdrawRequest.status.in_(OPEN_WITHDRAW)),
    )


def _signed_amount():
    """+amount for money in, −amount for money out, 0 for neutral rows."""
    ins = [t for t, d in TRANSACTION_DIRECTION.items() if d == TransactionDirection.in_]
    outs = [t for t, d in TRANSACTION_DIRECTION.items() if d == TransactionDirection.out]
    return case(
        (Transaction.type.in_(ins), Transaction.amount),
        (Transaction.type.in_(outs), -Transaction.amount),
        else_=0,
    )


def _base(wallet_id: int):
    """The wallet's rows joined to the order and withdrawal they reference."""
    return (
        select(Transaction)
        .outerjoin(Order, Order.id == _order_ref())
        .outerjoin(WithdrawRequest, WithdrawRequest.id == _withdraw_ref())
        .where(Transaction.wallet_id == wallet_id)
    )


def _filters(query: LedgerQuery, *, skip_group: bool = False) -> list:
    out: list = []
    if query.group and not skip_group:
        out.append(Transaction.type.in_(group_types(query.group)))
    if query.kind and not skip_group:
        out.append(Transaction.type.in_(KIND_TYPES[query.kind]))
    if query.direction:
        wanted = TransactionDirection.in_ if query.direction == "in" else TransactionDirection.out
        out.append(Transaction.type.in_([t for t, d in TRANSACTION_DIRECTION.items() if d == wanted]))
    if query.open:
        out.append(_open_clause())
    if query.channel == "usdt":
        out.append(and_(Transaction.type == T.deposit, _usdt_deposit()))
    elif query.channel == "bank":
        out.append(or_(
            and_(Transaction.type == T.deposit, ~_usdt_deposit()),
            Transaction.type.in_(KIND_TYPES["withdraw"]),
        ))
    if query.start is not None:
        out.append(Transaction.created_at >= query.start)
    if query.end is not None:
        out.append(Transaction.created_at < query.end)
    if query.q and query.q.strip():
        q = query.q.strip()
        deposit_ref = func.substring(Transaction.reference_id, r"^deposit-\d+-(.+)$")
        matches = [
            contains_folded(Transaction.description, q),
            contains_folded(Order.order_code, q),
            contains_folded(deposit_ref, q),
        ]
        types = [T(t) for t in query.q_types if t in T._value2member_map_]
        if types:
            matches.append(Transaction.type.in_(types))
        out.append(or_(*matches))
    return out


async def ledger_page(
    wallet_id: int, db: AsyncSession, query: LedgerQuery, *, page: int, per_page: int,
) -> tuple[list[Transaction], dict]:
    """One page of rows (newest first) plus what the page header shows: totals
    of the filtered rows, row counts per group (every filter but the group),
    how many rows are open, and which groups / kinds / channels the wallet has."""
    filters = _filters(query)
    base = _base(wallet_id)

    totals = (await db.execute(
        base.with_only_columns(
            func.count(Transaction.id),
            func.coalesce(func.sum(case((_signed_amount() > 0, _signed_amount()), else_=0)), 0),
            func.coalesce(func.sum(case((_signed_amount() < 0, -_signed_amount()), else_=0)), 0),
            func.count(Transaction.id).filter(_open_clause()),
        ).where(*filters)
    )).one()
    count, money_in, money_out, open_rows = (int(v) for v in totals)

    per_type = (await db.execute(
        base.with_only_columns(Transaction.type, func.count(Transaction.id))
        .where(*_filters(query, skip_group=True)).group_by(Transaction.type)
    )).all()
    group_counts = {"all": 0, **{g: 0 for g in GROUPS}}
    for tx_type, n in per_type:
        group_counts["all"] += n
        group_counts[group_of(tx_type)] += n

    present = (await db.execute(
        base.with_only_columns(
            Transaction.type,
            func.bool_or(and_(Transaction.type == T.deposit, _usdt_deposit())),
            func.bool_or(and_(Transaction.type == T.deposit, ~_usdt_deposit())),
            func.count(Transaction.id).filter(_open_clause()),
        ).group_by(Transaction.type)
    )).all()
    kinds = {kind_of(t) for t, *_ in present}
    channels = set()
    for tx_type, usdt, bank, _ in present:
        if usdt:
            channels.add("usdt")
        if bank or tx_type in KIND_TYPES["withdraw"]:
            channels.add("bank")

    rows = list((await db.execute(
        base.where(*filters)
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )).scalars().all())

    return rows, {
        "total": count,
        "summary": {"count": count, "in": money_in, "out": money_out, "net": money_in - money_out, "open": open_rows},
        "group_counts": group_counts,
        "open_total": sum(row[3] for row in present),
        "present": {
            "groups": [g for g in GROUPS if any(k in kinds for k in GROUP_KINDS[g])],
            "kinds": [k for k in KINDS if k in kinds],
            "channels": [c for c in ("bank", "usdt") if c in channels],
        },
    }
