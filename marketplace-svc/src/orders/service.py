import asyncio
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import structlog
from fastapi import status
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.compatibility import check_compatibility
from src.adapters.factory import get_adapter
from src.adapters.registry import get_spec, max_quantity_for
from src.config import settings
from src.database import SessionLocal, id_in
from src.gateway.service import mint_gateway_key
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.orders.constants import MANUAL_DELIVERY_MAX_LENGTH, MAX_ORDER_QUANTITY
from src.orders.delivery import delivered_data_by_order, delivery_summary
from src.orders.manual_stock import consume_manual_stock, manual_stock_allows, take_manual_stock
from src.models.provider import Provider
from src.models.proxy_allocation import ProxyAllocation
from src.models.resource import Resource, resource_search_key
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.review import Review
from src.reviews.service import can_review_order
from src.seller.settings import get_review_window_days
from src.models.service_task import ServiceTask
from src.pricing.engine import quote_product, resolve_pricing
from src.pricing.factory import get_pricing_strategy
from src.resources.service import claim_resources
from src.audit.service import log_event, query_logs
from src.logging import current_request_id
from src.fees.service import escrow_days_for, order_fee_percent
from src.usage.service import create_balance_for_order, get_usage_summary
from src.wallet.service import deduct_credit, escrow_settlement, refund_escrow, release_escrow
from src.disputes.service import orders_with_appendable_claims
from src.exceptions import ErrorCode, ResourceUnavailable, api_error
from src.suppliers.service import precheck_external_purchase
from src.money.service import get_effective_rate
from src.orders.codes import mask_email, parse_order_ref
from src.orders.date_range import created_at_bounds
from src.i18n.search_text import as_row_id, contains_folded
from src.promotions.service import AppliedPromo, apply_code, record_redemption
from src.sellers.service import approved_business_names, seller_refs_by_id

if TYPE_CHECKING:
    from src.adapters.base import ProvisionResult

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


def gateway_access_from_delivery_data(data: str | None) -> dict[str, str] | None:
    """Extract locale-neutral gateway fields from new and legacy delivery data."""
    if not data:
        return None
    key = url = None
    for line in data.splitlines():
        label, separator, value = line.partition("=")
        if separator and label.strip() == "gateway_key":
            key = value.strip()
        elif separator and label.strip() == "gateway_url":
            url = value.strip()
        else:
            label, separator, value = line.partition(":")
            if not separator:
                continue
            if label.strip().lower() == "gateway key":
                key = value.strip()
            elif label.strip().lower() in {"gọi qua", "call url"}:
                url = value.strip()
    return {"key": key, "url": url} if key and url else None


def check_variant_quantity(variant: ProductVariant, quantity: int) -> None:
    """The seller's per-order bounds for this package (before any money moves)."""
    low = variant.min_per_order or 1
    high = variant.max_per_order
    if quantity < low or (high is not None and quantity > high):
        raise api_error(
            ErrorCode.ORDER_QUANTITY_RANGE,
            status.HTTP_400_BAD_REQUEST,
            min=low,
            max=high if high is not None else MAX_ORDER_QUANTITY,
        )


async def _apply_promo(
    promo_code: str | None, buyer_id: int, product: Product, subtotal: int, db: AsyncSession, *, lock: bool,
) -> AppliedPromo | None:
    if not promo_code or not promo_code.strip():
        return None
    return await apply_code(
        db, promo_code, buyer_id=buyer_id, category_id=product.category_id, subtotal=subtotal, lock=lock,
    )


def _promo_fields(promo: AppliedPromo | None) -> dict:
    return {"promo_code": promo.code, "discount_amount": promo.discount} if promo else {}


async def _variant_for_purchase(
    buyer_id: int, variant_id: int, quantity: int, db: AsyncSession, expected_unit_price: int | None,
) -> tuple[ProductVariant, Product]:
    variant = await db.get(ProductVariant, variant_id)
    if not variant or not variant.is_active:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    product = await db.get(Product, variant.product_id)
    if not product or product.status != ProductStatus.active:
        raise api_error(ErrorCode.PRODUCT_UNAVAILABLE, status.HTTP_400_BAD_REQUEST)
    if product.seller_id == buyer_id:
        raise api_error(ErrorCode.SELF_PURCHASE, status.HTTP_400_BAD_REQUEST)
    check_variant_quantity(variant, quantity)
    if expected_unit_price is not None and expected_unit_price != variant.price:
        raise api_error(ErrorCode.ORDER_PRICE_CHANGED, status.HTTP_409_CONFLICT)
    return variant, product


