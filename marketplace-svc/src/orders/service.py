import asyncio
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.compatibility import check_compatibility
from src.adapters.factory import get_adapter
from src.adapters.registry import get_spec
from src.config import settings
from src.database import SessionLocal
from src.gateway.service import mint_gateway_key
from src.models.account import Account
from src.models.order import Dispute, Order, OrderStatus
from src.models.provider import Provider
from src.models.resource import Resource
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.review import Review
from src.pricing.engine import quote_product, resolve_pricing
from src.resources.service import claim_resources
from src.audit.service import log_event, query_logs
from src.logging import current_request_id
from src.sellers.tiers import escrow_days as tier_escrow_days, platform_fee_percent
from src.usage.service import create_balance_for_order, get_usage_summary
from src.wallet.service import deduct_credit, refund_escrow, release_escrow
from src.money.service import get_effective_rate

logger = structlog.get_logger()

_background_tasks: set[asyncio.Task] = set()

# Luôn kèm sau lý do cụ thể — buyer cần biết tiền an toàn, đây là điều quan
# trọng nhất khi thấy đơn "Đã huỷ".
_REFUND_NOTE = "Toàn bộ số tiền đã được hoàn về ví của bạn."


def _buyer_cancel_reason(buyer_message: str | None) -> str:
    """Lý do huỷ WHITE-LABEL hiển thị cho buyer. `buyer_message` là thông báo
    cụ thể do adapter cấp (vd hết hàng); None → thông báo chung. Luôn thêm
    trấn an đã hoàn tiền."""
    specific = buyer_message or "Rất tiếc, đơn không thể cấp phát tự động nên đã được huỷ."
    return f"{specific} {_REFUND_NOTE}"


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
    fx_snapshot = await get_effective_rate(db)

    if variant.delivery_mode == DeliveryMode.instant:
        seller = await db.get(Account, product.seller_id)
        order = Order(
            buyer_id=buyer_id, seller_id=product.seller_id, variant_id=variant_id, product_id=product.id,
            quantity=quantity, total_amount=total, status=OrderStatus.delivered,
            display_fx_rate_snapshot=fx_snapshot,
            escrow_expires_at=datetime.now(timezone.utc) + timedelta(
                days=tier_escrow_days(seller.seller_tier if seller else "new", product.escrow_days)
            ),
        )
        db.add(order)
        await db.flush()  # assigns order.id without committing
        await deduct_credit(buyer_id, total, f"Mua {product.title} — {variant.name} (x{quantity})", f"order-{order.id}", db)
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
            buyer_id=buyer_id, seller_id=product.seller_id, variant_id=variant_id, product_id=product.id,
            quantity=quantity, total_amount=total, status=OrderStatus.pending,
            display_fx_rate_snapshot=fx_snapshot,
        )
        db.add(order)
        await db.flush()
        await deduct_credit(buyer_id, total, f"Mua {product.title} — {variant.name} (x{quantity})", f"order-{order.id}", db)
        await log_event(db, "info", f"Order {order.id} placed (manual)", request_id=current_request_id(),
                        metadata={"event": "order_placed", "order_id": order.id, "buyer_id": buyer_id,
                                  "seller_id": product.seller_id, "amount": total})

    await db.commit()
    await db.refresh(order)
    return order


async def _raise_operational_alert(
    order_id: int, severity: str, message: str, db: AsyncSession,
) -> None:
    """Alert vận hành cho một provision thất bại — GỌI SAU db.commit() của
    caller. Best-effort via emit_incident (own session); never breaks the
    order flow that already completed."""
    from src.alerts.service import emit_incident, fp_order
    from src.providers.credit import ALERT_OUT_OF_CREDIT, report_out_of_credit

    try:
        if severity == "out_of_credit":
            # `message` mang provider_id (xem _apply_provision_result).
            provider_id = int(message)
            await report_out_of_credit(provider_id, db)
            # Admin đã có incident target=provider. Seller của đơn cũng cần
            # biết — hàng của họ vừa fail + provider bị tắt. Gộp theo
            # (seller, provider) để 50 đơn 102 chỉ một dòng active.
            order = await db.get(Order, order_id)
            if order is not None:
                await emit_incident(
                    fingerprint=(
                        f"seller:{order.seller_id}:{ALERT_OUT_OF_CREDIT}:{provider_id}"
                    ),
                    type_=ALERT_OUT_OF_CREDIT,
                    severity="critical",
                    target_type="seller",
                    target_id=order.seller_id,
                    message=(
                        f"Đơn #{order_id} giao thất bại: nhà cung cấp đã hết tiền "
                        f"và đã tạm dừng bán. Khách đã được hoàn tiền — nạp lại rồi "
                        f"cập nhật số dư để tiếp tục bán."
                    ),
                )
            return
        await emit_incident(
            fingerprint=fp_order(order_id, "provision_operational"),
            type_="provision_operational",
            severity=severity,
            target_type="order",
            target_id=order_id,
            message=message,
        )
    except Exception as e:  # noqa: BLE001 — alert hỏng không được kéo theo đơn
        logger.error("provision_alert_failed", order_id=order_id, error=str(e))


