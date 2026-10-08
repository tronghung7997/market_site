"""Period finance report and period close (Tài chính › Báo cáo).

Read side over the ledger (``transactions``), the system of record:

- ``period_report``   platform P&L for [start, end) against a comparison
                      period, the balance of money held for users (opening +
                      in − out = closing, checked against a replay of every
                      wallet / escrow / withdrawal lock at the end), deposit
                      channels, top sellers and cost programmes;
- ``close_checklist`` what is still open before a period can be closed;
- ``close_period``    freezes the report as a snapshot (one row per period,
                      periods never overlap) — audit-logged;
- ``list_closes``     closed periods with drift: the live report against the
                      snapshot, and rows booked into the period after close;
- ``export_package``  ZIP of CSVs for the accountant.

Every aggregate is one grouped query; the balance replays the ledger up to
the period end in a single pass. Calls run under the analytics session
limits (statement timeout, no parallel workers).
"""
from __future__ import annotations

import csv
import io
import zipfile
from datetime import datetime, timedelta, timezone

from sqlalchemy import Text, and_, case, cast, func, literal, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.fees.settings import platform_account_id
from src.ledger.journal import IN_TYPES, OUT_TYPES, SEED_WRITEOFF_REF_PREFIX, SOURCE_IN, SOURCE_OUT
from src.models.account import Account
from src.models.finance_period_close import FinancePeriodClose
from src.models.ledger_reconcile_run import LedgerReconcileRun
from src.models.order import Dispute, Order
from src.models.payment import DepositIntent, DepositIntentStatus
from src.models.wallet import Transaction, TransactionType as T, Wallet, WithdrawRequest, WithdrawStatus
from src.wallet.service import ESCROW_OPEN_STATUSES, order_in_books
from src.logging import current_request_id

VN = timezone(timedelta(hours=7))
SESSION_LIMITS = (
    "SET LOCAL statement_timeout = '25s'",
    "SET LOCAL max_parallel_workers_per_gather = 0",
)
MAX_EXPORT_ROWS = 300_000
_CLOSE_LOCK_KEY = 7_420_115  # pg_advisory_xact_lock: one close at a time


class PeriodError(ValueError):
    """Invalid period request (bad range, overlap, still open)."""


async def _limits(db: AsyncSession) -> None:
    for stmt in SESSION_LIMITS:
        await db.execute(text(stmt))


def _kind():
    """Ledger type, with the splits the P&L needs: platform fees booked on
    withdrawals (reference ``withdraw-…``), demo top-ups and seed write-offs."""
    return case(
        (and_(Transaction.type == T.platform_fee, Transaction.reference_id.like("withdraw-%")), literal("platform_withdraw_fee")),
        (and_(Transaction.type == T.adjustment_debit, Transaction.reference_id.like(f"{SEED_WRITEOFF_REF_PREFIX}%")),
         literal("seed_writeoff")),
        (and_(Transaction.type == T.topup, Transaction.description.like("Nạp thử%")), literal("demo_topup")),
        else_=cast(Transaction.type, Text),
    )