async def create_order(
    buyer_id: int, variant_id: int, quantity: int, db: AsyncSession, *,
    expected_unit_price: int | None = None, promo_code: str | None = None,
) -> Order:
    variant, product = await _variant_for_purchase(buyer_id, variant_id, quantity, db, expected_unit_price)

    # Gói bán lại từ catalog nhà cung cấp (provider external_stock, xem
    # adapters/registry.py): hàng không nằm trong `resources` để claim, phải
    # đi qua adapter mua-theo-đơn. Cùng payload {variant_id, quantity} của
    # chiến lược `fixed`, nên chuyển thẳng sang luồng adapter. The provider
    # stays referenced while that path runs, so its own reads of this
    # provider (quantity cap, adapter) are served from the session.
    provider = await db.get(Provider, product.provider_id) if product.provider_id else None
    spec = get_spec(provider.adapter_type) if provider else None
    if spec and spec.external_stock:
        return await create_order_with_adapter(
            buyer_id, product.id, {"variant_id": variant_id, "quantity": quantity}, db, promo_code=promo_code,
        )

    subtotal = variant.price * quantity
    promo = await _apply_promo(promo_code, buyer_id, product, subtotal, db, lock=True)
    total = subtotal - (promo.discount if promo else 0)
    fx_snapshot = await get_effective_rate(db)

    if variant.delivery_mode == DeliveryMode.instant:
        seller = await db.get(Account, product.seller_id)
        order = Order(
            buyer_id=buyer_id, seller_id=product.seller_id, variant_id=variant_id,
            product_id=product.id,
            quantity=quantity, total_amount=total, status=OrderStatus.delivered,
            display_fx_rate_snapshot=fx_snapshot, **_promo_fields(promo),
            escrow_expires_at=datetime.now(timezone.utc) + timedelta(
                days=await escrow_days_for(db, seller_tier=seller.seller_tier if seller else "new",
                                           product_escrow_days=product.escrow_days, category_id=product.category_id)
            ),
        )
        db.add(order)
        await db.flush()  # assigns order.id without committing
        await deduct_credit(buyer_id, total, f"Mua {product.title} — {variant.name} (x{quantity})", f"order-{order.id}", db)
        if promo:
            await record_redemption(db, promo, order)
        resources = await claim_resources(
            variant_id, quantity, db, order_id=order.id, duration_days=variant.duration_days,
        )
        refund_base, refund_remainder = divmod(total, len(resources))
        for index, resource in enumerate(resources):
            resource.refund_amount_cap = refund_base + (1 if index < refund_remainder else 0)
        # The delivered lines stay in `resources` (encrypted): no text copy on
        # the order, so checkout neither decrypts nor rewrites up to 100 MB.
        rid = current_request_id()
        await log_event(db, "info", f"Order {order.id} placed (instant)", request_id=rid,
                        metadata={"event": "order_placed", "order_id": order.id, "buyer_id": buyer_id,
                                  "seller_id": product.seller_id, "amount": total, **_promo_fields(promo)})
        await log_event(db, "info", f"{len(resources)} resource(s) assigned to order {order.id}", request_id=rid,
                        metadata={"event": "resources_assigned", "order_id": order.id,
                                  "resource_ids": [r.id for r in resources]})
    else:
        order = Order(
            buyer_id=buyer_id, seller_id=product.seller_id, variant_id=variant_id,
            product_id=product.id,
            quantity=quantity, total_amount=total, status=OrderStatus.pending,
            display_fx_rate_snapshot=fx_snapshot, **_promo_fields(promo),
        )
        db.add(order)
        await db.flush()
        await take_manual_stock(variant, order, db)
        await deduct_credit(buyer_id, total, f"Mua {product.title} — {variant.name} (x{quantity})", f"order-{order.id}", db)
        if promo:
            await record_redemption(db, promo, order)
        await log_event(db, "info", f"Order {order.id} placed (manual)", request_id=current_request_id(),
                        metadata={"event": "order_placed", "order_id": order.id, "buyer_id": buyer_id,
                                  "seller_id": product.seller_id, "amount": total, **_promo_fields(promo)})

    await db.commit()
    await db.refresh(order)
    return order


async def quote_order(
    buyer_id: int, db: AsyncSession, *, variant_id: int | None, quantity: int,
    expected_unit_price: int | None = None, product_id: int | None = None,
    user_config: dict | None = None, promo_code: str | None = None,
) -> dict:
    """What `POST /orders` would charge for this body — subtotal, promo
    discount and total — without writing anything. Runs the same product and
    promo checks, so a code that fails here fails at checkout the same way."""
    if variant_id:
        variant, product = await _variant_for_purchase(buyer_id, variant_id, quantity, db, expected_unit_price)
        if not manual_stock_allows(variant, quantity):
            raise ResourceUnavailable()
        subtotal = variant.price * quantity
    else:
        product = await db.get(Product, product_id)
        if not product or product.status != ProductStatus.active:
            raise api_error(ErrorCode.PRODUCT_UNAVAILABLE, status.HTTP_400_BAD_REQUEST)
        if product.seller_id == buyer_id:
            raise api_error(ErrorCode.SELF_PURCHASE, status.HTTP_400_BAD_REQUEST)
        strategy_name, params = await resolve_pricing(product, db)
        normalized = get_pricing_strategy(strategy_name).normalize_user_config(params, user_config or {})
        subtotal = (await quote_product(product, normalized, db, pricing=(strategy_name, params))).amount
    promo = await _apply_promo(promo_code, buyer_id, product, subtotal, db, lock=False)
    discount = promo.discount if promo else 0
    return {
        "subtotal_amount": subtotal, "discount_amount": discount, "total_amount": subtotal - discount,
        "promo_code": promo.code if promo else None,
    }


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
                        f"Đơn {order.order_code} giao thất bại: nhà cung cấp đã hết tiền "
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


