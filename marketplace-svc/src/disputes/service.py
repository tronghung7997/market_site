from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event, query_logs
from src.logging import current_request_id
from src.models.account import Account
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import DeliveryMode, Product, ProductVariant
from src.models.resource import Resource
from src.resources.service import claim_resources, release_resources
from src.sellers.tiers import escrow_days as tier_escrow_days
from src.sellers.tiers import platform_fee_percent
from src.wallet.service import refund_escrow, release_escrow
from src.exceptions import ErrorCode, api_error

_DISPUTE_OUTCOME = {
    DisputeStatus.resolved_refund: "refund",
    DisputeStatus.resolved_reject: "reject",
    DisputeStatus.resolved_partial_refund: "partial_refund",
    DisputeStatus.resolved_replace: "replace",
    DisputeStatus.resolved_extend_warranty: "extend_warranty",
}


def _truncate_reason(reason: str, limit: int = 200) -> str:
    text = (reason or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


async def _enqueue_dispute_opened(db: AsyncSession, dispute: Dispute, order: Order) -> None:
    from src.mail.service import enqueue_mail, frontend_url
    await enqueue_mail(
        db,
        template="dispute_opened",
        account_id=order.seller_id,
        idempotency_key=f"dispute_opened:{dispute.id}",
        payload={
            "order_id": order.id,
            "reason": _truncate_reason(dispute.reason),
            "action_url": frontend_url("vi", "/seller/orders"),
        },
    )


async def _enqueue_dispute_resolved(db: AsyncSession, dispute: Dispute, order: Order) -> None:
    from src.mail.service import enqueue_mail, frontend_url
    outcome = _DISPUTE_OUTCOME.get(dispute.status, dispute.status.value)
    payload = {
        "order_id": order.id,
        "outcome": outcome,
        "admin_note": dispute.admin_note or "",
        "amount": order.total_amount,
    }
    await enqueue_mail(
        db,
        template="dispute_resolved",
        account_id=order.buyer_id,
        idempotency_key=f"dispute_resolved:{dispute.id}:{order.buyer_id}",
        payload={**payload, "action_url": frontend_url("vi", f"/orders/{order.id}")},
    )
    await enqueue_mail(
        db,
        template="dispute_resolved",
        account_id=order.seller_id,
        idempotency_key=f"dispute_resolved:{dispute.id}:{order.seller_id}",
        payload={**payload, "action_url": frontend_url("vi", "/seller/orders")},
    )


async def create_dispute(
    order_id: int, buyer_id: int, reason: str, db: AsyncSession,
    evidence_type: str | None = None, evidence: dict[str, str] | None = None,
) -> Dispute:
    order = await db.get(Order, order_id, with_for_update=True)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != buyer_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    if order.status != OrderStatus.delivered:
        raise api_error(ErrorCode.DISPUTE_ONLY_DELIVERED, status.HTTP_400_BAD_REQUEST)
    if order.escrow_expires_at and datetime.now(timezone.utc) > order.escrow_expires_at:
        raise api_error(ErrorCode.DISPUTE_ESCROW_EXPIRED, status.HTTP_400_BAD_REQUEST)

    existing = await db.scalar(select(Dispute).where(Dispute.order_id == order_id))
    if existing:
        raise api_error(ErrorCode.DISPUTE_ALREADY_OPEN, status.HTTP_400_BAD_REQUEST)

    order.status = OrderStatus.disputed
    dispute = Dispute(
        order_id=order_id, buyer_id=buyer_id, reason=reason,
        evidence_type=evidence_type, evidence=evidence,
    )
    db.add(dispute)
    await db.flush()
    await log_event(db, "warning", f"Dispute opened on order {order_id}", request_id=current_request_id(),
                    metadata={"event": "dispute_opened", "order_id": order_id, "buyer_id": buyer_id})
    from src.alerts.service import add_alert
    await add_alert(
        db,
        type_="dispute_opened",
        severity="warning",
        target_type="order",
        target_id=order_id,
        message=f"Đơn #{order_id} bị khiếu nại: {reason[:100]}",
    )
    await _enqueue_dispute_opened(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def _resolve_order_product(order: Order | None, db: AsyncSession) -> tuple[Product | None, ProductVariant | None]:
    """Đơn cũ (variant_id) và đơn qua adapter (product_id, variant_id rỗng) trỏ tới
    sản phẩm theo 2 đường khác nhau — thiếu nhánh product_id khiến mọi đơn adapter
    hiện "Sản phẩm: —" dù sản phẩm vẫn tồn tại."""
    if not order:
        return None, None
    if order.variant_id:
        variant = await db.get(ProductVariant, order.variant_id)
        product = await db.get(Product, variant.product_id) if variant else None
        return product, variant
    if order.product_id:
        return await db.get(Product, order.product_id), None
    return None, None


async def _enrich_dispute(dispute: Dispute, db: AsyncSession) -> dict:
    """Dispute ORM → dict with product/variant names + buyer email + order amount."""
    order = await db.get(Order, dispute.order_id)
    product, variant = await _resolve_order_product(order, db)
    buyer = await db.get(Account, dispute.buyer_id)
    return {
        "id": dispute.id, "order_id": dispute.order_id, "buyer_id": dispute.buyer_id,
        "reason": dispute.reason, "evidence_type": dispute.evidence_type, "evidence": dispute.evidence,
        "status": dispute.status,
        "admin_note": dispute.admin_note, "seller_note": dispute.seller_note,
        "created_at": dispute.created_at, "resolved_at": dispute.resolved_at,
        "product_title": product.title if product else None,
        "variant_name": variant.name if variant else None,
        "buyer_email": buyer.email if buyer else None,
        "order_amount": order.total_amount if order else None,
    }


async def list_disputes(db: AsyncSession) -> list[dict]:
    result = await db.execute(select(Dispute).order_by(Dispute.created_at.desc()))
    return [await _enrich_dispute(d, db) for d in result.scalars().all()]


async def get_dispute_detail(dispute_id: int, db: AsyncSession) -> dict:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")

    order = await db.get(Order, dispute.order_id)
    product, variant = await _resolve_order_product(order, db)
    buyer = await db.get(Account, dispute.buyer_id)
    seller = await db.get(Account, order.seller_id) if order else None

    order_info = None
    if order:
        order_info = {
            "id": order.id, "buyer_id": order.buyer_id, "seller_id": order.seller_id,
            "variant_id": order.variant_id, "quantity": order.quantity,
            "total_amount": order.total_amount, "status": order.status,
            "escrow_expires_at": order.escrow_expires_at, "delivered_data": order.delivered_data,
            "created_at": order.created_at,
            "product_title": product.title if product else None,
            "variant_name": variant.name if variant else None,
            "buyer_email": buyer.email if buyer else None,
            "seller_email": seller.email if seller else None,
        }

    resources_result = await db.execute(
        select(Resource).where(Resource.order_id == dispute.order_id)
    )
    resources = [
        {"id": r.id, "status": r.status, "expires_at": r.expires_at}
        for r in resources_result.scalars().all()
    ]

    logs = await query_logs(db, order_id=dispute.order_id)
    timeline = sorted(
        [
            {"event": log.metadata_.get("event", log.message), "timestamp": log.created_at}
            for log in logs if log.metadata_
        ],
        key=lambda x: x["timestamp"],
    )

    return {
        "id": dispute.id, "order_id": dispute.order_id, "buyer_id": dispute.buyer_id,
        "reason": dispute.reason, "evidence_type": dispute.evidence_type, "evidence": dispute.evidence,
        "status": dispute.status,
        "admin_note": dispute.admin_note, "seller_note": dispute.seller_note,
        "created_at": dispute.created_at,
        "resolved_at": dispute.resolved_at,
        "order": order_info,
        "resources": resources,
        "timeline": timeline,
    }


async def seller_respond_dispute(dispute_id: int, seller_id: int, seller_note: str, db: AsyncSession) -> dict:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if dispute.status != DisputeStatus.open:
        raise api_error(ErrorCode.DISPUTE_ALREADY_RESOLVED, status.HTTP_400_BAD_REQUEST)
    order = await db.get(Order, dispute.order_id)
    if not order or order.seller_id != seller_id:
        raise api_error(ErrorCode.NOT_OWNER, status.HTTP_403_FORBIDDEN)
    dispute.seller_note = seller_note
    await log_event(db, "info", f"Seller responded to dispute {dispute_id}", request_id=current_request_id(),
                    metadata={"event": "dispute_seller_responded", "order_id": order.id, "seller_id": seller_id})
    await db.commit()
    await db.refresh(dispute)
    return await _enrich_dispute(dispute, db)


async def get_seller_dispute(order_id: int, seller_id: int, db: AsyncSession) -> dict | None:
    order = await db.get(Order, order_id)
    if not order or order.seller_id != seller_id:
        return None
    dispute = await db.scalar(select(Dispute).where(Dispute.order_id == order_id))
    if not dispute:
        return None
    return await _enrich_dispute(dispute, db)


async def list_seller_open_disputes(seller_id: int, db: AsyncSession) -> list[dict]:
    """Khiếu nại đang mở của seller mà seller CHƯA phản hồi (seller_note rỗng).

    Dùng cho bell thông báo — khiếu nại tự động xử lý bất lợi cho seller nếu
    seller im lặng, nên đây là action-item cần nhắc riêng, khác với khiếu nại
    seller đã trả lời và đang chờ admin quyết định.
    """
    result = await db.execute(
        select(Dispute).join(Order, Order.id == Dispute.order_id)
        .where(Order.seller_id == seller_id, Dispute.status == DisputeStatus.open, Dispute.seller_note.is_(None))
        .order_by(Dispute.created_at.desc())
    )
    return [await _enrich_dispute(d, db) for d in result.scalars().all()]


async def get_buyer_dispute(order_id: int, buyer_id: int, db: AsyncSession) -> dict | None:
    order = await db.get(Order, order_id)
    if not order or order.buyer_id != buyer_id:
        return None
    dispute = await db.scalar(select(Dispute).where(Dispute.order_id == order_id))
    if not dispute:
        return None
    return await _enrich_dispute(dispute, db)


async def refund_dispute(dispute_id: int, admin_note: str, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    dispute.status = DisputeStatus.resolved_refund
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)
    order.status = OrderStatus.refunded

    await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
    from src.affiliate.service import clawback_commission_for_order
    await clawback_commission_for_order(order, db)
    await log_event(db, "info", f"Dispute {dispute_id} refunded", request_id=current_request_id(),
                    metadata={"event": "dispute_refunded", "order_id": order.id, "amount": order.total_amount})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def reject_dispute(dispute_id: int, admin_note: str, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    dispute.status = DisputeStatus.resolved_reject
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)
    order.status = OrderStatus.completed

    seller = await db.get(Account, order.seller_id)
    fee_percent = platform_fee_percent(seller.seller_tier if seller else "new")
    platform_fee = int(order.total_amount * fee_percent / 100)
    await release_escrow(order.id, order.seller_id, order.total_amount, platform_fee, db)
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Dispute {dispute_id} rejected", request_id=current_request_id(),
                    metadata={"event": "dispute_rejected", "order_id": order.id, "amount": order.total_amount})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def partial_refund_dispute(dispute_id: int, admin_note: str, refund_amount: int, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    if refund_amount <= 0 or refund_amount >= order.total_amount:
        raise HTTPException(status_code=400, detail="Số tiền hoàn phải lớn hơn 0 và nhỏ hơn tổng giá trị đơn hàng")

    dispute.status = DisputeStatus.resolved_partial_refund
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)
    order.status = OrderStatus.completed

    await refund_escrow(order.id, order.buyer_id, refund_amount, db)
    order.total_amount -= refund_amount

    seller = await db.get(Account, order.seller_id)
    fee_percent = platform_fee_percent(seller.seller_tier if seller else "new")
    platform_fee = int(order.total_amount * fee_percent / 100)
    await release_escrow(order.id, order.seller_id, order.total_amount, platform_fee, db)
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Dispute {dispute_id} partially refunded", request_id=current_request_id(),
                    metadata={"event": "dispute_partial_refunded", "order_id": order.id, "refund_amount": refund_amount})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def replace_dispute(dispute_id: int, admin_note: str, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    variant = await db.get(ProductVariant, order.variant_id) if order.variant_id else None
    if not variant or variant.delivery_mode != DeliveryMode.instant:
        raise HTTPException(status_code=400, detail="Chỉ đơn hàng giao tự động có tài nguyên mới đổi được sản phẩm")

    old_resources = (await db.execute(
        select(Resource).where(Resource.order_id == order.id)
    )).scalars().all()
    if not old_resources:
        raise HTTPException(status_code=400, detail="Đơn hàng chưa có tài nguyên nào được cấp để đổi")

    await release_resources([r.id for r in old_resources], db)
    new_resources = await claim_resources(
        variant.id, order.quantity, db, order_id=order.id, duration_days=variant.duration_days,
    )
    order.delivered_data = "\n".join(r.data for r in new_resources)

    product = await db.get(Product, order.product_id) if order.product_id else await db.get(Product, variant.product_id)
    base_escrow_days = product.escrow_days if product else 2
    seller = await db.get(Account, order.seller_id)
    order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(
        days=tier_escrow_days(seller.seller_tier if seller else "new", base_escrow_days)
    )
    order.status = OrderStatus.delivered

    dispute.status = DisputeStatus.resolved_replace
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)

    await log_event(db, "info", f"Dispute {dispute_id} resolved via replacement", request_id=current_request_id(),
                    metadata={"event": "dispute_replaced", "order_id": order.id})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def extend_warranty_dispute(dispute_id: int, admin_note: str, extra_days: int, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")
    if extra_days <= 0:
        raise HTTPException(status_code=400, detail="Số ngày gia hạn phải lớn hơn 0")

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    base = order.escrow_expires_at or datetime.now(timezone.utc)
    order.escrow_expires_at = base + timedelta(days=extra_days)
    order.status = OrderStatus.delivered

    dispute.status = DisputeStatus.resolved_extend_warranty
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)

    await log_event(db, "info", f"Dispute {dispute_id} resolved via warranty extension", request_id=current_request_id(),
                    metadata={"event": "dispute_warranty_extended", "order_id": order.id, "extra_days": extra_days})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute
