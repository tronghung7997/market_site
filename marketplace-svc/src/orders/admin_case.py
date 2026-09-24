"""Admin order page — everything about one order, and what an operator can do.

The admin console used to show an order in a slide-over with a handful of
fields and bare event names. The order page needs the money trail (every
ledger row that references it), the delivered lines, the case, delivery
tasks, both parties' track records, the system story, internal notes — and
the actions an operator actually takes on a stuck or contested order.

Money actions reuse the same primitives as the buyer confirm / escrow job /
dispute refund paths (release_escrow, refund_escrow, revoke_order_proxy,
affiliate commission and clawback) under the same row lock, so an admin
action and a background job can never settle one order twice.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.admin_logs import enrich
from src.audit.service import log_event, query_logs
from src.disputes.admin_case import buyer_record, party_profile, seller_record
from src.exceptions import ErrorCode, api_error
from src.fees.service import order_fee_percent
from src.logging import current_request_id
from src.models.account import Account
from src.models.log_entry import LogEntry
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import Product
from src.models.provider import Provider
from src.models.resource import Resource
from src.models.service_task import ServiceTask
from src.models.wallet import Transaction, TransactionType, Wallet
from src.usage.service import get_usage_summary
from src.wallet.service import escrow_settlement, refund_escrow, release_escrow

from .service import _enrich_order, spawn_provision

MAX_ESCROW_EXTENSION_DAYS = 30
NOTE_EVENT = "admin_order_note"
DEFAULT_CANCEL_REASON = "Đơn đã được sàn huỷ và hoàn toàn bộ số tiền về ví của bạn."

LEDGER_LABEL = {
    TransactionType.purchase_hold: "Người mua thanh toán (giữ ký quỹ)",
    TransactionType.purchase_release: "Giải ngân cho người bán",
    TransactionType.platform_fee: "Phí sàn",
    TransactionType.refund: "Hoàn tiền cho người mua",
    TransactionType.affiliate_commission: "Hoa hồng affiliate",
    TransactionType.affiliate_clawback: "Thu hồi hoa hồng affiliate",
}


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _lock(order_id: int, db: AsyncSession) -> Order:
    order = await db.get(Order, order_id, with_for_update=True)
    if order is None:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return order


async def _open_dispute(order_id: int, db: AsyncSession) -> Dispute | None:
    return await db.scalar(select(Dispute).where(Dispute.order_id == order_id, Dispute.status == DisputeStatus.open))


def _blocked(reason: str):
    return api_error(ErrorCode.ORDER_ACTION_NOT_ALLOWED, status.HTTP_409_CONFLICT, detail=reason)


def available_actions(order: Order, *, open_dispute: Dispute | None, has_provider: bool, now: datetime) -> list[dict]:
    """Every admin action with whether it applies right now, and why not.
    The page renders all of them so an operator sees what is possible."""
    st = order.status
    remaining = order.total_amount - order.refunded_amount
    dispute_note = "Đơn đang có khiếu nại mở — xử lý trong hồ sơ khiếu nại." if open_dispute else None

    def act(key: str, ok: bool, why: str | None) -> dict:
        return {"key": key, "enabled": ok, "reason": None if ok else why}

    return [
        act("release", st == OrderStatus.delivered and not open_dispute and remaining > 0,
            dispute_note or ("Chỉ giải ngân được đơn đã giao đang giữ ký quỹ." if st != OrderStatus.delivered else "Không còn tiền để giải ngân.")),
        act("refund", st in (OrderStatus.pending, OrderStatus.processing, OrderStatus.delivered) and not open_dispute and remaining > 0,
            dispute_note or ("Đơn đã giải ngân hoặc đã đóng — không hoàn trực tiếp được." if st not in (OrderStatus.pending, OrderStatus.processing, OrderStatus.delivered) else "Không còn tiền để hoàn.")),
        act("extend_escrow", st == OrderStatus.delivered,
            "Chỉ gia hạn được khi đơn đang giữ ký quỹ."),
        act("retry_provision", st == OrderStatus.pending and has_provider,
            "Chỉ cấp lại được đơn đang chờ và dùng nguồn hàng tự động." if st != OrderStatus.pending else "Sản phẩm không dùng nguồn hàng tự động."),
        act("revoke_gateway_key", bool(order.gateway_key_hash), "Đơn không có API key cổng."),
        act("note", True, None),
    ]


async def _ledger(order: Order, db: AsyncSession) -> list[dict]:
    ref = f"order-{order.id}"
    rows = (await db.execute(
        select(Transaction, Wallet.account_id)
        .join(Wallet, Wallet.id == Transaction.wallet_id)
        .where(or_(
            Transaction.reference_id == ref,
            # Partial/dispute/admin refunds carry a ":<reason>" suffix.
            Transaction.reference_id.like(f"{ref}:%"),
            (Transaction.reference_id == str(order.id))
            & Transaction.type.in_((TransactionType.affiliate_commission, TransactionType.affiliate_clawback)),
        ))
        .order_by(Transaction.created_at, Transaction.id)
    )).all()
    owners = {a.id: a for a in (await db.execute(
        select(Account).where(Account.id.in_({aid for _, aid in rows}))
    )).scalars()} if rows else {}
    out = []
    for tx, account_id in rows:
        owner = owners.get(account_id)
        role = ("sàn" if account_id == 1 else "người mua" if account_id == order.buyer_id
                else "người bán" if account_id == order.seller_id else "affiliate")
        out.append({
            "id": tx.id,
            "type": tx.type.value,
            "label": LEDGER_LABEL.get(tx.type, tx.type.value),
            "amount": tx.amount,
            "account_id": account_id,
            "account_label": (owner.display_name or owner.email) if owner else f"#{account_id}",
            "role": role,
            "reference_id": tx.reference_id,
            "created_at": tx.created_at,
        })
    return out


def _lines(resources: list[Resource], claimed: set[int]) -> list[dict]:
    return [
        {"id": r.id, "line": f"#{n:02d}", "status": r.status.value, "expires_at": r.expires_at, "claimed": r.id in claimed}
        for n, r in enumerate(sorted(resources, key=lambda x: x.id), start=1)
    ]


def _money(order: Order, fee_percent: float, ledger: list[dict], now: datetime) -> dict:
    released = sum(r["amount"] for r in ledger if r["type"] == "purchase_release")
    fee = sum(r["amount"] for r in ledger if r["type"] == "platform_fee" and r["reference_id"] == f"order-{order.id}")
    refunded = order.refunded_amount
    remaining = order.total_amount - refunded
    escrow = _utc(order.escrow_expires_at)
    if order.status == OrderStatus.delivered:
        state = "held"
    elif released or fee:
        state = "released"
    elif order.status in (OrderStatus.refunded, OrderStatus.cancelled):
        state = "refunded"
    elif order.status in (OrderStatus.pending, OrderStatus.processing):
        state = "awaiting_delivery"
    else:
        state = "settled"
    payout, projected_fee = escrow_settlement(order.total_amount, refunded, fee_percent)
    return {
        "total": order.total_amount,
        "refunded": refunded,
        "remaining": remaining,
        "released_to_seller": released,
        "platform_fee": fee,
        "fee_percent": fee_percent,
        "projected_seller_payout": payout - projected_fee if state in ("held", "awaiting_delivery") else None,
        "projected_platform_fee": projected_fee if state in ("held", "awaiting_delivery") else None,
        "escrow_state": state,
        "escrow_expires_at": order.escrow_expires_at,
        "escrow_overdue": bool(state == "held" and escrow and escrow <= now),
    }


async def admin_order_case(order_id: int, db: AsyncSession) -> dict:
    order = await db.get(Order, order_id)
    if order is None:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    now = datetime.now(timezone.utc)
    base = await _enrich_order(order, db)
    product = await db.get(Product, order.product_id) if order.product_id else None
    provider = await db.get(Provider, order.provider_id or (product.provider_id if product else None)) \
        if (order.provider_id or (product and product.provider_id)) else None
    buyer = await db.get(Account, order.buyer_id)
    seller = await db.get(Account, order.seller_id)
    disputes = list((await db.execute(select(Dispute).where(Dispute.order_id == order.id).order_by(Dispute.id))).scalars())
    open_dispute = next((d for d in disputes if d.status == DisputeStatus.open), None)
    resources = list((await db.execute(select(Resource).where(Resource.order_id == order.id))).scalars())
    from src.models.order import DisputeClaimResource
    claimed = set((await db.execute(
        select(DisputeClaimResource.resource_id).where(DisputeClaimResource.dispute_id.in_([d.id for d in disputes]))
    )).scalars()) if disputes else set()
    tasks = list((await db.execute(select(ServiceTask).where(ServiceTask.order_id == order.id).order_by(ServiceTask.id))).scalars())
    ledger = await _ledger(order, db)
    fee_percent = await order_fee_percent(order, seller.seller_tier.value if seller else "new", db)
    logs = await enrich(db, list(reversed(await query_logs(db, order_id=order.id, limit=200))))
    notes = [l for l in logs if (l["metadata"] or {}).get("event") == NOTE_EVENT]

    return {
        **base,
        "order_status": order.status.value,
        "updated_at": order.updated_at,
        "refunded_amount": order.refunded_amount,
        "user_config": order.user_config,
        "product_href": f"/admin/products/{product.id}" if product else None,
        "provider": {"id": provider.id, "name": provider.name, "is_active": provider.is_active,
                     "href": f"/admin/providers?provider={provider.id}"} if provider else None,
        "buyer": party_profile(buyer),
        "seller": party_profile(seller),
        "buyer_record": await buyer_record(db, order.buyer_id),
        "seller_record": await seller_record(db, order.seller_id),
        "money": _money(order, fee_percent, ledger, now),
        "ledger": ledger,
        "lines": _lines(resources, claimed),
        "disputes": [
            {"id": d.id, "status": d.status.value, "reason": d.reason, "created_at": d.created_at,
             "resolved_at": d.resolved_at, "href": f"/admin/disputes/{d.id}"}
            for d in disputes
        ],
        "tasks": [
            {"id": t.id, "platform": t.platform, "status": t.status.value, "assignee": t.assignee,
             "created_at": t.created_at, "updated_at": t.updated_at}
            for t in tasks
        ],
        "usage": await get_usage_summary(order.id, db),
        "events": logs,
        "notes": notes,
        "actions": available_actions(order, open_dispute=open_dispute, has_provider=bool(provider), now=now),
    }


# ── actions ─────────────────────────────────────────────────────────────────

def _audit(order: Order, admin: Account, event: str, note: str | None, **extra) -> dict:
    return {
        "event": event, "order_id": order.id, "actor_id": admin.id, "actor_type": "admin",
        "subject_type": "order", "subject_id": order.id, "source": "admin",
        **({"note": note} if note else {}), **extra,
    }


async def release_order(order_id: int, admin: Account, note: str, db: AsyncSession) -> None:
    """Admin confirms delivery on the buyer's behalf — same settlement as the
    buyer's confirm and the escrow job."""
    order = await _lock(order_id, db)
    if order.status != OrderStatus.delivered:
        raise _blocked("Chỉ giải ngân được đơn đã giao đang giữ ký quỹ.")
    if await _open_dispute(order.id, db):
        raise _blocked("Đơn đang có khiếu nại mở — xử lý trong hồ sơ khiếu nại.")
    seller = await db.get(Account, order.seller_id)
    fee_percent = await order_fee_percent(order, seller.seller_tier if seller else "new", db)
    remaining, platform_fee = escrow_settlement(order.total_amount, order.refunded_amount, fee_percent)
    if remaining:
        await release_escrow(order.id, order.seller_id, remaining, platform_fee, db=db)
    order.status = OrderStatus.completed
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Order {order.id} released by admin #{admin.id}", request_id=current_request_id(),
                    metadata=_audit(order, admin, "admin_order_released", note, amount=remaining, platform_fee=platform_fee))
    await db.commit()