def _delivered_text(provision_result: "ProvisionResult") -> str | None:
    """Text to keep on the order: none when the adapter delivered stock rows
    (`resource_ids`), whose lines are read from `resources`."""
    if (provision_result.metadata or {}).get("resource_ids"):
        return None
    return provision_result.data


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
            order.delivered_data = _delivered_text(provision_result)
            await log_event(
                db, "info", f"Order {order.id} awaiting manual fulfillment", request_id=rid,
                metadata={"event": "order_processing", "order_id": order.id,
                           "resource_id": provision_result.resource_id},
            )
        else:
            order.status = OrderStatus.delivered
            order.delivered_data = _delivered_text(provision_result)
            short_refund = getattr(provision_result, "refund_amount", 0) or 0
            if short_refund > 0:
                # Nguồn giao thiếu (adapter accepts_partial_delivery): hoàn phần
                # không giao ngay, cùng transaction với lúc giao.
                await refund_escrow(order.id, order.buyer_id, short_refund, db, reference_suffix="-short")
                meta = provision_result.metadata or {}
                await log_event(
                    db, "warning", f"Order {order.id} partially delivered, refunded {short_refund}", request_id=rid,
                    metadata={"event": "order_partial_delivery", "order_id": order.id,
                              "delivered": meta.get("delivered_quantity"),
                              "requested": meta.get("requested_quantity"), "refunded": short_refund},
                )
            seller = await db.get(Account, product.seller_id)
            order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(
                days=await escrow_days_for(db, seller_tier=seller.seller_tier if seller else "new",
                                           product_escrow_days=product.escrow_days, category_id=product.category_id)
            )
            # Only a credit package reads the params; a fixed one needs no variant list here.
            strategy_name, strategy_params = await resolve_pricing(product, db, with_variants=False)
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
                        f"gateway_key={gateway_key}\n"
                        f"gateway_url={settings.backend_base_url}/gw/{gateway_key}/<endpoint>"
                    )
            # Dòng proxy (DProxy/TopProxy): chốt loại buyer thấy trên dashboard
            # /proxies từ gói đã bán — src/proxies/kinds.py. Không phải đơn
            # proxy thì không có allocation, hàm tự bỏ qua.
            from src.proxies.service import snapshot_line_kind
            from src.resources.proxy_service import finalize_order_lines, list_order_allocations

            lines = await list_order_allocations(order.id, db)  # read once for both steps
            await snapshot_line_kind(order, product, resolved_provider_id, db, allocations=lines)
            # Nhiều proxy trên một đơn: mỗi dòng giữ bản giao riêng + trần hoàn
            # tiền; nhà cung cấp giao THIẾU dòng nào thì hoàn ngay phần đó.
            short = await finalize_order_lines(
                order, db, provision_text=_delivered_text(provision_result), allocations=lines,
            )
            if short > 0:
                await refund_escrow(order.id, order.buyer_id, short, db, reference_suffix=":short-delivery")
                await log_event(
                    db, "warning", f"Order {order.id} short-delivered, refunded {short}", request_id=rid,
                    metadata={"event": "order_short_delivery_refund", "order_id": order.id, "amount": short},
                )
            await log_event(
                db, "info", f"Order {order.id} provisioned via adapter", request_id=rid,
                metadata={"event": "order_provisioned", "order_id": order.id,
                           "resource_id": provision_result.resource_id},
            )
            # Giao một phần vẫn là thành công, nhưng lý do thiếu (hết Xu, lệnh
            # mua không rõ kết quả) vẫn phải tới admin như đơn hỏng hẳn.
            if getattr(provision_result, "provider_out_of_credit", False) and resolved_provider_id:
                return ("out_of_credit", str(resolved_provider_id))
            operational = getattr(provision_result, "operational_error", None)
            if operational:
                return (getattr(provision_result, "operational_severity", "critical"), operational)
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
    buyer_id: int, product_id: int, user_config: dict, db: AsyncSession, *, promo_code: str | None = None,
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
        raise api_error(ErrorCode.PRODUCT_UNAVAILABLE, status.HTTP_400_BAD_REQUEST)
    if not product.provider_id:
        raise api_error(ErrorCode.PROVIDER_NOT_CONFIGURED, status.HTTP_400_BAD_REQUEST)
    if product.seller_id == buyer_id:
        raise api_error(ErrorCode.SELF_PURCHASE, status.HTTP_400_BAD_REQUEST)

    strategy_name, params = await resolve_pricing(product, db)
    strategy = get_pricing_strategy(strategy_name)
    user_config = strategy.normalize_user_config(params, user_config)

    q = await quote_product(product, user_config, db, pricing=(strategy_name, params))
    total_amount = q.amount
    fx_snapshot = await get_effective_rate(db)

    # Giới hạn quantity do adapter tự khai (AdapterSpec.max_quantity_per_order /
    # bulk_strategies, adapters/registry.py) — vd số proxy tối đa một đơn (mỗi
    # proxy một dòng proxy_allocations). Chặn ở đây, trước khi trừ ví hay tạo order row,
    # không chỉ giấu trên frontend (review fixes
    # docs/superpowers/plans/2026-07-22-dproxy-consolidated-review.md P0#1).
    # Marketplace-wide cap, same as the variant path (OrderCreate): a line can be
    # 200 KB, so an uncapped quantity is an uncapped delivery for one order.
    if q.quantity > MAX_ORDER_QUANTITY:
        raise api_error(ErrorCode.ORDER_QUANTITY_LIMIT, status.HTTP_400_BAD_REQUEST, max=MAX_ORDER_QUANTITY)
    if strategy_name == "fixed" and user_config.get("variant_id"):
        fixed_variant = await db.get(ProductVariant, user_config["variant_id"])
        if fixed_variant is not None and fixed_variant.product_id == product.id:
            check_variant_quantity(fixed_variant, q.quantity)
    provider_for_quantity_check = await db.get(Provider, product.provider_id)
    quantity_spec = get_spec(
        provider_for_quantity_check.adapter_type if provider_for_quantity_check else None
    )
    adapter_max = max_quantity_for(
        quantity_spec, strategy_name,
        provider_for_quantity_check.config if provider_for_quantity_check else None,
    )
    if adapter_max is not None and q.quantity > adapter_max:
        raise api_error(ErrorCode.ORDER_QUANTITY_LIMIT, status.HTTP_400_BAD_REQUEST, max=adapter_max)

    # Nhà cung cấp catalog: hỏi tồn kho/giá realtime TRƯỚC khi trừ ví — hết
    # hàng hay vừa tăng giá quá margin thì từ chối ngay (409), không tạo đơn
    # rồi hoàn tiền (src/suppliers/service.py).
    if quantity_spec and quantity_spec.external_stock:
        await precheck_external_purchase(product, user_config.get("variant_id"), q.quantity, db)

    # Provider đã bị tắt (hết credit, health check fail) và không có fallback:
    # từ chối TRƯỚC khi trừ ví. Trước đây đơn vẫn bị trừ tiền rồi mới hoàn
    # khi get_adapter raise — buyer thấy tiền đi rồi về, còn nguồn hết tiền
    # thì mỗi lượt mua lại là một vòng trừ-hoàn.
    try:
        await get_adapter(product.provider_id, db)
    except ValueError:
        raise api_error(ErrorCode.PRODUCT_UNAVAILABLE, status.HTTP_400_BAD_REQUEST) from None

    promo = await _apply_promo(promo_code, buyer_id, product, total_amount, db, lock=True)
    if promo:
        total_amount -= promo.discount

    order = Order(
        buyer_id=buyer_id,
        seller_id=product.seller_id,
        product_id=product_id,
        # Chiến lược `fixed` có variant_id trong user_config — ghi lên đơn để
        # buyer/seller thấy tên gói như đơn kho thường.
        variant_id=user_config.get("variant_id") if strategy_name == "fixed" else None,
        quantity=q.quantity,
        total_amount=total_amount,
        status=OrderStatus.pending,
        user_config=user_config,
        display_fx_rate_snapshot=fx_snapshot,
        **_promo_fields(promo),
    )
    db.add(order)
    await db.flush()

    await deduct_credit(
        buyer_id, total_amount,
        f"Mua {product.title} (x{q.quantity})", f"order-{order.id}", db,
    )
    if promo:
        await record_redemption(db, promo, order)

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
    strategy_name, _ = await resolve_pricing(product, db, with_variants=False)
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
                   "seller_id": product.seller_id, "amount": total_amount, **_promo_fields(promo)},
    )

    if adapter.provisions_over_network:
        # Commit first so the order survives on its own, then provision outside
        # this transaction. If the task never runs (process dies), the order sits
        # at `pending` and provision_sweep_job picks it up — retrying is safe
        # because the Idempotency-Key is deterministic per order id; catalog
        # suppliers (no key) are retried only until their purchase request has
        # been dispatched (call_log.PURCHASE_DISPATCHED_OPERATION).
        await db.commit()
        await db.refresh(order)
        spawn_provision(order.id)
        return order

    try:
        provision_config = {
            **user_config, "service_type": product.service_type, "pricing_strategy": strategy_name,
        }
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


