"""Admin dispute case file — everything an operator needs to decide.

The buyer/seller views already get the full case (timeline with bodies,
claimed lines, seller remedies, deadlines). The admin view used to get a
thinner, older shape. This module builds the admin case on the same
enrichment, then adds what only an operator should see: both parties'
track records, the money at stake, per-line state, and a rule-based reading
of the case with a suggested next step.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error
from src.fees.service import order_fee_percent
from src.models.account import Account
from src.chat.enums import ConversationKind
from src.models.chat import ChatConversation
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.resource import Resource

from .service import _enrich_dispute, _resolve_order_product

PAID = (OrderStatus.delivered, OrderStatus.completed, OrderStatus.disputed, OrderStatus.refunded)
BUYER_WON = (DisputeStatus.resolved_refund, DisputeStatus.resolved_partial_refund, DisputeStatus.resolved_timeout)
WINDOW_DAYS = 90


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def party_profile(account: Account | None) -> dict | None:
    if account is None:
        return None
    return {
        "id": account.id,
        "name": account.display_name or account.email.split("@")[0],
        "email": account.email,
        "is_internal": account.is_internal,
        "is_active": account.is_active,
        "tier": account.seller_tier.value,
        "created_at": account.created_at,
        "href": f"/admin/accounts?account={account.id}",
    }


async def buyer_record(db: AsyncSession, buyer_id: int, dispute_id: int | None = None) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    paid = int(await db.scalar(select(func.count(Order.id)).where(
        Order.buyer_id == buyer_id, Order.is_seeded.is_(False), Order.status.in_(PAID))) or 0)
    row = (await db.execute(select(
        func.count(Dispute.id),
        func.coalesce(func.sum(case((Dispute.created_at >= since, 1), else_=0)), 0),
        func.coalesce(func.sum(case((Dispute.status.in_(BUYER_WON), 1), else_=0)), 0),
        func.coalesce(func.sum(case((Dispute.status == DisputeStatus.resolved_reject, 1), else_=0)), 0),
    ).where(Dispute.buyer_id == buyer_id, Dispute.id != (dispute_id or 0)))).one()
    recent = (await db.execute(
        select(Dispute.id, Dispute.status, Dispute.created_at, Order.order_code)
        .join(Order, Order.id == Dispute.order_id)
        .where(Dispute.buyer_id == buyer_id, Dispute.id != (dispute_id or 0))
        .order_by(Dispute.created_at.desc()).limit(5)
    )).all()
    other = int(row[0])
    return {
        "paid_orders": paid,
        "other_disputes": other,
        "disputes_90d": int(row[1]),
        "won": int(row[2]),
        "rejected": int(row[3]),
        # This case included: share of the buyer's paid orders that were disputed.
        "dispute_rate": round((other + (1 if dispute_id else 0)) / paid, 4) if paid else (1.0 if dispute_id else 0.0),
        "recent": [
            {"id": r.id, "status": r.status.value, "created_at": r.created_at, "order_code": r.order_code,
             "href": f"/admin/disputes/{r.id}"}
            for r in recent
        ],
    }


async def seller_record(db: AsyncSession, seller_id: int, dispute_id: int | None = None) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    paid_90d = int(await db.scalar(select(func.count(Order.id)).where(
        Order.seller_id == seller_id, Order.is_seeded.is_(False), Order.status.in_(PAID), Order.created_at >= since)) or 0)
    row = (await db.execute(
        select(
            func.count(Dispute.id),
            func.coalesce(func.sum(case((Dispute.status == DisputeStatus.open, 1), else_=0)), 0),
            func.coalesce(func.sum(case((Dispute.status == DisputeStatus.resolved_timeout, 1), else_=0)), 0),
            func.coalesce(func.sum(case((Dispute.status.in_(BUYER_WON), 1), else_=0)), 0),
            func.avg(func.extract("epoch", Dispute.seller_responded_at - Dispute.created_at)),
        )
        .join(Order, Order.id == Dispute.order_id)
        .where(Order.seller_id == seller_id, Dispute.created_at >= since)
    )).one()
    disputes_90d = int(row[0])
    return {
        "paid_orders_90d": paid_90d,
        "disputes_90d": disputes_90d,
        "open_disputes": int(row[1]),
        "timeouts_90d": int(row[2]),
        "lost_90d": int(row[3]),
        "dispute_rate_90d": round(disputes_90d / paid_90d, 4) if paid_90d else 0.0,
        "avg_response_hours": round(float(row[4]) / 3600, 1) if row[4] is not None else None,
    }


def _lines(resources: list[Resource], claimed: set[int], actions: list[dict], claimable: set[int]) -> list[dict]:
    by_original = {a["original_resource_id"]: a for a in actions}
    replacements = {a["replacement_resource_id"] for a in actions if a.get("replacement_resource_id")}
    out = []
    # Delivered lines are numbered #01, #02… in delivery order — the numbers
    # buyer and seller see.
    for n, r in enumerate(sorted(resources, key=lambda x: x.id), start=1):
        action = by_original.get(r.id)
        if action:
            state = "replaced" if action["action"] == "replace" else "refunded"
        elif r.id in claimed:
            state = "claimed"
        elif r.id in replacements:
            state = "replacement"
        else:
            state = "ok"
        out.append({
            "id": r.id,
            "line": f"#{n:02d}",
            "status": r.status.value,
            "expires_at": r.expires_at,
            "state": state,
            "claimed": r.id in claimed,
            "warranty_claimable": r.id in claimable,
            "replacement_resource_id": action.get("replacement_resource_id") if action else None,
            "refund_amount": action.get("refund_amount", 0) if action else 0,
        })
    return out


def _assess(case_: dict, now: datetime) -> tuple[list[dict], dict]:
    """Signals (facts worth noticing) and one suggested next step. Plain
    rules on purpose — each is visible, testable and arguable."""
    signals: list[dict] = []
    is_open = case_["status"] == DisputeStatus.open.value
    money = case_["money"]
    lines = case_["lines"]
    claimed = [l for l in lines if l["claimed"]]
    pending = [l for l in claimed if l["state"] == "claimed"]
    handled = [l for l in claimed if l["state"] in ("replaced", "refunded")]
    buyer, seller = case_["buyer_record"], case_["seller_record"]
    deadline = _as_utc(case_.get("seller_deadline_at"))
    responded = case_.get("seller_responded_at")

    def add(code: str, tone: str, text: str) -> None:
        signals.append({"code": code, "tone": tone, "text": text})

    if is_open and not responded and deadline:
        if deadline <= now:
            add("seller_overdue", "bad", "Người bán đã quá hạn phản hồi đầu tiên — hệ thống sẽ tự hoàn tiền nếu vẫn im lặng.")
        else:
            hours = max(1, int((deadline - now).total_seconds() // 3600))
            add("seller_waiting", "info", f"Người bán còn khoảng {hours} giờ để phản hồi.")
    elif responded:
        add("seller_responded", "good", "Người bán đã phản hồi khiếu nại.")

    if claimed and not is_open:
        add("remedy_final", "info", f"Người bán đã khắc phục {len(handled)}/{len(claimed)} dòng trước khi đóng khiếu nại.")
    elif claimed:
        if not pending:
            add("remedy_complete", "good", f"Người bán đã xử lý {len(handled)}/{len(claimed)} dòng bị khiếu nại (đổi hoặc hoàn).")
        elif handled:
            add("remedy_partial", "warn", f"Còn {len(pending)}/{len(claimed)} dòng bị khiếu nại chưa được xử lý.")
        else:
            add("remedy_none", "warn", f"{len(pending)} dòng bị khiếu nại, người bán chưa đổi/hoàn dòng nào.")
    elif lines:
        add("whole_order", "info", "Người mua khiếu nại cả đơn, không chọn dòng cụ thể.")

    if not case_.get("evidence") and is_open:
        add("no_evidence", "warn", "Người mua chưa gửi bằng chứng (ảnh, video, mô tả lỗi).")
    if case_.get("review_requested_at"):
        add("review_requested", "info", "Đã có bên yêu cầu sàn phân xử.")

    if buyer["paid_orders"] >= 3 and buyer["dispute_rate"] >= 0.3:
        add("buyer_high_rate", "warn",
            f"Người mua khiếu nại {buyer['other_disputes'] + 1}/{buyer['paid_orders']} đơn đã mua ({round(buyer['dispute_rate'] * 100)}%).")
    elif buyer["disputes_90d"] >= 3:
        add("buyer_frequent", "warn", f"Người mua đã mở {buyer['disputes_90d']} khiếu nại khác trong 90 ngày.")
    elif buyer["other_disputes"] == 0:
        add("buyer_first", "good", "Đây là khiếu nại đầu tiên của người mua.")

    if seller["paid_orders_90d"] >= 10 and seller["dispute_rate_90d"] >= 0.05:
        add("seller_high_rate", "warn",
            f"Người bán bị khiếu nại {round(seller['dispute_rate_90d'] * 100, 1)}% đơn trong 90 ngày ({seller['disputes_90d']} vụ).")
    if seller["timeouts_90d"] >= 2:
        add("seller_timeouts", "bad", f"Người bán đã {seller['timeouts_90d']} lần im lặng quá hạn khiếu nại trong 90 ngày.")
    if case_["seller"] and case_["seller"]["is_internal"]:
        add("internal_seller", "info", "Người bán nội bộ — tiền hoàn lấy từ doanh thu của sàn.")

    escrow = _as_utc(case_.get("escrow_expires_at"))
    if is_open and escrow and escrow - now <= timedelta(hours=24):
        add("escrow_soon", "info", "Ký quỹ sắp hết hạn — nên quyết định trước khi tự động đóng.")

    # Suggested next step.
    remaining = money["remaining_refundable"]
    unit = money["unit_price"]
    if not is_open:
        rec = {"action": "none", "text": "Khiếu nại đã đóng.", "amount": None}
    elif remaining <= 0:
        rec = {"action": "reject", "text": "Đơn đã được hoàn hết — đóng khiếu nại.", "amount": None}
    elif any(s["code"] == "seller_overdue" for s in signals):
        rec = {"action": "refund", "text": "Người bán không phản hồi đúng hạn — hoàn phần còn lại cho người mua.", "amount": remaining}
    elif claimed and not pending:
        rec = {"action": "reject", "text": "Người bán đã khắc phục mọi dòng bị khiếu nại — có thể đóng và giải ngân phần còn lại.", "amount": None}
    elif not responded and not handled:
        # Still inside the seller's reply window: let the seller act first.
        rec = {"action": "wait", "text": "Chờ người bán phản hồi hoặc khắc phục trước khi sàn can thiệp.", "amount": None}
    elif pending and len(pending) < max(1, case_["order"]["quantity"]):
        amount = min(remaining, len(pending) * unit)
        money_text = f"{amount:,}".replace(",", ".")
        rec = {"action": "partial_refund",
               "text": f"Hoàn {len(pending)} dòng chưa được khắc phục (~{money_text} ₫), giải ngân phần còn lại cho người bán.",
               "amount": amount}
    elif any(s["code"] in ("buyer_high_rate", "buyer_frequent") for s in signals) and responded:
        rec = {"action": "review", "text": "Người mua có dấu hiệu khiếu nại nhiều — đối chiếu bằng chứng và phản hồi của người bán trước khi hoàn.", "amount": None}
    else:
        rec = {"action": "review", "text": "Hai bên đã trao đổi — đọc diễn biến và bằng chứng rồi quyết định.", "amount": None}
    return signals, rec


async def admin_case(dispute_id: int, db: AsyncSession) -> dict:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    base = await _enrich_dispute(dispute, db)
    order = await db.get(Order, dispute.order_id)
    product, variant = await _resolve_order_product(order, db)
    buyer = await db.get(Account, dispute.buyer_id)
    seller = await db.get(Account, order.seller_id) if order else None
    resources = list((await db.execute(select(Resource).where(Resource.order_id == dispute.order_id))).scalars())

    total = order.total_amount if order else 0
    refunded = order.refunded_amount if order else 0
    quantity = order.quantity if order else 1
    remaining = max(0, total - refunded)
    fee_percent = await order_fee_percent(order, seller.seller_tier.value, db) if order and seller else 0.0
    conversations = list((await db.execute(
        select(ChatConversation.id, ChatConversation.requester_id)
        .where(ChatConversation.kind == ConversationKind.SUPPORT, ChatConversation.order_id == dispute.order_id)
    )).all())

    case_ = {
        **base,
        "status": dispute.status.value,
        "order": {
            "id": order.id if order else dispute.order_id,
            "order_code": order.order_code if order else None,
            "status": order.status.value if order else None,
            "quantity": quantity,
            "total_amount": total,
            "refunded_amount": refunded,
            "created_at": order.created_at if order else None,
            "escrow_expires_at": order.escrow_expires_at if order else None,
            "product_id": product.id if product else None,
            "product_title": product.title if product else None,
            "variant_name": variant.name if variant else None,
            "warranty_text": product.warranty_text if product else None,
            "delivered_data": order.delivered_data if order else None,
            "href": f"/admin/orders/{dispute.order_id}",
            "product_href": f"/admin/products/{product.id}" if product else None,
        },
        "buyer": party_profile(buyer),
        "seller": party_profile(seller),
        "buyer_record": await buyer_record(db, dispute.buyer_id, dispute.id),
        "seller_record": await seller_record(db, order.seller_id, dispute.id) if order else None,
        "money": {
            "order_total": total,
            "refunded": refunded,
            "remaining_refundable": remaining,
            "unit_price": total // quantity if quantity else total,
            "fee_percent": fee_percent,
            # What each outcome moves, from the remaining escrow.
            "seller_payout_if_closed": remaining - int(remaining * fee_percent / 100),
            "platform_fee_if_closed": int(remaining * fee_percent / 100),
        },
        "lines": _lines(resources, set(base["claimed_resource_ids"]), base["resource_actions"],
                        set(base["warranty_claimable_ids"])),
        "conversations": [
            {"id": str(cid), "requester": "seller" if seller and rid == seller.id else "buyer",
             "href": f"/admin/support/{cid}"}
            for cid, rid in conversations
        ],
    }
    if case_["seller_record"] is None:
        case_["seller_record"] = {"paid_orders_90d": 0, "disputes_90d": 0, "open_disputes": 0, "timeouts_90d": 0,
                                  "lost_90d": 0, "dispute_rate_90d": 0.0, "avg_response_hours": None}
    signals, recommendation = _assess(case_, datetime.now(timezone.utc))
    case_["signals"] = signals
    case_["recommendation"] = recommendation
    return case_
