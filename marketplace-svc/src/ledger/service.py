"""Nightly ledger reconciliation (audit item A3.4).

Every change to a wallet balance writes a Transaction of the same amount, and
every order's escrow lives in Transactions referenced `order-<id>`, so the
books must add up without exception. This module recomputes the invariants
from the transaction log and compares them with the stored balances:

  wallet.available_balance == Σ in − Σ out                (TRANSACTION_DIRECTION)
  wallet.locked_balance    == Σ withdraw_lock − Σ withdraw_unlock − Σ withdraw − Σ withdraw_fee
  per order:  Σ purchase_hold == total_amount
              Σ refund        == refunded_amount
              completed → Σ purchase_release + Σ platform_fee == total − refunded
              escrow still open → no release booked yet
  platform:   Σ available + Σ locked + Σ escrow open
           == Σ money in (topup, deposit, adjustment_credit, affiliate_commission)
            − Σ money out (withdraw, adjustment_debit, affiliate_clawback)

Every mismatch becomes an `ledger_mismatch` incident on /admin/alerts (one
per wallet / order, fingerprinted so reruns update instead of duplicating)
and the whole report is kept in ledger_reconcile_runs.
"""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone

import structlog
from sqlalchemy import Integer, case, cast, func, select, true, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts.service import upsert_incident
from src.audit.service import log_event
from src.models.alert import Alert
from src.models.ledger_reconcile_run import LedgerReconcileRun
from src.models.order import Order, OrderStatus
from src.models.wallet import TRANSACTION_DIRECTION, Transaction, TransactionDirection, TransactionType, Wallet
from src.wallet.service import ESCROW_OPEN_STATUSES

logger = structlog.get_logger()

ALERT_TYPE = "ledger_mismatch"
MAX_FINDINGS_STORED = 300
MAX_ALERTS_PER_RUN = 50

_IN_TYPES = [t for t, d in TRANSACTION_DIRECTION.items() if d == TransactionDirection.in_]
_OUT_TYPES = [t for t, d in TRANSACTION_DIRECTION.items() if d == TransactionDirection.out]
_SOURCE_IN = (TransactionType.topup, TransactionType.deposit, TransactionType.adjustment_credit, TransactionType.affiliate_commission)
_SOURCE_OUT = (TransactionType.withdraw, TransactionType.adjustment_debit, TransactionType.affiliate_clawback)


@dataclass
class Finding:
    kind: str            # wallet_available | wallet_locked | order_hold | order_refund | order_settlement | order_release_early | platform
    target_type: str     # wallet | order | platform
    target_id: int
    expected: int
    actual: int
    detail: str = ""

    @property
    def delta(self) -> int:
        return self.actual - self.expected


@dataclass
class LedgerReport:
    wallets_checked: int = 0
    orders_checked: int = 0
    totals: dict = field(default_factory=dict)
    findings: list[Finding] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.findings


def _signed_sum():
    return func.coalesce(func.sum(case(
        (Transaction.type.in_(_IN_TYPES), Transaction.amount),
        (Transaction.type.in_(_OUT_TYPES), -Transaction.amount),
        else_=0,
    )), 0)


async def _check_wallets(db: AsyncSession, report: LedgerReport) -> None:
    locked_expr = func.coalesce(func.sum(case(
        (Transaction.type == TransactionType.withdraw_lock, Transaction.amount),
        (Transaction.type == TransactionType.withdraw_unlock, -Transaction.amount),
        (Transaction.type == TransactionType.withdraw, -Transaction.amount),
        (Transaction.type == TransactionType.withdraw_fee, -Transaction.amount),
        else_=0,
    )), 0)
    rows = (await db.execute(
        select(Wallet.id, Wallet.account_id, Wallet.available_balance, Wallet.locked_balance,
               _signed_sum().label("ledger_available"), locked_expr.label("ledger_locked"))
        .outerjoin(Transaction, Transaction.wallet_id == Wallet.id)
        .group_by(Wallet.id)
        .order_by(Wallet.id)
    )).all()
    report.wallets_checked = len(rows)
    for wallet_id, account_id, available, locked, ledger_available, ledger_locked in rows:
        if int(ledger_available) != available:
            report.findings.append(Finding("wallet_available", "wallet", wallet_id, int(ledger_available), available, f"account #{account_id}"))
        if int(ledger_locked) != locked:
            report.findings.append(Finding("wallet_locked", "wallet", wallet_id, int(ledger_locked), locked, f"account #{account_id}"))


async def _check_orders(db: AsyncSession, report: LedgerReport) -> None:
    # Every escrow transaction references `order-<id>` (refunds may carry a
    # `:dispute:…` suffix); affiliate rows reference the bare id and are
    # therefore ignored by the regexp on purpose.
    order_ref = func.substring(Transaction.reference_id, r"^order-(\d+)(?::|$)")
    def total_of(*types: TransactionType):
        return func.coalesce(func.sum(case((Transaction.type.in_(types), Transaction.amount), else_=0)), 0)
    booked = (
        select(
            cast(order_ref, Integer).label("order_id"),
            total_of(TransactionType.purchase_hold).label("hold"),
            total_of(TransactionType.refund).label("refund"),
            total_of(TransactionType.purchase_release, TransactionType.platform_fee).label("settled"),
        )
        .where(Transaction.reference_id.like("order-%"))
        .group_by(order_ref)
        .subquery()
    )
    rows = (await db.execute(
        select(Order.id, Order.status, Order.total_amount, Order.refunded_amount,
               func.coalesce(booked.c.hold, 0), func.coalesce(booked.c.refund, 0), func.coalesce(booked.c.settled, 0))
        .outerjoin(booked, booked.c.order_id == Order.id)
        .order_by(Order.id)
    )).all()
    report.orders_checked = len(rows)
    open_statuses = set(ESCROW_OPEN_STATUSES)
    for order_id, status, total, refunded, hold, refund, settled in rows:
        hold, refund, settled = int(hold), int(refund), int(settled)
        if total > 0 and hold != total:
            report.findings.append(Finding("order_hold", "order", order_id, total, hold, f"status {status.value}"))
        if refund != refunded:
            report.findings.append(Finding("order_refund", "order", order_id, refunded, refund, f"status {status.value}"))
        if status == OrderStatus.completed and settled != total - refunded:
            report.findings.append(Finding("order_settlement", "order", order_id, total - refunded, settled, "completed"))
        elif status in open_statuses and settled != 0:
            report.findings.append(Finding("order_release_early", "order", order_id, 0, settled, f"status {status.value}"))
        elif status == OrderStatus.refunded and refunded != total:
            report.findings.append(Finding("order_refund", "order", order_id, total, refunded, "refunded but not in full"))