_provision_slots = asyncio.Semaphore(settings.provision_max_concurrency)


async def provision_pending_order(order_id: int) -> None:
    """Provision an order that was committed at `pending`, on a fresh session.

    Runs both as the background task spawned by create_order_with_adapter and as
    the retry body of provision_sweep_job, which can collide on the same order.

    The row is locked FOR UPDATE for the duration: without it both callers read
    `pending`, both call the provider, and on a rejection both call refund_escrow
    — paying the buyer back twice. The Idempotency-Key protects the provider side
    of a duplicate, not the wallet. The lock costs holding one connection across
    the provider call, which is why the request path must never call this inline
    and why at most `PROVISION_MAX_CONCURRENCY` run at once per process: a burst
    of orders would otherwise hold every pooled connection for the length of
    the provider calls. An order another session holds is skipped, not waited
    for — that session is provisioning (or settling) it.
    """
    async with _provision_slots, SessionLocal() as db:
        order = await db.scalar(
            select(Order).where(Order.id == order_id).with_for_update(skip_locked=True, key_share=True)
        )
        if order is None or order.status != OrderStatus.pending:
            return
        product = await db.get(Product, order.product_id) if order.product_id else None
        if product is None or not product.provider_id:
            return

        try:
            adapter = await get_adapter(product.provider_id, db)
            strategy_name, _ = await resolve_pricing(product, db, with_variants=False)
            provision_config = {
                **(order.user_config or {}), "service_type": product.service_type,
                "pricing_strategy": strategy_name,
            }
            provision_result = await adapter.provision(order.id, provision_config)
        except Exception as e:
            # Leave the order at `pending` — the sweeper retries (unless a catalog
            # purchase was already dispatched), and gives up (refund + cancel) once
            # the order is past its deadline.
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
    _provision_tasks[order_id] = task

    def _forget(t: asyncio.Task, oid: int = order_id) -> None:
        if _provision_tasks.get(oid) is t:
            del _provision_tasks[oid]

    task.add_done_callback(_forget)


# order_id -> in-flight provisioning task spawned by this process.
_provision_tasks: dict[int, asyncio.Task] = {}


def provision_task(order_id: int) -> asyncio.Task | None:
    """The in-process provisioning task for ``order_id``, if one is running."""
    return _provision_tasks.get(order_id)


async def wait_for_provision(order_id: int, timeout: float) -> bool:
    """Wait up to ``timeout`` seconds for this process's provisioning task.

    Returns True when the task has finished, False on timeout or when no task
    for the order runs in this process. The task is shielded: a waiter timing
    out or being cancelled (client disconnect) never cancels provisioning.
    """
    task = _provision_tasks.get(order_id)
    if task is None:
        return False
    if task.done():
        return True
    done, _ = await asyncio.wait({asyncio.shield(task)}, timeout=max(0.0, timeout))
    return bool(done)


async def confirm_order(order_id: int, buyer_id: int, db: AsyncSession) -> Order:
    order = await db.get(Order, order_id, with_for_update=True)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != buyer_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    if order.status != OrderStatus.delivered:
        raise api_error(ErrorCode.ORDER_NOT_DELIVERED, status.HTTP_400_BAD_REQUEST)
    if await db.scalar(select(Dispute.id).where(
        Dispute.order_id == order.id, Dispute.status == DisputeStatus.open,
    )):
        raise api_error(ErrorCode.DISPUTE_ALREADY_OPEN, status.HTTP_400_BAD_REQUEST)
    order.status = OrderStatus.completed
    seller = await db.get(Account, order.seller_id)
    fee_percent = await order_fee_percent(order, seller.seller_tier if seller else "new", db)
    remaining_amount, platform_fee = escrow_settlement(
        order.total_amount, order.refunded_amount, fee_percent
    )
    if remaining_amount:
        await release_escrow(order.id, order.seller_id, remaining_amount, platform_fee, db=db)
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Order {order.id} confirmed by buyer", request_id=current_request_id(),
                    metadata={"event": "order_confirmed", "order_id": order.id, "amount": remaining_amount})
    await db.commit()
    await db.refresh(order)
    return order