async def _flows(db: AsyncSession, start: datetime, end: datetime) -> dict:
    kind = _kind().label("kind")
    rows = (await db.execute(
        select(kind, func.count(), func.coalesce(func.sum(Transaction.amount), 0))
        .where(Transaction.created_at >= start, Transaction.created_at < end)
        .group_by(kind)
    )).all()
    by: dict[str, dict] = {k: {"count": int(n), "amount": int(a)} for k, n, a in rows}

    def a(*kinds: str) -> int:
        return sum(by.get(k, {}).get("amount", 0) for k in kinds)

    def n(*kinds: str) -> int:
        return sum(by.get(k, {}).get("count", 0) for k in kinds)

    disputes = await db.scalar(
        select(func.count()).select_from(Dispute)
        .join(Order, Order.id == Dispute.order_id)
        .where(Dispute.created_at >= start, Dispute.created_at < end, Order.is_seeded.is_(False))
    ) or 0
    order_fee = a("platform_fee")
    withdraw_fee = a("platform_withdraw_fee")
    promo = a("promo_subsidy")
    affiliate = a("affiliate_commission") - a("affiliate_clawback")
    manual = a("topup", "adjustment_credit") - a("adjustment_debit")
    revenue = order_fee + withdraw_fee
    costs = promo + affiliate + manual
    return {
        "gmv": a("purchase_hold"),
        "orders": n("purchase_hold"),
        "revenue": revenue,
        "order_fee": order_fee,
        "withdraw_fee": withdraw_fee,
        "costs": costs,
        "promo_subsidy": promo,
        "affiliate_net": affiliate,
        "manual_net": manual,
        "net": revenue - costs,
        "refunds": a("refund"),
        "refund_count": n("refund"),
        "disputes_opened": int(disputes),
        "deposits": a("deposit"),
        "deposit_count": n("deposit"),
        "demo_topups": a("demo_topup"),
        "seed_writeoffs": a("seed_writeoff"),
        "withdrawn": a("withdraw"),
        "withdraw_count": n("withdraw"),
        "by_kind": by,
    }


def _sum_where(cond, signed=False):
    value = case((Transaction.type.in_(IN_TYPES), Transaction.amount), (Transaction.type.in_(OUT_TYPES), -Transaction.amount), else_=0) if signed else Transaction.amount
    return func.coalesce(func.sum(case((cond, value), else_=0)), 0)


async def _balance(db: AsyncSession, start: datetime, end: datetime) -> dict:
    """Money held for users: opening + in − out = closing (platform books),
    and the closing figure rebuilt from every wallet, escrow and lock."""
    before_start = Transaction.created_at < start
    in_period = Transaction.created_at >= start
    is_type = Transaction.type.in_
    platform_id = await platform_account_id(db)
    role = case(
        (Account.id == platform_id, literal("platform")),
        (Account.roles.any("seller"), literal("seller")),
        else_=literal("buyer"),
    )
    order_fee = and_(Transaction.type == T.platform_fee, Transaction.reference_id.like("order-%"))
    row = (await db.execute(
        select(
            _sum_where(and_(before_start, is_type(SOURCE_IN))) - _sum_where(and_(before_start, is_type(SOURCE_OUT))),
            _sum_where(and_(in_period, Transaction.type == T.deposit)),
            _sum_where(and_(in_period, is_type((T.topup, T.adjustment_credit, T.affiliate_commission, T.promo_subsidy)))),
            _sum_where(and_(in_period, Transaction.type == T.withdraw)),
            _sum_where(and_(in_period, is_type((T.adjustment_debit, T.affiliate_clawback)))),
            _sum_where(role == "buyer", signed=True),
            _sum_where(role == "seller", signed=True),
            _sum_where(role == "platform", signed=True),
            _sum_where(Transaction.type == T.withdraw_lock)
            - _sum_where(is_type((T.withdraw_unlock, T.withdraw, T.withdraw_fee))),
            _sum_where(Transaction.type == T.purchase_hold)
            - _sum_where(is_type((T.refund, T.purchase_release))) - _sum_where(order_fee),
        )
        .select_from(Transaction)
        .join(Wallet, Wallet.id == Transaction.wallet_id)
        .join(Account, Account.id == Wallet.account_id)
        .where(Transaction.created_at < end)
    )).one()
    opening, deposits, injected, withdrawn, removed, buyers, sellers, platform, locked, escrow = (int(v) for v in row)
    closing = opening + deposits + injected - withdrawn - removed
    parts = buyers + sellers + platform + locked + escrow
    # A period that runs to now is also checked against what is actually
    # stored (wallet balances, open orders): that catches balances changed
    # without a ledger row, which a ledger replay alone cannot see.
    stored = None
    if end >= datetime.now(timezone.utc):
        wallets = (await db.execute(select(
            func.coalesce(func.sum(Wallet.available_balance), 0), func.coalesce(func.sum(Wallet.locked_balance), 0),
        ))).one()
        open_escrow = await db.scalar(
            select(func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0))
            .where(Order.status.in_(ESCROW_OPEN_STATUSES), order_in_books())
        ) or 0
        stored = int(wallets[0]) + int(wallets[1]) + int(open_escrow)
    delta = (stored if stored is not None else parts) - closing
    return {
        "opening": opening,
        "deposits": deposits,
        "injected": injected,
        "withdrawn": withdrawn,
        "removed": removed,
        "closing": closing,
        "buyer_wallets": buyers,
        "seller_wallets": sellers,
        "platform_wallet": platform,
        "locked": locked,
        "escrow": escrow,
        "parts_total": parts,
        "stored_total": stored,
        "delta": delta,
        "matches": parts == closing and delta == 0,
    }