async def _check_platform(db: AsyncSession, report: LedgerReport) -> None:
    available = int(await db.scalar(select(func.coalesce(func.sum(Wallet.available_balance), 0))) or 0)
    locked = int(await db.scalar(select(func.coalesce(func.sum(Wallet.locked_balance), 0))) or 0)
    escrow = int(await db.scalar(
        select(func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0)).where(Order.status.in_(ESCROW_OPEN_STATUSES))
    ) or 0)
    money_in = int(await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(Transaction.type.in_(_SOURCE_IN))
    ) or 0)
    money_out = int(await db.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(Transaction.type.in_(_SOURCE_OUT))
    ) or 0)
    held = available + locked + escrow
    net = money_in - money_out
    report.totals = {
        "available": available, "locked": locked, "escrow_open": escrow, "held_total": held,
        "money_in": money_in, "money_out": money_out, "net_in": net,
    }
    if held != net:
        report.findings.append(Finding("platform", "platform", 0, net, held, "Σ balances + escrow vs Σ money in − out"))


async def reconcile_ledger(db: AsyncSession) -> LedgerReport:
    """Pure check: no writes."""
    report = LedgerReport()
    await _check_wallets(db, report)
    await _check_orders(db, report)
    await _check_platform(db, report)
    return report


def _describe(f: Finding) -> str:
    what = {
        "wallet_available": "số dư khả dụng", "wallet_locked": "số dư đang khóa (rút)",
        "order_hold": "tiền giữ (purchase_hold)", "order_refund": "tiền hoàn", "order_settlement": "tiền giải ngân + phí",
        "order_release_early": "đã giải ngân dù ký quỹ còn mở", "platform": "tổng tiền toàn sàn",
    }[f.kind]
    target = {"wallet": f"Ví #{f.target_id}", "order": f"Đơn #{f.target_id}", "platform": "Toàn sàn"}[f.target_type]
    return f"{target}: {what} lệch {f.delta:+,} ₫ (sổ {f.expected:,} ₫, thực {f.actual:,} ₫). {f.detail}".strip()


async def run_and_record(db: AsyncSession, *, trigger: str = "schedule") -> LedgerReconcileRun:
    """Run the check, store the report, raise/refresh incidents for every
    mismatch and retire the ledger incidents that no longer reproduce."""
    started = time.monotonic()
    report = await reconcile_ledger(db)
    duration_ms = int((time.monotonic() - started) * 1000)

    run = LedgerReconcileRun(
        trigger=trigger, ok=report.ok, duration_ms=duration_ms,
        wallets_checked=report.wallets_checked, orders_checked=report.orders_checked,
        mismatch_count=len(report.findings), totals=report.totals,
        findings=[{**asdict(f), "delta": f.delta} for f in report.findings[:MAX_FINDINGS_STORED]],
    )
    db.add(run)

    live_fingerprints: set[str] = set()
    for f in report.findings[:MAX_ALERTS_PER_RUN]:
        fingerprint = f"ledger:{f.target_type}:{f.target_id}"
        live_fingerprints.add(fingerprint)
        href = f"/admin/orders/{f.target_id}" if f.target_type == "order" else "/admin/reports"
        await upsert_incident(
            db, fingerprint=fingerprint, type_=ALERT_TYPE, severity="critical",
            target_type=f.target_type, target_id=f.target_id, message=_describe(f), href=href,
        )
    # Incidents from earlier runs that are clean now retire themselves; the
    # history stays in the run reports.
    stale = await db.execute(
        update(Alert)
        .where(Alert.type == ALERT_TYPE, Alert.is_active.is_(True),
               Alert.fingerprint.notin_(live_fingerprints) if live_fingerprints else true())
        .values(is_active=False, resolved_at=datetime.now(timezone.utc))
        .returning(Alert.id)
    )
    resolved = len(stale.all())

    await log_event(
        db, "warning" if report.findings else "info",
        f"Ledger reconciliation: {len(report.findings)} mismatch(es) over {report.wallets_checked} wallets and {report.orders_checked} orders",
        metadata={
            "event": "ledger_reconcile", "trigger": trigger, "ok": report.ok, "mismatch_count": len(report.findings),
            "wallets_checked": report.wallets_checked, "orders_checked": report.orders_checked,
            "totals": report.totals, "alerts_resolved": resolved, "duration_ms": duration_ms,
        },
    )
    await db.commit()
    await db.refresh(run)
    logger.info("ledger_reconcile_done", ok=report.ok, mismatches=len(report.findings), duration_ms=duration_ms)
    return run


async def list_runs(db: AsyncSession, limit: int = 20) -> list[LedgerReconcileRun]:
    return list((await db.execute(select(LedgerReconcileRun).order_by(LedgerReconcileRun.id.desc()).limit(limit))).scalars())