async def _enrich_orders(
    orders: list[Order], db: AsyncSession, *, viewer: str = "admin", include_delivery: bool = True,
) -> list[dict]:
    """Orders ORM → dicts with product/variant names + buyer/seller emails for display.

    ``viewer`` decides how much of the counterparty is exposed:
    - ``buyer``: no ``seller_email``; gets ``seller_name`` / ``seller_path``
      (the shop, reachable through order chat) instead;
    - ``seller``: ``buyer_email`` masked (``bu***@gmail.com``) + ``buyer_key``;
    - ``admin``: everything.

    Gom lookup theo IN thay vì query từng đơn — list admin/seller từng mất
    ~6 query × N đơn (2.3s với 80 đơn), giờ cố định 5 query bất kể N.
    """
    if not orders:
        return []

    variants: dict[int, ProductVariant] = {}
    variant_ids = {o.variant_id for o in orders if o.variant_id}
    if variant_ids:
        rows = await db.execute(select(ProductVariant).where(id_in(ProductVariant.id, variant_ids)))
        variants = {v.id: v for v in rows.scalars()}

    products: dict[int, Product] = {}
    product_ids = {o.product_id for o in orders if o.product_id}
    product_ids |= {v.product_id for v in variants.values()}
    if product_ids:
        rows = await db.execute(select(Product).where(id_in(Product.id, product_ids)))
        products = {p.id: p for p in rows.scalars()}

    accounts: dict[int, Account] = {}
    account_ids = {o.buyer_id for o in orders} | {o.seller_id for o in orders}
    if account_ids:
        rows = await db.execute(select(Account).where(id_in(Account.id, account_ids)))
        accounts = {a.id: a for a in rows.scalars()}
    seller_ids = {o.seller_id for o in orders}
    seller_names = await approved_business_names(list(seller_ids), db) if viewer == "buyer" else {}
    seller_refs = await seller_refs_by_id(seller_ids, db) if viewer == "buyer" else {}

    order_ids = [o.id for o in orders]
    # Lists never carry delivered text; a single order carries it only when it
    # delivers text. Orders filled from stock expose a line count instead and
    # are read page by page (GET /orders/{ref}/resources, /delivery.txt).
    summaries = await delivery_summary(order_ids, db)
    text_orders = [
        o for o in orders
        if include_delivery and summaries[o.id].has_text and not summaries[o.id].from_resources
    ]
    delivery = await delivered_data_by_order(text_orders, db) if text_orders else {}
    proxy_counts = dict((await db.execute(
        select(ProxyAllocation.order_id, func.count(ProxyAllocation.id))
        .where(id_in(ProxyAllocation.order_id, order_ids))
        .group_by(ProxyAllocation.order_id)
    )).all())
    reviewed = set(
        (await db.execute(select(Review.order_id).where(id_in(Review.order_id, order_ids)))).scalars()
    )
    review_window_days = await get_review_window_days(db)
    dispute_rows = (await db.execute(
        select(Dispute.order_id, Dispute.status, Dispute.created_at, Dispute.review_requested_at, Dispute.seller_note)
        .where(id_in(Dispute.order_id, order_ids))
        .order_by(Dispute.created_at.desc())
    )).all()
    latest_dispute_status: dict[int, str] = {}
    review_requested_orders: set[int] = set()
    awaiting_seller_orders: set[int] = set()
    for order_id, dispute_status, _created_at, review_requested_at, seller_note in dispute_rows:
        if order_id not in latest_dispute_status:
            latest_dispute_status[order_id] = dispute_status.value
            if dispute_status == DisputeStatus.open and review_requested_at:
                review_requested_orders.add(order_id)
            if dispute_status == DisputeStatus.open and not seller_note:
                awaiting_seller_orders.add(order_id)
    open_disputes = {order_id for order_id, status_value in latest_dispute_status.items() if status_value == DisputeStatus.open.value}
    appendable_claim_orders = await orders_with_appendable_claims(list(open_disputes), db)
    task_rows = (await db.execute(
        select(ServiceTask.order_id, ServiceTask.status).where(id_in(ServiceTask.order_id, order_ids))
    )).all()
    task_progress: dict[int, dict[str, int]] = {}
    for task_order_id, task_status in task_rows:
        progress = task_progress.setdefault(task_order_id, {
            "total": 0, "pending": 0, "assigned": 0, "processing": 0, "completed": 0, "failed": 0,
        })
        progress["total"] += 1
        progress[task_status.value] += 1

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
        strategy = product.pricing_strategy if product else None
        service_type = product.service_type if product else None
        delivery_mode = variant.delivery_mode.value if variant else None
        if strategy == "task":
            fulfillment_kind = "task"
        elif service_type == "proxy":
            fulfillment_kind = "proxy"
        elif strategy == "credit":
            fulfillment_kind = "api"
        elif delivery_mode == DeliveryMode.manual.value:
            fulfillment_kind = "manual"
        else:
            fulfillment_kind = "instant"
        # Disputes are an overlay and never replace the commercial lifecycle.
        fulfillment_status = order.status.value
        is_open_dispute = order.id in open_disputes
        within_escrow = not order.escrow_expires_at or datetime.now(timezone.utc) <= order.escrow_expires_at
        is_terminal_refund = order.status in {OrderStatus.refunded, OrderStatus.cancelled}
        out.append({
            "id": order.id, "order_code": order.order_code,
            "buyer_id": order.buyer_id, "seller_id": order.seller_id,
            "variant_id": order.variant_id, "product_id": order.product_id,
            "quantity": order.quantity, "stock_held": order.stock_held,
            "total_amount": order.total_amount, "status": order.status,
            "promo_code": order.promo_code, "discount_amount": order.discount_amount,
            "refunded_amount": order.refunded_amount,
            "display_fx_rate_snapshot": order.display_fx_rate_snapshot,
            "escrow_expires_at": order.escrow_expires_at, "delivered_data": delivery.get(order.id),
            "gateway_access": gateway_access_from_delivery_data(delivery.get(order.id)),
            "has_delivery": summaries[order.id].has_delivery,
            "delivery_count": summaries[order.id].delivered_lines if summaries[order.id].from_resources else None,
            "proxy_count": proxy_counts.get(order.id),
            "cancel_reason": order.cancel_reason,
            "created_at": order.created_at,
            "delivered_at": order.delivered_at,
            "completed_at": order.completed_at,
            "product_title": product.title if product else None,
            "product_slug": product.slug if product else None,
            "product_key": product.public_key if product else None,
            "variant_key": variant.public_key if variant else None,
            "pricing_strategy": strategy,
            "delivery_mode": delivery_mode,
            "sla_hours": variant.sla_hours if variant else None,
            "service_type": service_type,
            "variant_name": variant.name if variant else None,
            **_counterparty_fields(viewer, buyer, seller, seller_names.get(order.seller_id), seller_refs.get(order.seller_id, {})),
            "has_review": order.id in reviewed,
            "has_dispute": is_open_dispute,
            "dispute_status": latest_dispute_status.get(order.id),
            "dispute_awaiting_seller": order.id in awaiting_seller_orders,
            "fulfillment": {"kind": fulfillment_kind, "status": fulfillment_status},
            "settlement": {"status": "released" if order.status == OrderStatus.completed else "refunded" if is_terminal_refund else "escrow_held"},
            "protection": {"status": "dispute_open" if is_open_dispute else "active" if order.status == OrderStatus.delivered else "closed"},
            "capabilities": {
                "can_confirm": order.status == OrderStatus.delivered and not is_open_dispute,
                "can_dispute": order.status == OrderStatus.delivered and within_escrow and not is_open_dispute,
                "can_append_claims": (
                    is_open_dispute
                    and fulfillment_kind in ("instant", "proxy")
                    and order.id in appendable_claim_orders
                ),
                "can_request_review": is_open_dispute and order.id not in review_requested_orders,
                "can_review": can_review_order(order, review_window_days) and order.id not in reviewed and product is not None,
                "can_chat": not is_terminal_refund,
                "can_view_proxy": fulfillment_kind == "proxy" and fulfillment_status in {"delivered", "completed"},
            },
            "task_progress": task_progress.get(order.id),
        })
    return out