async def _channels(db: AsyncSession, start: datetime, end: datetime) -> dict:
    rows = (await db.execute(
        select(DepositIntent.provider, func.count(), func.coalesce(func.sum(DepositIntent.amount), 0))
        .where(DepositIntent.status == DepositIntentStatus.paid,
               DepositIntent.paid_at >= start, DepositIntent.paid_at < end)
        .group_by(DepositIntent.provider)
        .order_by(func.sum(DepositIntent.amount).desc())
    )).all()
    from src.payments.service import list_unmatched_transfers
    unmatched = [u for u in await list_unmatched_transfers(db, limit=1000) if start <= u["received_at"] < end]
    return {
        "providers": [{"provider": p, "count": int(c), "amount": int(s)} for p, c, s in rows],
        "unmatched_count": len(unmatched),
        "unmatched_amount": sum(u["amount"] for u in unmatched),
    }


def _order_ref_join():
    # Seeded orders have no ledger rows; the flag keeps the join honest anyway.
    return and_(Transaction.reference_id == func.concat("order-", Order.id), Order.is_seeded.is_(False))


async def _top_sellers(db: AsyncSession, start: datetime, end: datetime, limit: int = 10) -> list[dict]:
    received = case((Transaction.type.in_((T.purchase_release, T.promo_subsidy)), Transaction.amount), else_=0)
    fee = case((Transaction.type == T.platform_fee, Transaction.amount), else_=0)
    rows = (await db.execute(
        select(Order.seller_id, Account.email, func.sum(received).label("received"), func.sum(fee), func.count(func.distinct(Order.id)))
        .select_from(Transaction)
        .join(Order, _order_ref_join())
        .join(Account, Account.id == Order.seller_id)
        .where(Transaction.type.in_((T.purchase_release, T.promo_subsidy, T.platform_fee)),
               Transaction.created_at >= start, Transaction.created_at < end)
        .group_by(Order.seller_id, Account.email)
        .order_by(func.sum(received).desc())
        .limit(limit)
    )).all()
    return [{"account_id": sid, "email": email, "received": int(r), "fee": int(f), "orders": int(o)} for sid, email, r, f, o in rows]


async def _programs(db: AsyncSession, flows: dict, start: datetime, end: datetime) -> list[dict]:
    promo_rows = (await db.execute(
        select(Order.promo_code, func.count(), func.sum(Transaction.amount))
        .select_from(Transaction)
        .join(Order, _order_ref_join())
        .where(Transaction.type == T.promo_subsidy, Transaction.created_at >= start, Transaction.created_at < end)
        .group_by(Order.promo_code)
        .order_by(func.sum(Transaction.amount).desc())
    )).all()
    out = [{"kind": "promo", "label": code or "(không mã)", "count": int(c), "amount": int(s)} for code, c, s in promo_rows]
    by = flows["by_kind"]
    if flows["affiliate_net"]:
        out.append({"kind": "affiliate", "label": "Hoa hồng giới thiệu (trừ thu hồi)",
                    "count": by.get("affiliate_commission", {}).get("count", 0), "amount": flows["affiliate_net"]})
    if flows["manual_net"]:
        out.append({"kind": "manual", "label": "Cộng / trừ tay",
                    "count": sum(by.get(k, {}).get("count", 0) for k in ("topup", "adjustment_credit", "adjustment_debit")),
                    "amount": flows["manual_net"]})
    return out