async def refund_order(order_id: int, admin: Account, note: str, buyer_message: str | None, db: AsyncSession) -> None:
    """Cancel and refund everything still in escrow. Not for released orders
    (the seller already has the money) and not while a dispute is open (the
    case file owns that decision)."""
    order = await _lock(order_id, db)
    if order.status not in (OrderStatus.pending, OrderStatus.processing, OrderStatus.delivered):
        raise _blocked("Đơn đã giải ngân hoặc đã đóng — không hoàn trực tiếp được.")
    if await _open_dispute(order.id, db):
        raise _blocked("Đơn đang có khiếu nại mở — xử lý trong hồ sơ khiếu nại.")
    remaining = order.total_amount - order.refunded_amount
    if remaining <= 0:
        raise _blocked("Không còn tiền để hoàn.")
    was = order.status
    await refund_escrow(order.id, order.buyer_id, remaining, db, reference_suffix=":admin-refund")
    order.status = OrderStatus.refunded if was == OrderStatus.delivered else OrderStatus.cancelled
    order.cancel_reason = (buyer_message or "").strip() or DEFAULT_CANCEL_REASON
    # Delivered goods that live upstream (proxies) or behind a gateway key stop working.
    from src.resources.proxy_service import revoke_order_proxy
    await revoke_order_proxy(order.id, order.provider_id, db)
    order.gateway_key_hash = None
    order.gateway_key_prefix = None
    from src.affiliate.service import clawback_commission_for_order
    await clawback_commission_for_order(order, db)
    await log_event(db, "warning", f"Order {order.id} refunded by admin #{admin.id}", request_id=current_request_id(),
                    metadata=_audit(order, admin, "admin_order_refunded", note, amount=remaining, previous_status=was.value))
    await db.commit()