async def order_view(order: Order, db: AsyncSession, *, viewer: str) -> dict:
    """The single-order payload (`OrderResponse`) for an order a handler just
    changed: the same shape `GET /orders/{ref}` returns. `delivered_data` is
    deferred, so an ORM `Order` cannot be serialized directly."""
    return await _enrich_order(order, db, viewer=viewer)


async def _enrich_order(order: Order, db: AsyncSession, *, viewer: str = "admin") -> dict:
    """Order ORM → dict with product/variant names + buyer/seller emails for display."""
    return (await _enrich_orders([order], db, viewer=viewer, include_delivery=True))[0]


def _counterparty_fields(viewer: str, buyer: Account | None, seller: Account | None, seller_business_name: str | None, seller_ref: dict) -> dict:
    if viewer == "buyer":
        return {
            "buyer_email": buyer.email if buyer else None,
            "seller_email": None,
            "seller_name": seller_business_name or (seller.email.split("@", 1)[0] if seller else None),
            "seller_path": seller_ref.get("seller_path"),
        }
    if viewer == "seller":
        return {
            "buyer_email": mask_email(buyer.email) if buyer else None,
            "buyer_key": buyer.public_key if buyer else None,
            "seller_email": seller.email if seller else None,
        }
    return {
        "buyer_email": buyer.email if buyer else None,
        "seller_email": seller.email if seller else None,
    }


def _order_code_fragment_condition(term: str):
    """Part of an order code ("ZNR6", "ord-znr6") as the seller reads it off
    a row; None when the term cannot be a fragment of one."""
    token = term.strip().lstrip("#").strip().upper()
    if token.startswith("ORD-"):
        token = token[len("ORD-"):]
    if not (3 <= len(token) <= 8) or not token.isalnum():
        return None
    return Order.order_code.like(f"ORD-%{token}%")


def _order_ref_condition(term: str):
    """``#212`` / ``212`` -> id match, ``ORD-XXXXXXXX`` (any case, optional prefix) -> code match."""
    parsed = parse_order_ref(term)
    if parsed is None:
        return Order.id == -1
    kind, value = parsed
    if kind == "id":
        row_id = as_row_id(str(value))
        return Order.id == row_id if row_id is not None else Order.id == -1
    return Order.order_code == value


async def list_buyer_orders(
    buyer_id: int,
    db: AsyncSession,
    *,
    status: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    tz: str | None = None,
    sort: str = "newest",
    page: int = 1,
    per_page: int = 20,
) -> dict:
    q = select(Order).where(Order.buyer_id == buyer_id, Order.is_seeded.is_(False))

    tab_clause = _buyer_tab_filter(status)
    if tab_clause is not None:
        q = q.where(tab_clause)
    elif status and status in OrderStatus.__members__:
        q = q.where(Order.status == OrderStatus(status))

    if search:
        search_clean = search.strip()
        explicit_ref = search_clean.startswith("#") or search_clean.upper().startswith("ORD-")
        ref_token = search_clean.lstrip("#").strip()
        if explicit_ref and parse_order_ref(ref_token) is not None:
            # A whole `#…` / `ORD-…` reference is an exact lookup by code or legacy id.
            q = q.where(_order_ref_condition(ref_token))
        elif explicit_ref:
            # Part of a code ("ORD-ZNR6", "#znr6"): the buyer read it off a row.
            fragment = _order_code_fragment_condition(ref_token)
            q = q.where(fragment if fragment is not None else Order.id == -1)
        else:
            product_match = select(Product.id).where(contains_folded(Product.title, search_clean))
            variant_match = select(ProductVariant.id).where(contains_folded(ProductVariant.name, search_clean))
            product_via_variant = select(ProductVariant.id).where(ProductVariant.product_id.in_(product_match))

            # A delivered account is found by its first field (e.g. the username),
            # exactly, through the keyed lookup digest — never by scanning the
            # delivered text, which is encrypted and can be MBs per order.
            delivered_match = select(Resource.order_id).where(
                Resource.data_lookup == resource_search_key(search_clean), Resource.order_id.is_not(None),
            )
            # The shop's approved name, as shown on the order row.
            shop_match = select(SellerApplication.account_id).where(
                SellerApplication.status == ApplicationStatus.approved,
                contains_folded(SellerApplication.business_name, search_clean),
            )
            conditions = [
                Order.id.in_(delivered_match),
                Order.product_id.in_(product_match),
                Order.variant_id.in_(variant_match),
                Order.variant_id.in_(product_via_variant),
                Order.seller_id.in_(shop_match),
            ]
            # A bare token that happens to look like a code (any 8 alphanumerics,
            # e.g. "facebook") still searches titles — the code match is added, not exclusive.
            if search_clean.isdigit() or parse_order_ref(search_clean) is not None:
                conditions.append(_order_ref_condition(search_clean))
            code_fragment = _order_code_fragment_condition(search_clean)
            if code_fragment is not None:
                conditions.append(code_fragment)

            q = q.where(or_(*conditions))

    lower, upper = created_at_bounds(date_from, date_to, tz)
    if lower is not None:
        q = q.where(Order.created_at >= lower)
    if upper is not None:
        q = q.where(Order.created_at < upper)

    # count
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # sort
    # Every order ends on the id, so equal amounts/times never shuffle between pages.
    if sort == "oldest":
        q = q.order_by(Order.created_at.asc(), Order.id.asc())
    elif sort in ("price_desc", "amount_desc"):
        q = q.order_by(Order.total_amount.desc(), Order.id.desc())
    elif sort in ("price_asc", "amount_asc"):
        q = q.order_by(Order.total_amount.asc(), Order.id.desc())
    else:
        q = q.order_by(Order.created_at.desc(), Order.id.desc())

    q = q.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    items = await _enrich_orders(list(result.scalars().all()), db, viewer="buyer", include_delivery=False)

    return {"items": items, "total": total, "page": page, "per_page": per_page}


