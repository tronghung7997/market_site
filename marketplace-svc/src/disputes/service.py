from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event, query_logs
from src.config import settings
from src.logging import current_request_id
from src.models.account import Account
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import DeliveryMode, Product, ProductVariant
from src.models.resource import Resource
from src.resources.service import claim_resources, release_resources
from src.wallet.service import refund_escrow, release_escrow


async def create_dispute(order_id: int, buyer_id: int, reason: str, db: AsyncSession) -> Dispute:
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.buyer_id != buyer_id:
        raise HTTPException(status_code=403, detail="Đây không phải đơn hàng của bạn")
    if order.status != OrderStatus.delivered:
        raise HTTPException(status_code=400, detail="Chỉ có thể khiếu nại đơn đã giao")
    if order.escrow_expires_at and datetime.now(timezone.utc) > order.escrow_expires_at:
        raise HTTPException(status_code=400, detail="Thời gian ký quỹ đã hết hạn")

    existing = await db.scalar(select(Dispute).where(Dispute.order_id == order_id))
    if existing:
        raise HTTPException(status_code=400, detail="Đơn hàng này đã có khiếu nại")

    order.status = OrderStatus.disputed
    dispute = Dispute(order_id=order_id, buyer_id=buyer_id, reason=reason)
    db.add(dispute)
    await log_event(db, "warning", f"Dispute opened on order {order_id}", request_id=current_request_id(),
                    metadata={"event": "dispute_opened", "order_id": order_id, "buyer_id": buyer_id})
    from src.alerts.service import create_alert
    await create_alert("dispute_opened", "warning", "order", order_id,
                       f"Đơn #{order_id} bị khiếu nại: {reason[:100]}", db)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def _enrich_dispute(dispute: Dispute, db: AsyncSession) -> dict:
    """Dispute ORM → dict with product/variant names + buyer email + order amount."""
    order = await db.get(Order, dispute.order_id)
    variant = await db.get(ProductVariant, order.variant_id) if order else None
    product = await db.get(Product, variant.product_id) if variant else None
    buyer = await db.get(Account, dispute.buyer_id)
    return {
        "id": dispute.id, "order_id": dispute.order_id, "buyer_id": dispute.buyer_id,
        "reason": dispute.reason, "status": dispute.status,
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
    variant = await db.get(ProductVariant, order.variant_id) if order else None
    product = await db.get(Product, variant.product_id) if variant else None
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
        "reason": dispute.reason, "status": dispute.status,
        "admin_note": dispute.admin_note, "created_at": dispute.created_at,
        "resolved_at": dispute.resolved_at,
        "order": order_info,
        "resources": resources,
        "timeline": timeline,
    }


async def seller_respond_dispute(dispute_id: int, seller_id: int, seller_note: str, db: AsyncSession) -> dict:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")
    order = await db.get(Order, dispute.order_id)
    if not order or order.seller_id != seller_id:
        raise HTTPException(status_code=403, detail="Đây không phải khiếu nại của bạn")
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


async def refund_dispute(dispute_id: int, admin_note: str, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")

    order = await db.get(Order, dispute.order_id)
    dispute.status = DisputeStatus.resolved_refund
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)
    order.status = OrderStatus.refunded

    await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
    await log_event(db, "info", f"Dispute {dispute_id} refunded", request_id=current_request_id(),
                    metadata={"event": "dispute_refunded", "order_id": order.id, "amount": order.total_amount})
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def reject_dispute(dispute_id: int, admin_note: str, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")

    order = await db.get(Order, dispute.order_id)
    dispute.status = DisputeStatus.resolved_reject
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)
    order.status = OrderStatus.completed

    platform_fee = int(order.total_amount * settings.platform_fee_percent / 100)
    await release_escrow(order.id, order.seller_id, order.total_amount, platform_fee, db)
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Dispute {dispute_id} rejected", request_id=current_request_id(),
                    metadata={"event": "dispute_rejected", "order_id": order.id, "amount": order.total_amount})
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def partial_refund_dispute(dispute_id: int, admin_note: str, refund_amount: int, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")

    order = await db.get(Order, dispute.order_id)
    if refund_amount <= 0 or refund_amount >= order.total_amount:
        raise HTTPException(status_code=400, detail="Số tiền hoàn phải lớn hơn 0 và nhỏ hơn tổng giá trị đơn hàng")

    dispute.status = DisputeStatus.resolved_partial_refund
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)
    order.status = OrderStatus.completed

    await refund_escrow(order.id, order.buyer_id, refund_amount, db)
    order.total_amount -= refund_amount

    platform_fee = int(order.total_amount * settings.platform_fee_percent / 100)
    await release_escrow(order.id, order.seller_id, order.total_amount, platform_fee, db)
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Dispute {dispute_id} partially refunded", request_id=current_request_id(),
                    metadata={"event": "dispute_partial_refunded", "order_id": order.id, "refund_amount": refund_amount})
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def replace_dispute(dispute_id: int, admin_note: str, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")

    order = await db.get(Order, dispute.order_id)
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

    product = await db.get(Product, order.product_id) if order.product_id else None
    escrow_days = product.escrow_days if product else 2
    order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(days=escrow_days)
    order.status = OrderStatus.delivered

    dispute.status = DisputeStatus.resolved_replace
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)

    await log_event(db, "info", f"Dispute {dispute_id} resolved via replacement", request_id=current_request_id(),
                    metadata={"event": "dispute_replaced", "order_id": order.id})
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def extend_warranty_dispute(dispute_id: int, admin_note: str, extra_days: int, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise HTTPException(status_code=404, detail="Không tìm thấy khiếu nại")
    if dispute.status != DisputeStatus.open:
        raise HTTPException(status_code=400, detail="Khiếu nại đã được xử lý")
    if extra_days <= 0:
        raise HTTPException(status_code=400, detail="Số ngày gia hạn phải lớn hơn 0")

    order = await db.get(Order, dispute.order_id)
    base = order.escrow_expires_at or datetime.now(timezone.utc)
    order.escrow_expires_at = base + timedelta(days=extra_days)
    order.status = OrderStatus.delivered

    dispute.status = DisputeStatus.resolved_extend_warranty
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)

    await log_event(db, "info", f"Dispute {dispute_id} resolved via warranty extension", request_id=current_request_id(),
                    metadata={"event": "dispute_warranty_extended", "order_id": order.id, "extra_days": extra_days})
    await db.commit()
    await db.refresh(dispute)
    return dispute