async def _apply_provision_result(
    order: Order, product: Product, provision_result, db: AsyncSession, rid: str | None,
    *, resolved_provider_id: int | None = None,
) -> tuple[str, str] | None:
    """Move an order to its post-provision state. Shared by all three callers:
    the inline path, the background task, and the stuck-order sweeper.

    Trả về `(severity, message)` khi provision hỏng vì một lý do VẬN HÀNH
    (hết Xu / sai API key / có thể đã tiêu tiền thượng nguồn mà không giao
    được) — caller có trách nhiệm gọi `_raise_operational_alert` SAU commit.
    Không tự bắn alert ở đây — alert được emit SAU commit qua
    `_raise_operational_alert`. `None` = thất bại thường (buyer đã được hoàn
    tiền, chỉ cần log).

    `resolved_provider_id` is the provider that ACTUALLY fulfilled this order
    (post-fallback — `adapter.provider_id` when the adapter tracks one,
    else `product.provider_id`), snapshotted onto the order. The gateway
    router resolves through `order.provider_id`, not `product.provider_id`,
    so re-linking the product to a different provider later can't silently
    redirect a buyer's already-sold gateway key to a different seller.
    """
    if provision_result.success:
        order.provider_id = resolved_provider_id
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
            seller = await db.get(Account, product.seller_id)
            order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(
                days=tier_escrow_days(seller.seller_tier if seller else "new", product.escrow_days)
            )
            strategy_name, strategy_params = await resolve_pricing(product, db)
            if strategy_name == "credit":
                # order.quantity = package_size buyer đã trả tiền mua (xem
                # CreditPricing._subtotal) — chốt số dư ngay lúc giao, không
                # đọc lại cấu hình sản phẩm sau này. endpoint_rates chốt cùng lúc.
                await create_balance_for_order(order, db, pricing_params=strategy_params)
                provider = await db.get(Provider, resolved_provider_id) if resolved_provider_id else None
                provider_spec = get_spec(provider.adapter_type) if provider else None
                if provider_spec and provider_spec.mints_gateway_key:
                    # buyer không bao giờ thấy base_url/api_key thật của seller
                    # — chỉ một key nền tảng tự cấp, gọi qua POST/GET
                    # /gw/{key}/<endpoint> (src/gateway/router.py).
                    gateway_key = await mint_gateway_key(order)
                    order.delivered_data = (
                        f"Gateway key: {gateway_key}\n"
                        f"Gọi qua: {settings.backend_base_url}/gw/{gateway_key}/<endpoint>"
                    )
            await log_event(
                db, "info", f"Order {order.id} provisioned via adapter", request_id=rid,
                metadata={"event": "order_provisioned", "order_id": order.id,
                           "resource_id": provision_result.resource_id},
            )
    else:
        await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
        order.status = OrderStatus.cancelled
        order.cancel_reason = _buyer_cancel_reason(provision_result.buyer_message)
        await log_event(
            db, "error", f"Order {order.id} provision failed: {provision_result.error}", request_id=rid,
            metadata={"event": "order_provision_failed", "order_id": order.id,
                       "error": provision_result.error},
        )
        if getattr(provision_result, "provider_out_of_credit", False) and resolved_provider_id:
            # Hết tiền là chuyện của NHÀ CUNG CẤP, không phải của đơn này: cảnh
            # báo gắn vào provider (gộp một dòng dù 50 đơn cùng fail) và tạm
            # dừng bán. Trả về marker để caller gọi sau commit — xem
            # src/providers/credit.py::report_out_of_credit.
            return ("out_of_credit", str(resolved_provider_id))
        operational = getattr(provision_result, "operational_error", None)
        if operational:
            return (getattr(provision_result, "operational_severity", "critical"), operational)
    return None