def validate_range(start: datetime, end: datetime) -> None:
    if start.tzinfo is None or end.tzinfo is None:
        raise PeriodError("start/end cần có múi giờ")
    if end <= start:
        raise PeriodError("end phải sau start")
    if end - start > timedelta(days=400):
        raise PeriodError("kỳ báo cáo tối đa 400 ngày")


async def _closed_for(db: AsyncSession, start: datetime, end: datetime) -> FinancePeriodClose | None:
    return await db.scalar(select(FinancePeriodClose).where(
        FinancePeriodClose.period_start == start, FinancePeriodClose.period_end == end,
    ))


async def period_report(
    db: AsyncSession, start: datetime, end: datetime, *, compare_start: datetime | None = None,
    compare_end: datetime | None = None,
) -> dict:
    validate_range(start, end)
    await _limits(db)
    if compare_start is None or compare_end is None:
        compare_end, compare_start = start, start - (end - start)
    current = await _flows(db, start, end)
    previous = await _flows(db, compare_start, compare_end)
    close = await _closed_for(db, start, end)
    report = {
        "start": start, "end": end, "compare_start": compare_start, "compare_end": compare_end,
        "current": {k: v for k, v in current.items() if k != "by_kind"},
        "previous": {k: v for k, v in previous.items() if k != "by_kind"},
        "balance": await _balance(db, start, end),
        "channels": await _channels(db, start, end),
        "top_sellers": await _top_sellers(db, start, end),
        "programs": await _programs(db, current, start, end),
        "closed": close_row(close, None) if close else None,
    }
    return report


async def close_checklist(db: AsyncSession, start: datetime, end: datetime) -> dict:
    validate_range(start, end)
    await _limits(db)
    run = (await db.execute(
        select(LedgerReconcileRun.ran_at, LedgerReconcileRun.ok, LedgerReconcileRun.mismatch_count)
        .order_by(LedgerReconcileRun.ran_at.desc()).limit(1)
    )).first()
    pending_deposits = (await db.execute(
        select(func.count(), func.coalesce(func.sum(DepositIntent.amount), 0))
        .where(DepositIntent.status == DepositIntentStatus.pending,
               DepositIntent.created_at >= start, DepositIntent.created_at < end)
    )).one()
    pending_withdrawals = (await db.execute(
        select(func.count(), func.coalesce(func.sum(WithdrawRequest.amount), 0))
        .where(WithdrawRequest.status.in_((WithdrawStatus.pending, WithdrawStatus.approved)), WithdrawRequest.created_at < end)
    )).one()
    manual = (await db.execute(
        select(func.count(), func.count().filter(or_(Transaction.proof_media.is_(None), func.jsonb_array_length(Transaction.proof_media) == 0)))
        .where(Transaction.type.in_((T.topup, T.adjustment_credit, T.adjustment_debit)),
               ~Transaction.description.like("Nạp thử%"),
               Transaction.created_at >= start, Transaction.created_at < end)
    )).one()
    channels = await _channels(db, start, end)
    overlap = await _overlapping(db, start, end)
    now = datetime.now(timezone.utc)
    return {
        "reconcile": {"ran_at": run.ran_at, "ok": run.ok, "mismatch_count": run.mismatch_count,
                      "after_period": run.ran_at >= end} if run else None,
        "pending_deposits": {"count": int(pending_deposits[0]), "amount": int(pending_deposits[1])},
        "unmatched_deposits": {"count": channels["unmatched_count"], "amount": channels["unmatched_amount"]},
        "pending_withdrawals": {"count": int(pending_withdrawals[0]), "amount": int(pending_withdrawals[1])},
        "manual_adjustments": {"count": int(manual[0]), "without_proof": int(manual[1])},
        "period_ended": end <= now,
        "overlaps": close_row(overlap, None) if overlap else None,
        # Blocking: the period must be over and not overlap a closed one.
        # Everything else is a warning the admin acknowledges with a note.
        "can_close": end <= now and overlap is None,
    }