async def buyer_order_stats(buyer_id: int, db: AsyncSession) -> dict:
    """One round trip: every tab count plus spend as filtered aggregates.
    Spend only counts money that actually left the buyer — cancelled and
    refunded orders returned their funds, so they are excluded, and partial
    refunds are taken off the rest."""
    settled = ~Order.status.in_((OrderStatus.cancelled, OrderStatus.refunded))
    awaiting = _buyer_tab_filter("awaiting_confirm")
    row = (await db.execute(
        select(
            func.count(Order.id).label("total"),
            func.count(Order.id).filter(_buyer_tab_filter("active")).label("active"),
            func.count(Order.id).filter(awaiting).label("awaiting_confirm"),
            func.count(Order.id).filter(_buyer_tab_filter("awaiting_seller")).label("awaiting_seller"),
            func.count(Order.id).filter(_buyer_tab_filter("disputed")).label("disputed"),
            func.count(Order.id).filter(_buyer_tab_filter("deleted")).label("cancelled_or_refunded"),
            func.coalesce(func.sum(Order.total_amount - Order.refunded_amount).filter(settled), 0).label("total_spend"),
            func.min(Order.escrow_expires_at).filter(awaiting).label("confirm_deadline"),
        ).where(Order.buyer_id == buyer_id, Order.is_seeded.is_(False))
    )).one()
    # The order behind that deadline, for "ORD-… — N hours left to check".
    soonest = await db.scalar(
        select(Order.order_code).where(Order.buyer_id == buyer_id, Order.is_seeded.is_(False), awaiting)
        .order_by(Order.escrow_expires_at.asc().nulls_last(), Order.id.asc()).limit(1)
    ) if row.awaiting_confirm else None
    return {
        "total": row.total,
        "active": row.active,
        "awaiting_confirm": row.awaiting_confirm,
        "awaiting_seller": row.awaiting_seller,
        "disputed": row.disputed,
        "cancelled_or_refunded": row.cancelled_or_refunded,
        "total_spend": int(row.total_spend),
        "confirm_deadline": row.confirm_deadline,
        "confirm_order_code": soonest,
    }


BUYER_ORDER_TABS = ("active", "awaiting_seller", "awaiting_confirm", "disputed", "deleted")


def _buyer_tab_filter(tab: str | None):
    """Buyer list tabs. Mirrors the seller console: an open dispute is an
    overlay on a delivered order, so `awaiting_confirm` means delivered AND
    not disputed, and `disputed` also catches the legacy `disputed` status."""
    open_disputed = or_(Order.status == OrderStatus.disputed, Order.id.in_(_open_dispute_order_ids()))
    if tab == "active":
        return Order.status.in_((OrderStatus.pending, OrderStatus.processing, OrderStatus.delivered))
    if tab == "awaiting_seller":
        # Paid, the shop has not delivered yet — disjoint from awaiting_confirm.
        return Order.status.in_((OrderStatus.pending, OrderStatus.processing))
    if tab == "awaiting_confirm":
        return (Order.status == OrderStatus.delivered) & ~Order.id.in_(_open_dispute_order_ids())
    if tab == "disputed":
        return open_disputed
    if tab == "deleted":
        return Order.status.in_((OrderStatus.cancelled, OrderStatus.refunded))
    return None


SELLER_ORDER_TABS = ("all", "disputed", "action_required", "escrow", "completed", "cancelled")
SELLER_ORDER_KINDS = ("instant", "manual", "api", "task", "proxy")
SELLER_ORDER_SORTS = ("newest", "oldest", "amount_desc", "amount_asc")


def _open_dispute_order_ids():
    return select(Dispute.order_id).where(Dispute.status == DisputeStatus.open)


def _seller_tab_filter(tab: str):
    """One clause per console tab. Disputes are an overlay, so `escrow` means
    delivered AND not disputed, and `disputed` catches both the legacy
    `disputed` status and an open dispute on a delivered order."""
    open_disputed = or_(Order.status == OrderStatus.disputed, Order.id.in_(_open_dispute_order_ids()))
    if tab == "disputed":
        return open_disputed
    if tab == "action_required":
        return Order.status.in_((OrderStatus.pending, OrderStatus.processing))
    if tab == "escrow":
        return (Order.status == OrderStatus.delivered) & ~Order.id.in_(_open_dispute_order_ids())
    if tab == "completed":
        return Order.status == OrderStatus.completed
    if tab == "cancelled":
        return Order.status.in_((OrderStatus.cancelled, OrderStatus.refunded))
    return None


def _seller_order_product_id():
    return func.coalesce(Order.product_id, ProductVariant.product_id)


def _fulfillment_kind_sql():
    """SQL twin of the kind resolution in `_enrich_orders` — keep in sync."""
    return case(
        (Product.pricing_strategy == "task", "task"),
        (Product.service_type == "proxy", "proxy"),
        (Product.pricing_strategy == "credit", "api"),
        (ProductVariant.delivery_mode == DeliveryMode.manual, "manual"),
        else_="instant",
    )


def seller_orders_order_by(sort: str) -> tuple:
    return {
        "oldest": (Order.created_at.asc(), Order.id.asc()),
        "amount_desc": (Order.total_amount.desc(), Order.created_at.desc(), Order.id.desc()),
        "amount_asc": (Order.total_amount.asc(), Order.created_at.desc(), Order.id.desc()),
    }.get(sort, (Order.created_at.desc(), Order.id.desc()))


