from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.factory import get_adapter
from src.models.account import Account
from src.models.order import Dispute, Order, OrderStatus
from src.models.resource import Resource
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.review import Review
from src.pricing.engine import quote_product
from src.resources.service import claim_resources
from src.audit.service import log_event, query_logs
from src.logging import current_request_id
from src.wallet.service import deduct_credit, refund_escrow, release_escrow


async def create_order(buyer_id: int, variant_id: int, quantity: int, db: AsyncSession) -> Order:
    variant = await db.get(ProductVariant, variant_id)
    if not variant or not variant.is_active:
        raise HTTPException(status_code=404, detail="Không tìm thấy gói sản phẩm")
    product = await db.get(Product, variant.product_id)
    if not product or product.status != ProductStatus.active:
        raise HTTPException(status_code=400, detail="Sản phẩm hiện không khả dụng")
    if product.seller_id == buyer_id:
        raise HTTPException(status_code=400, detail="Không thể mua sản phẩm của chính mình")

    total = variant.price * quantity

    await deduct_credit(buyer_id, total, f"Mua {product.title} — {variant.name} (x{quantity})", "order-pending", db)

    if variant.delivery_mode == DeliveryMode.instant:
        order = Order(
            buyer_id=buyer_id, seller_id=product.seller_id, variant_id=variant_id,
            quantity=quantity, total_amount=total, status=OrderStatus.delivered,
            escrow_expires_at=datetime.now(timezone.utc) + timedelta(days=product.escrow_days),
        )
        db.add(order)
        await db.flush()  # assigns order.id without committing
        resources = await claim_resources(
            variant_id, quantity, db, order_id=order.id, duration_days=variant.duration_days,
        )
        order.delivered_data = "\n".join(r.data for r in resources)
        rid = current_request_id()
        await log_event(db, "info", f"Order {order.id} placed (instant)", request_id=rid,
                        metadata={"event": "order_placed", "order_id": order.id, "buyer_id": buyer_id,
                                  "seller_id": product.seller_id, "amount": total})
        await log_event(db, "info", f"{len(resources)} resource(s) assigned to order {order.id}", request_id=rid,
                        metadata={"event": "resources_assigned", "order_id": order.id,
                                  "resource_ids": [r.id for r in resources]})
    else:
        order = Order(
            buyer_id=buyer_id, seller_id=product.seller_id, variant_id=variant_id,
            quantity=quantity, total_amount=total, status=OrderStatus.pending,
        )
        db.add(order)
        await db.flush()
        await log_event(db, "info", f"Order {order.id} placed (manual)", request_id=current_request_id(),
                        metadata={"event": "order_placed", "order_id": order.id, "buyer_id": buyer_id,
                                  "seller_id": product.seller_id, "amount": total})

    await db.commit()
    await db.refresh(order)
    return order


async def create_order_with_adapter(
    buyer_id: int, product_id: int, user_config: dict, db: AsyncSession
) -> Order:
    """New flow: pricing engine + provider adapter.

    Giá và quantity hiệu dụng lấy từ engine quote — không nhân thêm lần nào.
    """
    product = await db.get(Product, product_id)
    if not product or product.status != ProductStatus.active:
        raise HTTPException(status_code=400, detail="Sản phẩm hiện không khả dụng")
    if not product.provider_id:
        raise HTTPException(status_code=400, detail="Sản phẩm chưa được cấu hình nhà cung cấp")
    if product.seller_id == buyer_id:
        raise HTTPException(status_code=400, detail="Không thể mua sản phẩm của chính mình")

    q = await quote_product(product, user_config, db)
    total_amount = q.amount

    await deduct_credit(
        buyer_id, total_amount,
        f"Mua {product.title} (x{q.quantity})", "order-pending", db,
    )

    order = Order(
        buyer_id=buyer_id,
        seller_id=product.seller_id,
        product_id=product_id,
        quantity=q.quantity,
        total_amount=total_amount,
        status=OrderStatus.pending,
    )
    db.add(order)
    await db.flush()

    rid = current_request_id()

    try:
        adapter = await get_adapter(product.provider_id, db)
        provision_config = {**user_config, "service_type": product.service_type}
        provision_result = await adapter.provision(order.id, provision_config)
    except Exception as e:
        # Adapter load or provision failed — refund and cancel
        await refund_escrow(order.id, buyer_id, total_amount, db)
        order.status = OrderStatus.cancelled
        await log_event(
            db, "error", f"Order {order.id} adapter error: {e}", request_id=rid,
            metadata={"event": "order_adapter_error", "order_id": order.id, "error": str(e)},
        )
        await db.commit()
        await db.refresh(order)
        return order

    if provision_result.success:
        if (provision_result.metadata or {}).get("async_fulfillment"):
            # Xử lý thủ công: order chờ task hoàn thành, chưa bắt đầu escrow
            order.status = OrderStatus.processing
            order.delivered_data = provision_result.data
            await log_event(
                db, "info", f"Order {order.id} awaiting manual fulfillment", request_id=rid,
                metadata={"event": "order_processing", "order_id": order.id,
                           "resource_id": provision_result.resource_id},
            )
        else:
            order.status = OrderStatus.delivered
            order.delivered_data = provision_result.data
            order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(days=product.escrow_days)
            await log_event(
                db, "info", f"Order {order.id} provisioned via adapter", request_id=rid,
                metadata={"event": "order_provisioned", "order_id": order.id,
                           "resource_id": provision_result.resource_id},
            )
        await log_event(
            db, "info", f"Order {order.id} placed (adapter)", request_id=rid,
            metadata={"event": "order_placed", "order_id": order.id, "buyer_id": buyer_id,
                       "seller_id": product.seller_id, "amount": total_amount},
        )
    else:
        await refund_escrow(order.id, buyer_id, total_amount, db)
        order.status = OrderStatus.cancelled
        await log_event(
            db, "error", f"Order {order.id} provision failed: {provision_result.error}", request_id=rid,
            metadata={"event": "order_provision_failed", "order_id": order.id,
                       "error": provision_result.error},
        )

    await db.commit()
    await db.refresh(order)
    return order