async def create_order_with_adapter(
    buyer_id: int, product_id: int, user_config: dict, db: AsyncSession
) -> Order:
    """New flow: pricing engine + provider adapter.

    Giá và quantity hiệu dụng lấy từ engine quote — không nhân thêm lần nào.

    Adapter gọi mạng (provisions_over_network=True, xem adapters/base.py) được
    hoãn sang background: đơn commit ở `pending` rồi provision sau, nên request
    không giữ transaction mở suốt thời gian gọi HTTP (worst case ~16.5s). Các
    adapter thuần DB chạy inline như cũ —
    chúng nhanh, và SellerPoolAdapter phải claim tồn kho ngay trong transaction,
    nếu hoãn thì hai buyer có thể cùng đặt món cuối cùng.
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
    fx_snapshot = await get_effective_rate(db)

    # Giới hạn quantity do adapter tự khai (AdapterSpec.max_quantity_per_order,
    # adapters/registry.py) — vd dproxy/topproxy bind đúng MỘT ProxyAllocation
    # mỗi order (UNIQUE(order_id), src/models/proxy_allocation.py): quantity > 1
    # sẽ thu tiền N mà giao 1. Chặn ở đây, trước khi trừ ví hay tạo order row,
    # không chỉ giấu trên frontend (review fixes
    # docs/superpowers/plans/2026-07-22-dproxy-consolidated-review.md P0#1).
    provider_for_quantity_check = await db.get(Provider, product.provider_id)
    quantity_spec = get_spec(
        provider_for_quantity_check.adapter_type if provider_for_quantity_check else None
    )
    if (
        quantity_spec
        and quantity_spec.max_quantity_per_order is not None
        and q.quantity > quantity_spec.max_quantity_per_order
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Sản phẩm này chỉ hỗ trợ tối đa {quantity_spec.max_quantity_per_order} "
                f"đơn vị mỗi đơn — vui lòng giảm số lượng"
            ),
        )

    order = Order(
        buyer_id=buyer_id,
        seller_id=product.seller_id,
        product_id=product_id,
        quantity=q.quantity,
        total_amount=total_amount,
        status=OrderStatus.pending,
        user_config=user_config,
        display_fx_rate_snapshot=fx_snapshot,
    )
    db.add(order)
    await db.flush()

    await deduct_credit(
        buyer_id, total_amount,
        f"Mua {product.title} (x{q.quantity})", f"order-{order.id}", db,
    )

    rid = current_request_id()

    try:
        adapter = await get_adapter(product.provider_id, db)
    except Exception as e:
        await refund_escrow(order.id, buyer_id, total_amount, db)
        order.status = OrderStatus.cancelled
        order.cancel_reason = _buyer_cancel_reason(None)
        await log_event(
            db, "error", f"Order {order.id} adapter error: {e}", request_id=rid,
            metadata={"event": "order_adapter_error", "order_id": order.id, "error": str(e)},
        )
        await db.commit()
        await db.refresh(order)
        return order

    # Phòng thủ tuyến hai: update_product_operations đã chặn việc lưu một cặp
    # provider/strategy không tương thích, nhưng pricing_configs (tier 2 của
    # resolve_pricing) chưa có UI/API quản lý — vẫn có thể bị chỉnh tay ở DB
    # mà không đi qua endpoint đó. Bắt ở đây trước khi gọi provider thật, thay
    # vì để adapter tự raise một lỗi không rõ nguyên nhân.
    provider_row = await db.get(Provider, product.provider_id)
    strategy_name, _ = await resolve_pricing(product, db)
    compat = check_compatibility(provider_row.adapter_type if provider_row else None, strategy_name)
    if compat.level == "block":
        await refund_escrow(order.id, buyer_id, total_amount, db)
        order.status = OrderStatus.cancelled
        order.cancel_reason = _buyer_cancel_reason(None)
        await log_event(
            db, "error", f"Order {order.id} provider/strategy mismatch: {compat.message}", request_id=rid,
            metadata={"event": "order_provider_strategy_mismatch", "order_id": order.id, "error": compat.message},
        )
        await db.commit()
        await db.refresh(order)
        return order

    await log_event(
        db, "info", f"Order {order.id} placed (adapter)", request_id=rid,
        metadata={"event": "order_placed", "order_id": order.id, "buyer_id": buyer_id,
                   "seller_id": product.seller_id, "amount": total_amount},
    )

    if adapter.provisions_over_network:
        # Commit first so the order survives on its own, then provision outside
        # this transaction. If the task never runs (process dies), the order sits
        # at `pending` and provision_sweep_job picks it up — retrying is safe
        # because the Idempotency-Key is deterministic per order id.
        await db.commit()
        await db.refresh(order)
        spawn_provision(order.id)
        return order

    try:
        provision_config = {**user_config, "service_type": product.service_type}
        provision_result = await adapter.provision(order.id, provision_config)
    except Exception as e:
        await refund_escrow(order.id, buyer_id, total_amount, db)
        order.status = OrderStatus.cancelled
        order.cancel_reason = _buyer_cancel_reason(None)
        await log_event(
            db, "error", f"Order {order.id} adapter error: {e}", request_id=rid,
            metadata={"event": "order_adapter_error", "order_id": order.id, "error": str(e)},
        )
        await db.commit()
        await db.refresh(order)
        return order

    resolved_provider_id = getattr(adapter, "provider_id", None) or product.provider_id
    pending_alert = await _apply_provision_result(
        order, product, provision_result, db, rid, resolved_provider_id=resolved_provider_id,
    )

    await db.commit()
    if pending_alert:
        await _raise_operational_alert(order.id, pending_alert[0], pending_alert[1], db)
    await db.refresh(order)
    return order


async def provision_pending_order(order_id: int) -> None:
    """Provision an order that was committed at `pending`, on a fresh session.

    Runs both as the background task spawned by create_order_with_adapter and as
    the retry body of provision_sweep_job, which can collide on the same order.

    The row is locked FOR UPDATE for the duration: without it both callers read
    `pending`, both call the provider, and on a rejection both call refund_escrow
    — paying the buyer back twice. The Idempotency-Key protects the provider side
    of a duplicate, not the wallet. The lock costs holding one connection across
    the provider call, which is acceptable here (background task, one order row)
    but is why the request path must never call this inline.
    """
    async with SessionLocal() as db:
        order = await db.get(Order, order_id, with_for_update=True)
        if order is None or order.status != OrderStatus.pending:
            return
        product = await db.get(Product, order.product_id) if order.product_id else None
        if product is None or not product.provider_id:
            return

        try:
            adapter = await get_adapter(product.provider_id, db)
            provision_config = {**(order.user_config or {}), "service_type": product.service_type}
            provision_result = await adapter.provision(order.id, provision_config)
        except Exception as e:
            # Leave the order at `pending` — the sweeper retries, and only gives up
            # (refund + cancel) once the order is past its deadline.
            # Rollback TRƯỚC khi ghi log: nếu provision chết giữa một flush
            # (vd IntegrityError khi bind allocation), session đang ở trạng
            # thái hỏng — log_event/commit trên session đó nổ tiếp và lỗi
            # biến mất không dấu vết (quan sát thấy 2026-07-23 với mock
            # TopProxy cấp lại idproxy trùng sau restart).
            #
            # Dùng `order_id` (tham số) chứ KHÔNG dùng `order.id`: rollback
            # expire mọi object trong session, đọc lại attribute là một
            # lazy-load trong ngữ cảnh async → MissingGreenlet ném ngược ra
            # khỏi hàm. Trong task nền thì lỗi thật bị nuốt và thay bằng lỗi
            # giả; trong provision_sweep_job thì nó thoát khỏi vòng lặp và
            # chặn luôn việc retry các đơn còn lại của lượt quét đó.
            await db.rollback()
            await log_event(
                db, "error", f"Order {order_id} background provision error: {e}",
                metadata={"event": "order_provision_error", "order_id": order_id, "error": str(e)},
            )
            await db.commit()
            return

        resolved_provider_id = getattr(adapter, "provider_id", None) or product.provider_id
        order_id_for_alert = order.id
        pending_alert = await _apply_provision_result(
            order, product, provision_result, db, None, resolved_provider_id=resolved_provider_id,
        )
        await db.commit()
        if pending_alert:
            await _raise_operational_alert(order_id_for_alert, pending_alert[0], pending_alert[1], db)


def spawn_provision(order_id: int) -> None:
    """Fire provisioning off the request path.

    Kept as a module-level indirection so tests can drive provisioning
    deterministically instead of racing an orphan task.
    """
    task = asyncio.create_task(provision_pending_order(order_id))
    # asyncio only holds a weak reference to running tasks; without this the task
    # can be garbage-collected mid-flight.
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def confirm_order(order_id: int, buyer_id: int, db: AsyncSession) -> Order:
    order = await db.get(Order, order_id, with_for_update=True)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.buyer_id != buyer_id:
        raise HTTPException(status_code=403, detail="Đây không phải đơn hàng của bạn")
    if order.status != OrderStatus.delivered:
        raise HTTPException(status_code=400, detail="Đơn hàng chưa được giao")
    order.status = OrderStatus.completed
    seller = await db.get(Account, order.seller_id)
    fee_percent = platform_fee_percent(seller.seller_tier if seller else "new")
    platform_fee = int(order.total_amount * fee_percent / 100)
    await release_escrow(order.id, order.seller_id, order.total_amount, platform_fee, db=db)
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Order {order.id} confirmed by buyer", request_id=current_request_id(),
                    metadata={"event": "order_confirmed", "order_id": order.id, "amount": order.total_amount})
    await db.commit()
    await db.refresh(order)
    return order


async def _enrich_orders(orders: list[Order], db: AsyncSession) -> list[dict]:
    """Orders ORM → dicts with product/variant names + buyer/seller emails for display.

    Gom lookup theo IN thay vì query từng đơn — list admin/seller từng mất
    ~6 query × N đơn (2.3s với 80 đơn), giờ cố định 5 query bất kể N.
    """
    if not orders:
        return []

    variants: dict[int, ProductVariant] = {}
    variant_ids = {o.variant_id for o in orders if o.variant_id}
    if variant_ids:
        rows = await db.execute(select(ProductVariant).where(ProductVariant.id.in_(variant_ids)))
        variants = {v.id: v for v in rows.scalars()}

    products: dict[int, Product] = {}
    product_ids = {o.product_id for o in orders if o.product_id}
    product_ids |= {v.product_id for v in variants.values()}
    if product_ids:
        rows = await db.execute(select(Product).where(Product.id.in_(product_ids)))
        products = {p.id: p for p in rows.scalars()}

    accounts: dict[int, Account] = {}
    account_ids = {o.buyer_id for o in orders} | {o.seller_id for o in orders}
    if account_ids:
        rows = await db.execute(select(Account).where(Account.id.in_(account_ids)))
        accounts = {a.id: a for a in rows.scalars()}

    order_ids = [o.id for o in orders]
    reviewed = set(
        (await db.execute(select(Review.order_id).where(Review.order_id.in_(order_ids)))).scalars()
    )
    disputed = set(
        (await db.execute(select(Dispute.order_id).where(Dispute.order_id.in_(order_ids)))).scalars()
    )

    out = []
    for order in orders:
        variant = variants.get(order.variant_id) if order.variant_id else None
        product = None
        if order.product_id:
            product = products.get(order.product_id)
        elif variant:
            product = products.get(variant.product_id)
        buyer = accounts.get(order.buyer_id)
        seller = accounts.get(order.seller_id)
        out.append({
            "id": order.id, "buyer_id": order.buyer_id, "seller_id": order.seller_id,
            "variant_id": order.variant_id, "product_id": order.product_id,
            "quantity": order.quantity,
            "total_amount": order.total_amount, "status": order.status,
            "display_fx_rate_snapshot": order.display_fx_rate_snapshot,
            "escrow_expires_at": order.escrow_expires_at, "delivered_data": order.delivered_data,
            "cancel_reason": order.cancel_reason,
            "created_at": order.created_at,
            "product_title": product.title if product else None,
            "variant_name": variant.name if variant else None,
            "buyer_email": buyer.email if buyer else None,
            "seller_email": seller.email if seller else None,
            "has_review": order.id in reviewed,
            "has_dispute": order.id in disputed,
        })
    return out


async def _enrich_order(order: Order, db: AsyncSession) -> dict:
    """Order ORM → dict with product/variant names + buyer/seller emails for display."""
    return (await _enrich_orders([order], db))[0]


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
    items = await _enrich_orders(list(result.scalars().all()), db)

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
    return await _enrich_orders(list(result.scalars().all()), db)


async def list_all_orders(db: AsyncSession) -> list[dict]:
    result = await db.execute(select(Order).order_by(Order.created_at.desc()))
    return await _enrich_orders(list(result.scalars().all()), db)


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

    usage = await get_usage_summary(order_id, db)

    return {**enriched, "resources": resources, "dispute": dispute, "timeline": timeline, "usage": usage}


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
    base_escrow_days = product.escrow_days if product else 2
    seller = await db.get(Account, seller_id)
    order.status = OrderStatus.delivered
    order.delivered_data = data
    order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(
        days=tier_escrow_days(seller.seller_tier if seller else "new", base_escrow_days)
    )
    await log_event(db, "info", f"Order {order.id} delivered manually", request_id=current_request_id(),
                    metadata={"event": "order_delivered_manual", "order_id": order.id})
    await db.commit()
    await db.refresh(order)
    return order