async def seller_orders_query(
    seller_id: int,
    db: AsyncSession,
    *,
    tab: str = "all",
    search: str | None = None,
    product_id: int | None = None,
    product_key: str | None = None,
    kind: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    tz: str | None = None,
):
    """`SELECT Order.id` for the seller console filters (list and CSV export)."""
    if product_key:
        # Seller URLs carry the product's public key, never its row id; a
        # numeric value is an old bookmarked `?product_id=` link.
        ref = product_key.strip()
        if ref.isdigit():
            product_id = int(ref)
        else:
            product_id = await db.scalar(select(Product.id).where(Product.public_key == ref.lower())) or -1
    base = (
        select(Order.id)
        .select_from(Order)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .outerjoin(Product, Product.id == _seller_order_product_id())
        .where(Order.seller_id == seller_id, Order.is_seeded.is_(False))
    )

    filters = []
    tab_clause = _seller_tab_filter(tab if tab in SELLER_ORDER_TABS else "all")
    if tab_clause is not None:
        filters.append(tab_clause)
    if product_id:
        filters.append(_seller_order_product_id() == product_id)
    if kind in SELLER_ORDER_KINDS:
        filters.append(_fulfillment_kind_sql() == kind)
    if search and search.strip():
        term = search.strip()
        if term.startswith("#") or (not term.isdigit() and parse_order_ref(term) is not None):
            filters.append(_order_ref_condition(term.lstrip("#").strip()))
        else:
            conditions = [
                contains_folded(Product.title, term),
                contains_folded(ProductVariant.name, term),
            ]
            # The seller sees buyers' emails masked (an**@gmail.com), so only
            # the whole address finds them: a substring match would let the
            # search box unmask an email one character at a time.
            if "@" in term:
                buyer_match = select(Account.id).where(func.lower(Account.email) == term.lower())
                conditions.append(Order.buyer_id.in_(buyer_match))
            code_fragment = _order_code_fragment_condition(term)
            if code_fragment is not None:
                conditions.append(code_fragment)
            row_id = as_row_id(term)
            if row_id is not None:
                conditions.append(Order.id == row_id)
            filters.append(or_(*conditions))
    lower, upper = created_at_bounds(date_from, date_to, tz)
    if lower is not None:
        filters.append(Order.created_at >= lower)
    if upper is not None:
        filters.append(Order.created_at < upper)

    return base.where(*filters)


async def list_seller_orders(
    seller_id: int,
    db: AsyncSession,
    *,
    tab: str = "all",
    search: str | None = None,
    product_id: int | None = None,
    product_key: str | None = None,
    kind: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    tz: str | None = None,
    sort: str = "newest",
    page: int = 1,
    per_page: int = 20,
) -> dict:
    """Seller console listing: server-side tabs/filters/sort/pagination plus
    store-wide tab counts so the console header never depends on the page."""
    filtered = await seller_orders_query(
        seller_id, db, tab=tab, search=search, product_id=product_id, product_key=product_key,
        kind=kind, date_from=date_from, date_to=date_to, tz=tz,
    )
    total = int((await db.execute(select(func.count()).select_from(filtered.subquery()))).scalar() or 0)

    page_ids = list((await db.execute(
        filtered.order_by(*seller_orders_order_by(sort)).offset((page - 1) * per_page).limit(per_page)
    )).scalars())
    orders = []
    if page_ids:
        rows = (await db.execute(select(Order).where(Order.id.in_(page_ids)))).scalars().all()
        by_id = {o.id: o for o in rows}
        orders = [by_id[i] for i in page_ids if i in by_id]
    items = await _enrich_orders(orders, db, viewer="seller", include_delivery=False)

    scope = select(Order.id, Order.status).where(Order.seller_id == seller_id, Order.is_seeded.is_(False)).subquery()
    open_ids = _open_dispute_order_ids()
    count_row = (await db.execute(select(
        func.count(scope.c.id),
        func.coalesce(func.sum(case((or_(scope.c.status == OrderStatus.disputed, scope.c.id.in_(open_ids)), 1), else_=0)), 0),
        func.coalesce(func.sum(case((scope.c.status.in_((OrderStatus.pending, OrderStatus.processing)), 1), else_=0)), 0),
        func.coalesce(func.sum(case(((scope.c.status == OrderStatus.delivered) & ~scope.c.id.in_(open_ids), 1), else_=0)), 0),
        func.coalesce(func.sum(case((scope.c.status == OrderStatus.completed, 1), else_=0)), 0),
        func.coalesce(func.sum(case((scope.c.status.in_((OrderStatus.cancelled, OrderStatus.refunded)), 1), else_=0)), 0),
    ))).one()
    awaiting = int((await db.execute(
        select(func.count(Dispute.id))
        .join(Order, Order.id == Dispute.order_id)
        .where(Order.seller_id == seller_id, Dispute.status == DisputeStatus.open, Dispute.seller_note.is_(None))
    )).scalar() or 0)
    counts = {
        "all": int(count_row[0]), "disputed": int(count_row[1]), "action_required": int(count_row[2]),
        "escrow": int(count_row[3]), "completed": int(count_row[4]), "cancelled": int(count_row[5]),
        "disputes_awaiting_seller": awaiting,
    }

    product_rows = (await db.execute(
        select(Product.id, Product.public_key, Product.title)
        .where(Product.id.in_(
            select(_seller_order_product_id())
            .select_from(Order)
            .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
            .where(Order.seller_id == seller_id)
        ))
        .order_by(Product.title)
    )).all()

    return {
        "items": items, "total": total, "page": page, "per_page": per_page,
        "counts": counts,
        "products": [{"id": pid, "public_key": key, "title": title} for pid, key, title in product_rows],
    }


async def get_order(order_id: int, account_id: int, db: AsyncSession) -> dict:
    order = await db.get(Order, order_id)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != account_id and order.seller_id != account_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    return await _enrich_order(order, db, viewer="buyer" if order.buyer_id == account_id else "seller")


async def accept_order(order_id: int, seller_id: int, db: AsyncSession) -> Order:
    order = await db.get(Order, order_id)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.seller_id != seller_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    if order.status != OrderStatus.pending:
        raise api_error(ErrorCode.ORDER_NOT_PENDING, status.HTTP_400_BAD_REQUEST)
    order.status = OrderStatus.processing
    await db.commit()
    await db.refresh(order)
    return order


async def get_admin_order_detail(order_id: int, db: AsyncSession) -> dict:
    order = await db.get(Order, order_id)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
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
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.seller_id != seller_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    if order.status != OrderStatus.processing:
        raise api_error(ErrorCode.ORDER_NOT_PROCESSING, status.HTTP_400_BAD_REQUEST)
    if len(data) > MANUAL_DELIVERY_MAX_LENGTH:
        raise api_error(
            ErrorCode.DELIVERY_TOO_LONG, status.HTTP_422_UNPROCESSABLE_CONTENT, max=MANUAL_DELIVERY_MAX_LENGTH,
        )
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
    consume_manual_stock(order)
    order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(
        days=await escrow_days_for(db, seller_tier=seller.seller_tier if seller else "new",
                                   product_escrow_days=base_escrow_days, category_id=product.category_id if product else None)
    )
    await log_event(db, "info", f"Order {order.id} delivered manually", request_id=current_request_id(),
                    metadata={"event": "order_delivered_manual", "order_id": order.id})
    await db.commit()
    await db.refresh(order)
    return order
