"""Admin money journal (Tài chính › Dòng tiền): every ledger row in one place.

Read-only over ``transactions``, the system of record for every balance
change (see ``models.wallet.TRANSACTION_DIRECTION``). Interface:

- ``list_entries``    newest-first page of rows, keyset-paged on
                      (created_at, id), each with its running wallet balance;
- ``summarize``       totals per type for a period plus the current balances
                      (wallets, escrow, locked) and the last reconcile run;
- ``account_statement`` one wallet: opening + in − out = closing for a period;
- ``reference_group`` every row of one order / deposit / withdrawal with
                      what still sits in escrow;
- ``resolve_search``  the smart search box: maps pasted text (email, order
                      code, payment code, amount, row id) to journal filters.

Query rules: every filter is sargable against the indexes of migration
hu1a2b3c4d5e6, paging never uses OFFSET, running balances are computed for
the page rows only (one window query), and each call runs under a
statement timeout so a heavy request cannot hold the database.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import (
    DateTime, Integer, and_, case, cast, column, func, literal, or_, select, text, true, tuple_, values,
)
from sqlalchemy.ext.asyncio import AsyncSession

from src.fees.settings import platform_account_id
from src.media.service import private_images
from src.models.account import Account
from src.models.ledger_reconcile_run import LedgerReconcileRun
from src.models.order import Order
from src.models.payment import DepositIntent
from src.models.wallet import (
    TRANSACTION_DIRECTION, Transaction, TransactionDirection, TransactionType, Wallet, WithdrawRequest,
    WithdrawStatus,
)
from src.wallet.service import ESCROW_OPEN_STATUSES, order_in_books, order_ledger_condition

STATEMENT_TIMEOUT_MS = 10_000
MAX_PAGE = 200
MAX_GROUP_ROWS = 500

IN_TYPES = tuple(t for t, d in TRANSACTION_DIRECTION.items() if d == TransactionDirection.in_)
OUT_TYPES = tuple(t for t, d in TRANSACTION_DIRECTION.items() if d == TransactionDirection.out)
NEUTRAL_TYPES = tuple(t for t, d in TRANSACTION_DIRECTION.items() if d == TransactionDirection.neutral)
# Money crossing the platform boundary (same sets as the nightly reconcile).
SOURCE_IN = (
    TransactionType.topup, TransactionType.deposit, TransactionType.adjustment_credit,
    TransactionType.affiliate_commission, TransactionType.promo_subsidy, TransactionType.cashback,
)
SOURCE_OUT = (
    TransactionType.withdraw, TransactionType.adjustment_debit, TransactionType.affiliate_clawback,
    TransactionType.cashback_clawback,
)

_ORDER_REF = re.compile(r"^order-(\d+)(?:[:\-].*)?$")
_DEPOSIT_REF = re.compile(r"^deposit-(\d+)(?:-.*)?$")
_WITHDRAW_REF = re.compile(r"^withdraw-(\d+)$")
GROUP_KEY = re.compile(r"^(order|deposit|withdraw):(\d{1,12})$")


class JournalError(ValueError):
    """Invalid journal query (bad cursor, unknown group key)."""


@dataclass
class EntryFilters:
    start: datetime | None = None
    end: datetime | None = None          # exclusive
    direction: str | None = None         # in | out | neutral
    types: list[TransactionType] = field(default_factory=list)
    role: str | None = None              # buyer | seller | platform
    account_id: int | None = None
    group: str | None = None             # order:12 | deposit:3 | withdraw:5
    amount: int | None = None
    entry_id: int | None = None
    actor: str | None = None             # admin | system | user | demo
    include_seed: bool = False           # test/seed money is hidden unless asked for


def _signed(amount_col=Transaction.amount, type_col=Transaction.type):
    return case(
        (type_col.in_(IN_TYPES), amount_col),
        (type_col.in_(OUT_TYPES), -amount_col),
        else_=0,
    )


async def _limit_session(db: AsyncSession) -> None:
    await db.execute(text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"))


def group_key(reference_id: str | None) -> str | None:
    """The business event a ledger row belongs to (`order:12`, …)."""
    if not reference_id:
        return None
    if m := _ORDER_REF.match(reference_id):
        return f"order:{m.group(1)}"
    if reference_id.isdigit():  # affiliate commission / clawback
        return f"order:{reference_id}"
    if m := _DEPOSIT_REF.match(reference_id):
        return f"deposit:{m.group(1)}"
    if m := _WITHDRAW_REF.match(reference_id):
        return f"withdraw:{m.group(1)}"
    return None


def _group_condition(key: str):
    m = GROUP_KEY.match(key)
    if not m:
        raise JournalError("group must look like order:12, deposit:3 or withdraw:5")
    kind, ident = m.group(1), m.group(2)
    ref = Transaction.reference_id
    if kind == "order":
        return order_ledger_condition(int(ident), include_affiliate=True)
    if kind == "deposit":
        base = f"deposit-{ident}"
        return or_(ref == base, ref.like(f"{base}-%"))
    return ref == f"withdraw-{ident}"


async def _wallet_id(db: AsyncSession, account_id: int) -> int | None:
    return await db.scalar(select(Wallet.id).where(Wallet.account_id == account_id))


# Debits that retire test/seed balances (scripts/retire_seed_accounts.sql). They
# leave the books as money out, but are not a platform cost or income.
SEED_WRITEOFF_REF_PREFIX = "seed-writeoff:"


def _not_seed():
    """Real money only: no rows on seeded accounts' wallets, none booked for a
    seeded order, and no seed write-offs (scripts/retire_seed_accounts.sql).
    A view filter — the books and the reconcile still hold every row."""
    seeded_wallets = select(Wallet.id).join(Account, Account.id == Wallet.account_id).where(Account.is_seeded.is_(True))
    order_ref = cast(func.substring(Transaction.reference_id, r"^order-(\d+)(?:[:-]|$)"), Integer)
    return and_(
        Transaction.wallet_id.not_in(seeded_wallets),
        or_(order_ref.is_(None), order_ref.not_in(select(Order.id).where(Order.is_seeded.is_(True)))),
        or_(Transaction.reference_id.is_(None), ~Transaction.reference_id.like(f"{SEED_WRITEOFF_REF_PREFIX}%")),
    )


async def _conditions(db: AsyncSession, f: EntryFilters) -> list | None:
    """WHERE clauses for the filters, or None when they can match nothing."""
    conds = []
    if f.start is not None:
        conds.append(Transaction.created_at >= f.start)
    if f.end is not None:
        conds.append(Transaction.created_at < f.end)
    if f.direction:
        conds.append(Transaction.type.in_(
            {"in": IN_TYPES, "out": OUT_TYPES, "neutral": NEUTRAL_TYPES}[f.direction]
        ))
    if f.types:
        conds.append(Transaction.type.in_(f.types))
    if f.account_id is not None:
        wid = await _wallet_id(db, f.account_id)
        if wid is None:
            return None
        conds.append(Transaction.wallet_id == wid)
    if f.group:
        conds.append(_group_condition(f.group))
    if f.amount is not None:
        conds.append(Transaction.amount == f.amount)
    if f.entry_id is not None:
        conds.append(Transaction.id == f.entry_id)
    if f.actor:
        conds.append(_actor_condition(f.actor))
    if not f.include_seed:
        conds.append(_not_seed())
    if f.role in ("platform", "seller", "buyer"):
        platform_id = await platform_account_id(db)
        if f.role == "platform":
            conds.append(Account.id == platform_id)
        elif f.role == "seller":
            conds.append(and_(Account.id != platform_id, Account.roles.any("seller")))
        else:
            conds.append(and_(Account.id != platform_id, ~Account.roles.any("seller")))
    return conds


def _role_of(account_id: int, roles: list[str] | None, platform_id: int) -> str:
    if account_id == platform_id:
        return "platform"
    return "seller" if "seller" in (roles or []) else "buyer"


def encode_cursor(created_at: datetime, entry_id: int) -> str:
    return f"{created_at.isoformat()}_{entry_id}"


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        at, _, ident = cursor.rpartition("_")
        parsed = datetime.fromisoformat(at)
        if parsed.tzinfo is None:
            raise ValueError
        return parsed, int(ident)
    except ValueError as exc:
        raise JournalError("invalid cursor") from exc


async def _running_balances(db: AsyncSession, rows: list) -> dict[int, int]:
    """Available balance of each page row's wallet right after that row.

    Per wallet on the page: the sum of everything strictly before its oldest
    page row (index-only via ix_transactions_wallet_created_id), plus a window
    sum over its rows between the page's oldest and newest row of that
    wallet. Filters never apply here — a balance counts every row."""
    span: dict[int, list] = {}
    for r in rows:
        key = (r.created_at, r.id)
        lo_hi = span.setdefault(r.wallet_id, [key, key])
        lo_hi[0] = min(lo_hi[0], key)
        lo_hi[1] = max(lo_hi[1], key)
    if not span:
        return {}
    page = values(
        column("wallet_id", Integer), column("lo_at", DateTime(timezone=True)), column("lo_id", Integer),
        column("hi_at", DateTime(timezone=True)), column("hi_id", Integer),
        name="page",
    ).data([(wid, lo[0], lo[1], hi[0], hi[1]) for wid, (lo, hi) in span.items()])
    before = Transaction.__table__.alias("before")
    opening = (
        select(func.coalesce(func.sum(_signed(before.c.amount, before.c.type)), 0).label("opening"))
        .where(
            before.c.wallet_id == page.c.wallet_id,
            tuple_(before.c.created_at, before.c.id) < tuple_(page.c.lo_at, page.c.lo_id),
        )
        .lateral("opening")
    )
    t = Transaction.__table__
    running = (
        opening.c.opening
        + func.sum(_signed(t.c.amount, t.c.type)).over(
            partition_by=t.c.wallet_id, order_by=(t.c.created_at, t.c.id),
        )
    )
    stmt = (
        select(t.c.id, running.label("balance"))
        .select_from(page)
        .join(t, and_(
            t.c.wallet_id == page.c.wallet_id,
            tuple_(t.c.created_at, t.c.id) >= tuple_(page.c.lo_at, page.c.lo_id),
            tuple_(t.c.created_at, t.c.id) <= tuple_(page.c.hi_at, page.c.hi_id),
        ))
        .join(opening, true())
    )
    wanted = {r.id for r in rows}
    return {i: int(b) for i, b in (await db.execute(stmt)).all() if i in wanted}


async def _labels(db: AsyncSession, keys: set[str]) -> dict[str, str]:
    """Human labels for group keys: the order code (ORD-…), the deposit's
    payment code / provider, `#id` for withdrawals (admin-only surface)."""
    ids: dict[str, set[int]] = {"order": set(), "deposit": set(), "withdraw": set()}
    for k in keys:
        kind, _, ident = k.partition(":")
        ids[kind].add(int(ident))
    out: dict[str, str] = {}
    if ids["order"]:
        for oid, code in (await db.execute(
            select(Order.id, Order.order_code).where(Order.id.in_(ids["order"]))
        )).all():
            out[f"order:{oid}"] = code
    if ids["deposit"]:
        for did, code, provider in (await db.execute(
            select(DepositIntent.id, DepositIntent.payment_code, DepositIntent.provider)
            .where(DepositIntent.id.in_(ids["deposit"]))
        )).all():
            out[f"deposit:{did}"] = code or f"{provider} #{did}"
    for wid in ids["withdraw"]:
        out[f"withdraw:{wid}"] = f"Rút #{wid}"
    return out


_DEMO_PREFIX = "Nạp thử"


# Rows an admin's decision on a withdrawal books: the payout and its fee when
# the transfer is confirmed, the unlock when the request is rejected, and the
# platform's share of the fee (platform_fee referencing ``withdraw-<id>``).
_WITHDRAW_ADMIN_TYPES = (TransactionType.withdraw, TransactionType.withdraw_fee, TransactionType.withdraw_unlock)


def _actor_condition(actor: str):
    """SQL twin of ``_actor``: same rule, sargable on type."""
    is_demo = and_(
        Transaction.type == TransactionType.topup,
        func.coalesce(Transaction.description, "").like(f"{_DEMO_PREFIX}%"),
    )
    manual = (TransactionType.adjustment_credit, TransactionType.adjustment_debit)
    withdraw_fee_income = and_(
        Transaction.type == TransactionType.platform_fee,
        func.coalesce(Transaction.reference_id, "").like("withdraw-%"),
    )
    if actor == "admin":
        return or_(
            Transaction.type.in_((*manual, *_WITHDRAW_ADMIN_TYPES)),
            and_(Transaction.type == TransactionType.topup, ~is_demo),
            withdraw_fee_income,
        )
    if actor == "demo":
        return is_demo
    if actor == "user":
        return Transaction.type == TransactionType.withdraw_lock
    return and_(
        Transaction.type.notin_((*manual, *_WITHDRAW_ADMIN_TYPES, TransactionType.topup, TransactionType.withdraw_lock)),
        ~withdraw_fee_income,
    )


def _actor(tx_type: TransactionType, description: str | None, reference_id: str | None = None) -> str:
    """Who caused the row. Manual credits/debits and every row an admin's
    withdrawal decision books are the admin's; the seller asked for the lock;
    the rest is the system acting on a buyer/seller request."""
    if tx_type in (TransactionType.adjustment_debit, TransactionType.adjustment_credit, *_WITHDRAW_ADMIN_TYPES):
        return "admin"
    if tx_type == TransactionType.platform_fee and (reference_id or "").startswith("withdraw-"):
        return "admin"
    if tx_type == TransactionType.topup:
        return "demo" if (description or "").startswith(_DEMO_PREFIX) else "admin"
    if tx_type == TransactionType.withdraw_lock:
        return "user"
    return "system"


async def list_entries(
    db: AsyncSession, f: EntryFilters, *, cursor: str | None = None, limit: int = 50,
) -> dict:
    limit = max(1, min(limit, MAX_PAGE))
    await _limit_session(db)
    conds = await _conditions(db, f)
    if conds is None:
        return {"items": [], "next_cursor": None}
    if cursor:
        at, ident = decode_cursor(cursor)
        conds.append(tuple_(Transaction.created_at, Transaction.id) < tuple_(literal(at), literal(ident)))
    stmt = (
        select(
            Transaction.id, Transaction.wallet_id, Transaction.created_at, Transaction.type,
            Transaction.amount, Transaction.description, Transaction.reference_id, Transaction.proof_media,
            Account.id.label("account_id"), Account.email, Account.roles,
        )
        .join(Wallet, Wallet.id == Transaction.wallet_id)
        .join(Account, Account.id == Wallet.account_id)
        .where(*conds)
        .order_by(Transaction.created_at.desc(), Transaction.id.desc())
        .limit(limit + 1)
    )
    rows = list((await db.execute(stmt)).all())
    has_more = len(rows) > limit
    rows = rows[:limit]
    balances = await _running_balances(db, rows)
    keys = {k for r in rows if (k := group_key(r.reference_id))}
    labels = await _labels(db, keys) if keys else {}
    withdraw_ids = {int(k.partition(":")[2]) for k in keys if k.startswith("withdraw:")}
    withdraw_status = {
        f"withdraw:{rid}": st.value
        for rid, st in (await db.execute(
            select(WithdrawRequest.id, WithdrawRequest.status).where(WithdrawRequest.id.in_(withdraw_ids))
        )).all()
    } if withdraw_ids else {}
    platform_id = await platform_account_id(db)
    items = []
    for r in rows:
        key = group_key(r.reference_id)
        items.append({
            "id": r.id,
            "created_at": r.created_at,
            "type": r.type.value,
            "direction": TRANSACTION_DIRECTION[r.type].value,
            "amount": r.amount,
            "description": r.description,
            "account_id": r.account_id,
            "account_email": r.email,
            "account_role": _role_of(r.account_id, r.roles, platform_id),
            "group": key,
            "group_label": labels.get(key) if key else None,
            # Where the withdrawal a row belongs to stands now (pending → paid / rejected).
            "withdraw_status": withdraw_status.get(key) if key else None,
            "balance_after": balances.get(r.id),
            "actor": _actor(r.type, r.description, r.reference_id),
            "proof_count": len(r.proof_media or []),
        })
    next_cursor = encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None
    return {"items": items, "next_cursor": next_cursor}


async def summarize(db: AsyncSession, f: EntryFilters) -> dict:
    """Totals for the filtered period plus point-in-time balances."""
    await _limit_session(db)
    conds = await _conditions(db, f)
    by_type: dict[str, dict] = {}
    if conds is not None:
        stmt = (
            select(Transaction.type, func.count(), func.sum(Transaction.amount))
            .join(Wallet, Wallet.id == Transaction.wallet_id)
            .join(Account, Account.id == Wallet.account_id)
            .where(*conds)
            .group_by(Transaction.type)
        )
        for tx_type, n, total in (await db.execute(stmt)).all():
            by_type[tx_type.value] = {"count": int(n), "amount": int(total or 0)}

    def total(types) -> int:
        return sum(by_type.get(t.value, {}).get("amount", 0) for t in types)

    platform_id = await platform_account_id(db)
    wallets = (await db.execute(
        select(
            func.coalesce(func.sum(case((Wallet.account_id != platform_id, Wallet.available_balance), else_=0)), 0),
            func.coalesce(func.sum(case((Wallet.account_id == platform_id, Wallet.available_balance), else_=0)), 0),
            func.coalesce(func.sum(Wallet.locked_balance), 0),
        )
    )).one()
    escrow = (await db.execute(
        select(func.count(), func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0))
        .where(Order.status.in_(ESCROW_OPEN_STATUSES), order_in_books())
    )).one()
    pending_withdrawals = await db.scalar(
        select(func.count()).select_from(WithdrawRequest)
        # Money stays locked until the transfer is confirmed: approved-unpaid counts too.
        .where(WithdrawRequest.status.in_((WithdrawStatus.pending, WithdrawStatus.approved)))
    )
    run = (await db.execute(
        select(LedgerReconcileRun.ran_at, LedgerReconcileRun.ok, LedgerReconcileRun.mismatch_count)
        .order_by(LedgerReconcileRun.ran_at.desc()).limit(1)
    )).first()
    return {
        "by_type": by_type,
        # Σ of the filtered rows by direction (what the page's footer shows).
        "filtered_in": total(IN_TYPES),
        "filtered_out": total(OUT_TYPES),
        "filtered_count": sum(v["count"] for v in by_type.values()),
        "money_in": total(SOURCE_IN),
        "money_out": total(SOURCE_OUT),
        "platform_revenue": total((TransactionType.platform_fee,)),
        "user_available": int(wallets[0]),
        "platform_available": int(wallets[1]),
        "locked": int(wallets[2]),
        "escrow_open_orders": int(escrow[0]),
        "escrow_open_amount": int(escrow[1]),
        "pending_withdrawals": int(pending_withdrawals or 0),
        "last_reconcile": (
            {"ran_at": run.ran_at, "ok": run.ok, "mismatch_count": run.mismatch_count} if run else None
        ),
    }


async def account_statement(
    db: AsyncSession, account_id: int, *, start: datetime | None, end: datetime | None,
) -> dict | None:
    """Opening + Σ in − Σ out = closing for one wallet over [start, end)."""
    await _limit_session(db)
    acc = (await db.execute(
        select(Account.id, Account.email, Account.roles, Wallet.id, Wallet.available_balance, Wallet.locked_balance)
        .join(Wallet, Wallet.account_id == Account.id)
        .where(Account.id == account_id)
    )).first()
    if acc is None:
        return None
    wallet_id = acc[3]
    signed = _signed()
    in_expr = case((Transaction.type.in_(IN_TYPES), Transaction.amount), else_=0)
    out_expr = case((Transaction.type.in_(OUT_TYPES), Transaction.amount), else_=0)
    before = and_(Transaction.created_at < start) if start is not None else literal(False)
    in_period = and_(
        Transaction.created_at >= start if start is not None else true(),
        Transaction.created_at < end if end is not None else true(),
    )
    row = (await db.execute(
        select(
            func.coalesce(func.sum(case((before, signed), else_=0)), 0),
            func.coalesce(func.sum(case((in_period, in_expr), else_=0)), 0),
            func.coalesce(func.sum(case((in_period, out_expr), else_=0)), 0),
            func.count().filter(in_period),
        )
        .where(Transaction.wallet_id == wallet_id)
        .where(Transaction.created_at < end if end is not None else true())
    )).one()
    opening, money_in, money_out, count = (int(v) for v in row)
    escrow_role = Order.seller_id if "seller" in (acc[2] or []) else Order.buyer_id
    escrow = (await db.execute(
        select(func.count(), func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0))
        .where(escrow_role == account_id, Order.status.in_(ESCROW_OPEN_STATUSES), order_in_books())
    )).one()
    closing = opening + money_in - money_out
    platform_id = await platform_account_id(db)
    return {
        "account_id": acc[0],
        "email": acc[1],
        "role": _role_of(acc[0], acc[2], platform_id),
        "opening": opening,
        "money_in": money_in,
        "money_out": money_out,
        "closing": closing,
        "count": count,
        "available_now": acc[4],
        "locked_now": acc[5],
        # Only meaningful when the period runs to now: the books must add up
        # to the stored balance (the nightly reconcile checks the same).
        "matches_wallet": closing == acc[4] if end is None else None,
        "escrow_open_orders": int(escrow[0]),
        "escrow_open_amount": int(escrow[1]),
    }


async def reference_group(db: AsyncSession, key: str) -> dict:
    """Every ledger row of one business event, oldest first, with its header."""
    await _limit_session(db)
    cond = _group_condition(key)
    kind, _, ident = key.partition(":")
    rows = (await db.execute(
        select(
            Transaction.id, Transaction.created_at, Transaction.type, Transaction.amount,
            Transaction.description, Transaction.reference_id, Transaction.proof_media,
            Account.id.label("account_id"), Account.email, Account.roles,
        )
        .join(Wallet, Wallet.id == Transaction.wallet_id)
        .join(Account, Account.id == Wallet.account_id)
        .where(cond)
        .order_by(Transaction.created_at, Transaction.id)
        .limit(MAX_GROUP_ROWS)
    )).all()
    platform_id = await platform_account_id(db)
    entries = [{
        "id": r.id, "created_at": r.created_at, "type": r.type.value,
        "direction": TRANSACTION_DIRECTION[r.type].value, "amount": r.amount,
        "description": r.description, "account_id": r.account_id, "account_email": r.email,
        "account_role": _role_of(r.account_id, r.roles, platform_id), "actor": _actor(r.type, r.description, r.reference_id),
        "proof_images": private_images(r.proof_media),
    } for r in rows]
    header: dict = {"kind": kind, "key": key, "label": (await _labels(db, {key})).get(key)}
    if kind == "order":
        buyer, seller = Account.__table__.alias("buyer"), Account.__table__.alias("seller")
        o = (await db.execute(
            select(Order.id, Order.order_code, Order.status, Order.total_amount, Order.refunded_amount,
                   buyer.c.email, seller.c.email)
            .join(buyer, buyer.c.id == Order.buyer_id)
            .join(seller, seller.c.id == Order.seller_id)
            .where(Order.id == int(ident))
        )).first()
        if o is not None:
            sums: dict[str, int] = {}
            for e in entries:
                sums[e["type"]] = sums.get(e["type"], 0) + e["amount"]
            held = sums.get("purchase_hold", 0)
            settled = sums.get("refund", 0) + sums.get("purchase_release", 0) + sums.get("platform_fee", 0)
            header.update({
                "order_id": o[0], "label": o[1], "status": o[2].value, "total_amount": o[3],
                "refunded_amount": o[4], "buyer_email": o[5], "seller_email": o[6],
                # promo subsidy is new money from the platform, never escrow
                "escrow_remaining": held - settled,
                "escrow_open": o[2] in ESCROW_OPEN_STATUSES,
            })
    elif kind == "deposit":
        d = (await db.execute(
            select(DepositIntent.provider, DepositIntent.status, DepositIntent.amount, Account.email)
            .join(Account, Account.id == DepositIntent.account_id)
            .where(DepositIntent.id == int(ident))
        )).first()
        if d is not None:
            header.update({"provider": d[0], "status": d[1].value, "amount": d[2], "account_email": d[3]})
    else:
        w = (await db.execute(
            select(WithdrawRequest.status, WithdrawRequest.amount, WithdrawRequest.fee_amount,
                   WithdrawRequest.bank_name, Account.email, WithdrawRequest.payout_reference,
                   WithdrawRequest.reject_reason)
            .join(Account, Account.id == WithdrawRequest.account_id)
            .where(WithdrawRequest.id == int(ident))
        )).first()
        if w is not None:
            header.update({"status": w[0].value, "amount": w[1], "fee_amount": w[2],
                           "bank_name": w[3], "account_email": w[4],
                           "payout_reference": w[5], "reject_reason": w[6]})
    return {"header": header, "entries": entries}


_AMOUNT = re.compile(r"^\d{1,3}(?:[.,\s]\d{3})+(?:đ|d|vnd)?$|^\d+(?:đ|d|vnd)?$", re.IGNORECASE)
_LIKE_ESCAPE = str.maketrans({"%": r"\%", "_": r"\_", "\\": r"\\"})


async def resolve_search(db: AsyncSession, raw: str, *, limit: int = 8) -> list[dict]:
    """Suggestions for the smart search box. Each one carries the journal
    filter it applies: an account, a reference group, an amount or a row."""
    q = raw.strip()
    if len(q) < 2:
        return []
    await _limit_session(db)
    out: list[dict] = []
    upper = q.upper()

    if upper.startswith("ORD-"):
        for oid, code, b_email in (await db.execute(
            select(Order.id, Order.order_code, Account.email)
            .join(Account, Account.id == Order.buyer_id)
            .where(Order.order_code == upper)
        )).all():
            out.append({"kind": "order", "label": code, "detail": b_email,
                        "filter": {"group": f"order:{oid}"}})

    for did, code, email in (await db.execute(
        select(DepositIntent.id, DepositIntent.payment_code, Account.email)
        .join(Account, Account.id == DepositIntent.account_id)
        .where(DepositIntent.payment_code == upper)
    )).all():
        out.append({"kind": "deposit", "label": code, "detail": email, "filter": {"group": f"deposit:{did}"}})

    for aid, email in (await db.execute(
        select(Account.id, Account.email).where(Account.deposit_code == upper)
    )).all():
        out.append({"kind": "account", "label": email, "detail": f"Mã nạp {upper}", "filter": {"account_id": aid}})

    if _AMOUNT.match(q.replace(" ", "")) or _AMOUNT.match(q):
        digits = re.sub(r"\D", "", q)
        if digits and len(digits) <= 12:
            amount = int(digits)
            if amount > 0:
                out.append({"kind": "amount", "label": f"{amount:,}đ".replace(",", "."),
                            "detail": "Giao dịch đúng số tiền này", "filter": {"amount": amount}})
            if q.isdigit() and await db.scalar(select(Transaction.id).where(Transaction.id == amount)):
                out.append({"kind": "entry", "label": f"Giao dịch #{amount}", "detail": None,
                            "filter": {"entry_id": amount}})

    if not out or "@" in q or not q.replace(" ", "").isdigit():
        pattern = q.lower().translate(_LIKE_ESCAPE)
        platform_id = await platform_account_id(db)
        prefix_first = case((func.lower(Account.email).like(f"{pattern}%", escape="\\"), 0), else_=1)
        for aid, email in (await db.execute(
            select(Account.id, Account.email)
            .where(func.lower(Account.email).like(f"%{pattern}%", escape="\\"))
            .order_by(prefix_first, Account.email)
            .limit(limit)
        )).all():
            role = "Ví sàn" if aid == platform_id else None
            out.append({"kind": "account", "label": email, "detail": role, "filter": {"account_id": aid}})

    return out[:limit]