async def _overlapping(db: AsyncSession, start: datetime, end: datetime) -> FinancePeriodClose | None:
    return await db.scalar(select(FinancePeriodClose).where(
        FinancePeriodClose.period_start < end, FinancePeriodClose.period_end > start,
    ).limit(1))


def period_label(start: datetime, end: datetime) -> str:
    s, e = start.astimezone(VN), (end - timedelta(microseconds=1)).astimezone(VN)
    if s.day == 1 and (end.astimezone(VN)).day == 1 and s.hour == 0:
        months = (e.year - s.year) * 12 + e.month - s.month + 1
        if months == 1:
            return f"Tháng {s:%m/%Y}"
        if months == 3 and s.month in (1, 4, 7, 10):
            return f"Quý {(s.month - 1) // 3 + 1}/{s.year}"
    return f"{s:%d/%m/%Y} – {e:%d/%m/%Y}"


def _jsonable(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


async def close_period(db: AsyncSession, start: datetime, end: datetime, *, actor_id: int, note: str | None) -> FinancePeriodClose:
    validate_range(start, end)
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _CLOSE_LOCK_KEY})
    if end > datetime.now(timezone.utc):
        raise PeriodError("Kỳ chưa kết thúc, chưa chốt được")
    if await _overlapping(db, start, end) is not None:
        raise PeriodError("Kỳ này trùng với một kỳ đã chốt")
    report = await period_report(db, start, end)
    last_id = await db.scalar(select(func.coalesce(func.max(Transaction.id), 0))) or 0
    row = FinancePeriodClose(
        period_start=start, period_end=end, label=period_label(start, end),
        note=(note or "").strip() or None, closed_by_id=actor_id,
        last_transaction_id=int(last_id), snapshot=_jsonable(report),
    )
    db.add(row)
    await db.flush()
    await log_event(
        db, "info", f"Chốt kỳ {row.label}", request_id=current_request_id(),
        metadata={
            "event": "finance_period_closed", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "finance_period", "subject_id": row.id, "outcome": "success",
            "period_start": start.isoformat(), "period_end": end.isoformat(),
            "net": report["current"]["net"], "closing": report["balance"]["closing"],
        },
    )
    await db.commit()
    await db.refresh(row)
    return row


def close_row(row: FinancePeriodClose, closed_by: str | None, drift: dict | None = None) -> dict:
    snap = row.snapshot or {}
    return {
        "id": row.id, "label": row.label, "period_start": row.period_start, "period_end": row.period_end,
        "closed_at": row.closed_at, "closed_by": closed_by, "note": row.note,
        "net": (snap.get("current") or {}).get("net"),
        "closing": (snap.get("balance") or {}).get("closing"),
        "drift": drift,
    }


async def list_closes(db: AsyncSession, limit: int = 24) -> list[dict]:
    """Closed periods, newest first, each re-checked against the live books."""
    await _limits(db)
    rows = (await db.execute(
        select(FinancePeriodClose, Account.email)
        .join(Account, Account.id == FinancePeriodClose.closed_by_id)
        .order_by(FinancePeriodClose.period_start.desc())
        .limit(limit)
    )).all()
    out = []
    for row, email in rows:
        live = await _flows(db, row.period_start, row.period_end)
        late = (await db.execute(
            select(func.count(), func.coalesce(func.sum(Transaction.amount), 0))
            .where(Transaction.created_at >= row.period_start, Transaction.created_at < row.period_end,
                   Transaction.id > row.last_transaction_id)
        )).one()
        snap_net = ((row.snapshot or {}).get("current") or {}).get("net") or 0
        out.append(close_row(row, email, {
            "net_delta": live["net"] - snap_net,
            "late_rows": int(late[0]),
            "late_amount": int(late[1]),
        }))
    return out