async def extend_escrow(order_id: int, admin: Account, days: int, note: str, db: AsyncSession) -> None:
    order = await _lock(order_id, db)
    if order.status != OrderStatus.delivered:
        raise _blocked("Chỉ gia hạn được khi đơn đang giữ ký quỹ.")
    now = datetime.now(timezone.utc)
    before = _utc(order.escrow_expires_at)
    order.escrow_expires_at = max(before or now, now) + timedelta(days=days)
    await log_event(db, "info", f"Order {order.id} escrow extended {days}d by admin #{admin.id}", request_id=current_request_id(),
                    metadata=_audit(order, admin, "admin_escrow_extended", note, extra_days=days,
                                    old_escrow_expires_at=before.isoformat() if before else None,
                                    new_escrow_expires_at=order.escrow_expires_at.isoformat()))
    await db.commit()


async def retry_provision(order_id: int, admin: Account, note: str | None, db: AsyncSession) -> None:
    order = await db.get(Order, order_id)
    if order is None:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    product = await db.get(Product, order.product_id) if order.product_id else None
    if order.status != OrderStatus.pending or not (product and product.provider_id):
        raise _blocked("Chỉ cấp lại được đơn đang chờ và dùng nguồn hàng tự động.")
    await log_event(db, "info", f"Order {order.id} provisioning retried by admin #{admin.id}", request_id=current_request_id(),
                    metadata=_audit(order, admin, "admin_provision_retried", note))
    await db.commit()
    # Same entry point as the sweeper: it takes the row lock and re-checks status.
    spawn_provision(order.id)


async def add_note(order_id: int, admin: Account, body: str, db: AsyncSession) -> dict:
    order = await db.get(Order, order_id)
    if order is None:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await log_event(db, "info", f"Admin note on order {order.id}", request_id=current_request_id(),
                    metadata=_audit(order, admin, NOTE_EVENT, body))
    await db.commit()
    row = await db.scalar(select(LogEntry).where(LogEntry.metadata_["event"].as_string() == NOTE_EVENT,
                                                 LogEntry.metadata_["order_id"].as_string() == str(order.id))
                          .order_by(LogEntry.id.desc()).limit(1))
    return (await enrich(db, [row]))[0]