async def confirm_order(order_id: int, buyer_id: int, db: AsyncSession) -> Order:
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.buyer_id != buyer_id:
        raise HTTPException(status_code=403, detail="Đây không phải đơn hàng của bạn")
    if order.status != OrderStatus.delivered:
        raise HTTPException(status_code=400, detail="Đơn hàng chưa được giao")
    order.status = OrderStatus.completed
    await release_escrow(order.id, order.seller_id, order.total_amount, platform_fee=0, db=db)
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Order {order.id} confirmed by buyer", request_id=current_request_id(),
                    metadata={"event": "order_confirmed", "order_id": order.id, "amount": order.total_amount})
    await db.commit()
    await db.refresh(order)
    return order


async def _enrich_order(order: Order, db: AsyncSession) -> dict:
    """Order ORM → dict with product/variant names + buyer/seller emails for display."""
    variant = await db.get(ProductVariant, order.variant_id) if order.variant_id else None
    product = None
    if order.product_id:
        product = await db.get(Product, order.product_id)
    elif variant:
        product = await db.get(Product, variant.product_id)
    buyer = await db.get(Account, order.buyer_id)
    seller = await db.get(Account, order.seller_id)
    has_review = (
        await db.scalar(select(Review.id).where(Review.order_id == order.id).limit(1))
    ) is not None
    return {
        "id": order.id, "buyer_id": order.buyer_id, "seller_id": order.seller_id,
        "variant_id": order.variant_id, "product_id": order.product_id,
        "quantity": order.quantity,
        "total_amount": order.total_amount, "status": order.status,
        "escrow_expires_at": order.escrow_expires_at, "delivered_data": order.delivered_data,
        "created_at": order.created_at,
        "product_title": product.title if product else None,
        "variant_name": variant.name if variant else None,
        "buyer_email": buyer.email if buyer else None,
        "seller_email": seller.email if seller else None,
        "has_review": has_review,
    }