def _cell(value) -> str:
    """CSV cell safe for spreadsheets: values starting with = + - @ are
    prefixed so they are never evaluated as formulas."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.astimezone(VN).strftime("%Y-%m-%d %H:%M:%S")
    s = str(value)
    if s and s[0] in "=+-@\t\r" and not _is_number(s):
        return "'" + s
    return s


def _is_number(s: str) -> bool:
    try:
        int(s)
        return True
    except ValueError:
        return False


def _csv(header: list[str], rows) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow([_cell(v) for v in r])
    return ("﻿" + buf.getvalue()).encode("utf-8")


async def export_package(db: AsyncSession, start: datetime, end: datetime) -> tuple[str, bytes]:
    """ZIP of CSVs (UTF-8 with BOM so Excel reads Vietnamese)."""
    report = await period_report(db, start, end)
    count = await db.scalar(select(func.count()).select_from(Transaction).where(
        Transaction.created_at >= start, Transaction.created_at < end)) or 0
    if count > MAX_EXPORT_ROWS:
        raise PeriodError(f"Kỳ có {count} bút toán, vượt giới hạn xuất {MAX_EXPORT_ROWS} — chọn kỳ ngắn hơn")
    cur, prev, bal = report["current"], report["previous"], report["balance"]
    summary = [
        ("Kết quả kinh doanh", "", "", ""),
        ("GMV (khách trả)", cur["gmv"], prev["gmv"], cur["gmv"] - prev["gmv"]),
        ("Doanh thu sàn", cur["revenue"], prev["revenue"], cur["revenue"] - prev["revenue"]),
        ("  Phí sàn trên đơn", cur["order_fee"], prev["order_fee"], cur["order_fee"] - prev["order_fee"]),
        ("  Phí rút tiền", cur["withdraw_fee"], prev["withdraw_fee"], cur["withdraw_fee"] - prev["withdraw_fee"]),
        ("Chi phí sàn", cur["costs"], prev["costs"], cur["costs"] - prev["costs"]),
        ("  Bù khuyến mãi", cur["promo_subsidy"], prev["promo_subsidy"], cur["promo_subsidy"] - prev["promo_subsidy"]),
        ("  Hoa hồng giới thiệu (ròng)", cur["affiliate_net"], prev["affiliate_net"], cur["affiliate_net"] - prev["affiliate_net"]),
        ("  Cộng/trừ tay (ròng)", cur["manual_net"], prev["manual_net"], cur["manual_net"] - prev["manual_net"]),
        ("Lãi ròng", cur["net"], prev["net"], cur["net"] - prev["net"]),
        ("Hoàn tiền cho khách", cur["refunds"], prev["refunds"], cur["refunds"] - prev["refunds"]),
        ("", "", "", ""),
        ("Cân đối tiền giữ hộ", "", "", ""),
        ("Số dư đầu kỳ", bal["opening"], "", ""),
        ("+ Nạp vào", bal["deposits"], "", ""),
        ("+ Tiền sàn bơm vào", bal["injected"], "", ""),
        ("- Chuyển khoản rút tiền", bal["withdrawn"], "", ""),
        ("- Trừ tay, thu hồi hoa hồng", bal["removed"], "", ""),
        ("Số dư cuối kỳ", bal["closing"], "", ""),
        ("  Ví người mua", bal["buyer_wallets"], "", ""),
        ("  Ví người bán", bal["seller_wallets"], "", ""),
        ("  Ví sàn", bal["platform_wallet"], "", ""),
        ("  Escrow", bal["escrow"], "", ""),
        ("  Đang khoá chờ rút", bal["locked"], "", ""),
        ("Chênh lệch (thành phần − cuối kỳ)", bal["delta"], "", ""),
    ]
    files: dict[str, bytes] = {"bao-cao.csv": _csv(["Chỉ tiêu", "Kỳ này", "Kỳ trước", "Chênh lệch"], summary)}

    ledger = (await db.execute(
        select(Transaction.id, Transaction.created_at, Account.email, Transaction.type, Transaction.amount,
               Transaction.reference_id, Transaction.description)
        .join(Wallet, Wallet.id == Transaction.wallet_id).join(Account, Account.id == Wallet.account_id)
        .where(Transaction.created_at >= start, Transaction.created_at < end)
        .order_by(Transaction.created_at, Transaction.id)
    )).all()
    files["so-chi-tiet.csv"] = _csv(
        ["Mã GD", "Thời gian (VN)", "Tài khoản", "Loại", "Chiều", "Số tiền", "Tham chiếu", "Diễn giải"],
        ((r.id, r.created_at, r.email, r.type.value,
          "vào" if r.type in IN_TYPES else "ra" if r.type in OUT_TYPES else "nội bộ",
          r.amount, r.reference_id, r.description) for r in ledger),
    )
    deposits = (await db.execute(
        select(DepositIntent.id, DepositIntent.paid_at, Account.email, DepositIntent.provider,
               DepositIntent.payment_code, DepositIntent.amount)
        .join(Account, Account.id == DepositIntent.account_id)
        .where(DepositIntent.status == DepositIntentStatus.paid, DepositIntent.paid_at >= start, DepositIntent.paid_at < end)
        .order_by(DepositIntent.paid_at)
    )).all()
    files["nap-tien.csv"] = _csv(["Lệnh nạp", "Thời gian (VN)", "Tài khoản", "Kênh", "Mã thanh toán", "Số tiền"], deposits)
    withdrawals = (await db.execute(
        select(WithdrawRequest.id, Transaction.created_at, Account.email, WithdrawRequest.amount,
               WithdrawRequest.fee_amount, WithdrawRequest.net_amount, WithdrawRequest.bank_name,
               WithdrawRequest.payout_reference, WithdrawRequest.status)
        .select_from(Transaction)
        .join(WithdrawRequest, Transaction.reference_id == func.concat("withdraw-", WithdrawRequest.id))
        .join(Account, Account.id == WithdrawRequest.account_id)
        .where(Transaction.type == T.withdraw, Transaction.created_at >= start, Transaction.created_at < end)
        .order_by(Transaction.created_at)
    )).all()
    files["rut-tien.csv"] = _csv(
        ["Lệnh rút", "Duyệt lúc (VN)", "Tài khoản", "Số tiền", "Phí", "Thực chuyển", "Ngân hàng", "Mã chuyển khoản", "Trạng thái"],
        ((w[0], w[1], w[2], w[3], w[4], w[5] if w[5] is not None else w[3] - w[4], w[6], w[7], w[8].value) for w in withdrawals),
    )
    manual = (await db.execute(
        select(Transaction.id, Transaction.created_at, Account.email, Transaction.type, Transaction.amount,
               Transaction.description, Transaction.proof_media)
        .join(Wallet, Wallet.id == Transaction.wallet_id).join(Account, Account.id == Wallet.account_id)
        .where(Transaction.type.in_((T.topup, T.adjustment_credit, T.adjustment_debit)),
               Transaction.created_at >= start, Transaction.created_at < end)
        .order_by(Transaction.created_at)
    )).all()
    files["dieu-chinh-tay.csv"] = _csv(
        ["Mã GD", "Thời gian (VN)", "Tài khoản", "Loại", "Số tiền", "Lý do", "Số ảnh chứng từ"],
        ((m.id, m.created_at, m.email, m.type.value, m.amount, m.description, len(m.proof_media or [])) for m in manual),
    )
    signed = case((Transaction.type.in_(IN_TYPES), Transaction.amount), (Transaction.type.in_(OUT_TYPES), -Transaction.amount), else_=0)
    balances = (await db.execute(
        select(Account.id, Account.email, func.sum(signed).label("bal"))
        .select_from(Transaction)
        .join(Wallet, Wallet.id == Transaction.wallet_id).join(Account, Account.id == Wallet.account_id)
        .where(Transaction.created_at < end)
        .group_by(Account.id, Account.email)
        .having(func.sum(signed) != 0)
        .order_by(func.sum(signed).desc())
    )).all()
    files["so-du-cuoi-ky.csv"] = _csv(["Tài khoản #", "Email", "Số dư khả dụng cuối kỳ (theo sổ)"], balances)

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    s = start.astimezone(VN).strftime("%Y%m%d")
    e = (end - timedelta(seconds=1)).astimezone(VN).strftime("%Y%m%d")
    return f"bao-cao-tai-chinh-{s}-{e}.zip", out.getvalue()