async def list_buyer_orders(
    buyer_id: int,
    db: AsyncSession,
    *,
    status: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    sort: str = "newest",
    page: int = 1,
    per_page: int = 20,
) -> dict:
    q = select(Order).where(Order.buyer_id == buyer_id)

    if status == "active":
        q = q.where(Order.status.in_(["pending", "processing", "delivered"]))
    elif status == "disputed":
        q = q.where(Order.status == OrderStatus.disputed)
    elif status == "deleted":
        q = q.where(Order.status.in_(["cancelled", "refunded"]))
    elif status and status in OrderStatus.__members__:
        q = q.where(Order.status == OrderStatus(status))

    if search:
        try:
            q = q.where(Order.id == int(search))
        except ValueError:
            pass  # non-numeric search yields no filter

    if date_from:
        q = q.where(Order.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.where(Order.created_at < datetime.fromisoformat(date_to) + timedelta(days=1))

    # count
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # sort
    if sort == "oldest":
        q = q.order_by(Order.created_at.asc())
    elif sort == "price_desc":
        q = q.order_by(Order.total_amount.desc())
    elif sort == "price_asc":
        q = q.order_by(Order.total_amount.asc())
    else:
        q = q.order_by(Order.created_at.desc())

    q = q.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    items = [await _enrich_order(o, db) for o in result.scalars().all()]

    return {"items": items, "total": total, "page": page, "per_page": per_page}


async def buyer_order_stats(buyer_id: int, db: AsyncSession) -> dict:
    base = select(Order).where(Order.buyer_id == buyer_id)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    active = (await db.execute(
        select(func.count()).select_from(
            base.where(Order.status.in_(["pending", "processing", "delivered"])).subquery()
        )
    )).scalar() or 0
    disputed = (await db.execute(
        select(func.count()).select_from(
            base.where(Order.status == OrderStatus.disputed).subquery()
        )
    )).scalar() or 0
    total_spend = (await db.execute(
        select(func.coalesce(func.sum(Order.total_amount), 0)).where(Order.buyer_id == buyer_id)
    )).scalar() or 0
    return {"total": total, "active": active, "disputed": disputed, "total_spend": total_spend}


async def list_seller_orders(seller_id: int, db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(Order).where(Order.seller_id == seller_id).order_by(Order.created_at.desc())
    )
    return [await _enrich_order(o, db) for o in result.scalars().all()]


async def list_all_orders(db: AsyncSession) -> list[dict]:
    result = await db.execute(select(Order).order_by(Order.created_at.desc()))
    return [await _enrich_order(o, db) for o in result.scalars().all()]


async def get_order(order_id: int, account_id: int, db: AsyncSession) -> dict:
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.buyer_id != account_id and order.seller_id != account_id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền xem đơn hàng này")
    return await _enrich_order(order, db)


async def accept_order(order_id: int, seller_id: int, db: AsyncSession) -> Order:
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.seller_id != seller_id:
        raise HTTPException(status_code=403, detail="Đây không phải đơn hàng của bạn")
    if order.status != OrderStatus.pending:
        raise HTTPException(status_code=400, detail="Đơn hàng không ở trạng thái chờ xử lý")
    order.status = OrderStatus.processing
    await db.commit()
    await db.refresh(order)
    return order


async def get_admin_order_detail(order_id: int, db: AsyncSession) -> dict:
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    enriched = await _enrich_order(order, db)

    resources_result = await db.execute(
        select(Resource).where(Resource.order_id == order_id)
    )
    resources = [
        {"id": r.id, "status": r.status, "expires_at": r.expires_at}
        for r in resources_result.scalars().all()
    ]

    dispute_result = await db.execute(
        select(Dispute).where(Dispute.order_id == order_id)
    )
    dispute_row = dispute_result.scalars().first()
    dispute = None
    if dispute_row:
        dispute = {
            "id": dispute_row.id, "reason": dispute_row.reason,
            "status": dispute_row.status, "admin_note": dispute_row.admin_note,
            "created_at": dispute_row.created_at, "resolved_at": dispute_row.resolved_at,
        }

    logs = await query_logs(db, order_id=order_id)
    timeline = sorted(
        [
            {"event": log.metadata_.get("event", log.message), "timestamp": log.created_at}
            for log in logs if log.metadata_
        ],
        key=lambda x: x["timestamp"],
    )

    return {**enriched, "resources": resources, "dispute": dispute, "timeline": timeline}


async def deliver_order(order_id: int, seller_id: int, data: str, db: AsyncSession) -> Order:
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.seller_id != seller_id:
        raise HTTPException(status_code=403, detail="Đây không phải đơn hàng của bạn")
    if order.status != OrderStatus.processing:
        raise HTTPException(status_code=400, detail="Đơn hàng không ở trạng thái đang xử lý")
    product = None
    if order.product_id:
        product = await db.get(Product, order.product_id)
    elif order.variant_id:
        variant = await db.get(ProductVariant, order.variant_id)
        product = await db.get(Product, variant.product_id) if variant else None
    escrow_days = product.escrow_days if product else 2
    order.status = OrderStatus.delivered
    order.delivered_data = data
    order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(days=escrow_days)
    await log_event(db, "info", f"Order {order.id} delivered manually", request_id=current_request_id(),
                    metadata={"event": "order_delivered_manual", "order_id": order.id})
    await db.commit()
    await db.refresh(order)
    return order
