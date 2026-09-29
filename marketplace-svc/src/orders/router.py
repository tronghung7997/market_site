from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from src.adapters.factory import get_adapter
from src.audit.service import log_event
from src.site_status import require_orders_open
from src.auth.dependencies import get_current_account, get_seller_account, get_stream_account, require_role, require_verified_email
from src.database import SessionLocal, get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.models.account import Account
from src.models.order import Order
from src.models.product import Product, ProductVariant
from src.models.resource import Resource
from src.models.service_task import ServiceTask
from src.rate_limit import check_rate_limit
from src.usage.service import get_usage_summary

from . import admin_case, admin_list, schemas, service
from .delivery import delivery_summary, delivery_text_of, stream_delivery_lines
from .export import stream_seller_orders_csv
from src.orders.refs import OrderRef, StreamOrderRef

# Each download/export can be tens of MB of decrypted goods: cap how often one
# account can ask for them (Redis-backed; fails open like other quotas).
DELIVERY_DOWNLOADS_PER_MINUTE = 30
ORDER_EXPORTS_PER_MINUTE = 6


def _download_quota_error():
    return api_error(ErrorCode.RATE_LIMITED, status.HTTP_429_TOO_MANY_REQUESTS, headers={"Retry-After": "60"})

router = APIRouter(tags=["orders"])

# Promo codes are guessable strings: cap how many one account may try.
PROMO_ATTEMPTS_PER_MINUTE = 20


async def _check_promo_attempts(account_id: int) -> None:
    if not await check_rate_limit(f"promo-code:{account_id}", limit=PROMO_ATTEMPTS_PER_MINUTE, window_seconds=60):
        raise api_error(ErrorCode.RATE_LIMITED, status.HTTP_429_TOO_MANY_REQUESTS, headers={"Retry-After": "60"})


@router.post("/orders", response_model=schemas.OrderResponse, status_code=status.HTTP_201_CREATED)
async def create_order(body: schemas.OrderCreate, account: Account = Depends(require_verified_email), db: AsyncSession = Depends(get_session)):
    await require_orders_open(db)
    if body.promo_code:
        await _check_promo_attempts(account.id)
    if body.variant_id:
        order = await service.create_order(
            account.id, body.variant_id, body.quantity, db,
            expected_unit_price=body.expected_unit_price, promo_code=body.promo_code,
        )
    else:
        order = await service.create_order_with_adapter(
            account.id, body.product_id, body.user_config, db, promo_code=body.promo_code,
        )
    return await service.order_view(order, db, viewer="buyer")


@router.post("/orders/quote", response_model=schemas.OrderQuoteResponse)
async def quote_order(
    body: schemas.OrderQuoteRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """Price an order body (with an optional promo code) without placing it."""
    if body.promo_code:
        await _check_promo_attempts(account.id)
    return await service.quote_order(
        account.id, db, variant_id=body.variant_id, quantity=body.quantity,
        expected_unit_price=body.expected_unit_price, product_id=body.product_id,
        user_config=body.user_config, promo_code=body.promo_code,
    )


@router.get("/orders", response_model=schemas.PaginatedOrderResponse)
async def list_orders(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str = Query("newest"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    return await service.list_buyer_orders(
        account.id, db,
        status=status_filter, search=search,
        date_from=date_from, date_to=date_to,
        sort=sort, page=page, per_page=per_page,
    )


@router.get("/orders/stats", response_model=schemas.OrderStatsResponse)
async def order_stats(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.buyer_order_stats(account.id, db)


@router.get("/orders/{order_ref}", response_model=schemas.OrderResponse)
async def get_order(order_id: OrderRef, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.get_order(order_id, account.id, db)


@router.post("/orders/{order_ref}/confirm", response_model=schemas.OrderResponse)
async def confirm_order(order_id: OrderRef, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.order_view(await service.confirm_order(order_id, account.id, db), db, viewer="buyer")


@router.get("/seller/orders", response_model=schemas.PaginatedSellerOrderResponse)
async def seller_orders(
    account: Account = Depends(get_seller_account),
    db: AsyncSession = Depends(get_session),
    tab: str = Query("all", pattern="^(all|disputed|action_required|escrow|completed|cancelled)$"),
    search: str | None = Query(None, max_length=200),
    product_id: int | None = Query(None, ge=1),
    product: str | None = Query(None, max_length=64, description="Product public key (what seller URLs carry); overrides product_id"),
    kind: str | None = Query(None, pattern="^(instant|manual|api|task|proxy)$"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str = Query("newest", pattern="^(newest|oldest|amount_desc|amount_asc)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    return await service.list_seller_orders(
        account.id, db,
        tab=tab, search=search, product_id=product_id, product_key=product, kind=kind,
        date_from=date_from, date_to=date_to, sort=sort, page=page, per_page=per_page,
    )


@router.get("/seller/orders/export.csv")
async def seller_orders_export(
    account: Account = Depends(get_stream_account),
    tab: str = Query("all", pattern="^(all|disputed|action_required|escrow|completed|cancelled)$"),
    search: str | None = Query(None, max_length=200),
    product_id: int | None = Query(None, ge=1),
    product: str | None = Query(None, max_length=64),
    kind: str | None = Query(None, pattern="^(instant|manual|api|task|proxy)$"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str = Query("newest", pattern="^(newest|oldest|amount_desc|amount_asc)$"),
    include_data: bool = Query(False),
):
    """CSV of the orders matching the seller console filters (at most
    `EXPORT_MAX_ROWS`), streamed; with `include_data`, each order's delivered
    lines. Audit-logged like revealing stock lines."""
    if "seller" not in account.roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Yêu cầu quyền seller")
    if not await check_rate_limit(f"seller-orders-export:{account.id}", limit=ORDER_EXPORTS_PER_MINUTE, window_seconds=60):
        raise _download_quota_error()
    async with SessionLocal() as db:
        await log_event(
            db, "info", f"Seller {account.id} exported orders (data={include_data})", request_id=current_request_id(),
            metadata={"event": "seller_orders_exported", "actor_id": account.id, "subject_type": "seller_orders",
                      "subject_id": account.id, "include_data": include_data, "tab": tab, "kind": kind},
        )
        await db.commit()
    filters = {"tab": tab, "search": search, "product_id": product_id, "product_key": product,
               "kind": kind, "date_from": date_from, "date_to": date_to}
    return StreamingResponse(
        stream_seller_orders_csv(account.id, filters, sort=sort, include_data=include_data),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="seller_orders.csv"', "Cache-Control": "no-store"},
    )


@router.post("/seller/orders/{order_ref}/accept", response_model=schemas.OrderResponse)
async def accept(order_id: OrderRef, account: Account = Depends(get_seller_account), db: AsyncSession = Depends(get_session)):
    return await service.order_view(await service.accept_order(order_id, account.id, db), db, viewer="seller")


@router.post("/seller/orders/{order_ref}/deliver", response_model=schemas.OrderResponse)
async def deliver(order_id: OrderRef, body: schemas.ManualDeliverRequest, account: Account = Depends(get_seller_account), db: AsyncSession = Depends(get_session)):
    return await service.order_view(await service.deliver_order(order_id, account.id, body.data, db), db, viewer="seller")


@router.get("/orders/{order_ref}/delivery.txt")
async def order_delivery_download(
    order_id: StreamOrderRef,
    account: Account = Depends(get_stream_account),
):
    """Download every delivered line of an order as text (buyer or seller).

    Streamed: the body is never built in memory and no pooled connection is
    held while it downloads (see orders.delivery.stream_delivery_lines). Each
    download is recorded in the audit log, like a seller revealing a stock line.
    """
    if not await check_rate_limit(f"order-delivery-download:{account.id}", limit=DELIVERY_DOWNLOADS_PER_MINUTE, window_seconds=60):
        raise _download_quota_error()
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        if order is None:
            raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
        if account.id not in (order.buyer_id, order.seller_id):
            raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
        role = "buyer" if account.id == order.buyer_id else "seller"
        await log_event(
            db, "info", f"Order {order.id} delivery downloaded by {role}", request_id=current_request_id(),
            metadata={"event": "order_delivery_downloaded", "actor_id": account.id, "subject_type": "order",
                      "subject_id": order.id, "role": role},
        )
        await db.commit()
        filename = f"{order.order_code}.txt"
    return StreamingResponse(
        stream_delivery_lines(order_id),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


@router.get("/orders/{order_ref}/dashboard")
async def order_dashboard(
    order_id: OrderRef,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    order = await db.get(Order, order_id)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != account.id and order.seller_id != account.id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)

    product = None
    if order.product_id:
        product = await db.get(Product, order.product_id)
    elif order.variant_id:
        variant = await db.get(ProductVariant, order.variant_id)
        product = await db.get(Product, variant.product_id) if variant else None
    service_type = product.service_type if product else "other"

    dashboard: dict = {
        # "service_type" là field frontend thật sự đọc để chọn dashboard con
        # (Proxy/Endpoint/Takedown/Default) — "type" tồn tại song song nhưng
        # không nơi nào trong frontend đọc nó, khiến mọi dashboard trước đây
        # luôn rơi vào nhánh mặc định bất kể service_type thật là gì.
        "type": service_type,
        "service_type": service_type,
        "product_id": product.id if product else None,
        "order_id": order.id,
        "status": order.status,
    }

    if service_type == "proxy":
        from src.models.proxy_allocation import ProxyAllocation

        resources_result = await db.execute(
            select(Resource).where(Resource.order_id == order_id).options(undefer(Resource.data))
        )
        resources = resources_result.scalars().all()
        # `data` trước đây bị bỏ sót dù frontend luôn đọc (ServiceDashboard
        # ::ResourceRow) — với đơn kiểu cũ có Resource thì đó là `undefined`
        # rơi vào MaskedValue.
        rows: list[dict] = [
            {
                "id": f"res-{r.id}", "status": r.status, "data": r.data or "",
                "expires_at": str(r.expires_at) if r.expires_at else None,
            }
            for r in resources
        ]

        # Đơn mua qua adapter (TopProxy/DProxy) KHÔNG tạo Resource — chúng bind
        # vào proxy_allocations. Thiếu nhánh này thì dashboard báo "Số IP: 0" và
        # "Còn lại: Vĩnh viễn" cho MỌI đơn proxy tự động, trong khi đơn có đúng
        # một proxy và hết hạn theo kỳ đã mua (quan sát trên đơn #91, 27/07).
        allocations = (await db.execute(
            select(ProxyAllocation).where(ProxyAllocation.order_id == order_id)
        )).scalars().all()
        rows += [
            {
                "id": f"alloc-{a.id}", "status": a.status.value,
                # CỐ TÌNH không gửi external_id: với key xoay đó chính là
                # keyxoay — credential của nhà cung cấp mà buyer không được
                # thấy (phương án B1). IP hiện hành là đủ để hiển thị.
                "data": a.last_public_ip or "",
                "expires_at": a.expires_at.isoformat() if a.expires_at else None,
            }
            for a in allocations
        ]
        dashboard["resources"] = rows

        # Try to get usage from adapter if provider is set
        if product and product.provider_id:
            try:
                adapter = await get_adapter(product.provider_id, db)
                usage_data = []
                for r in resources:
                    if r.data:
                        usage = await adapter.get_usage(r.data)
                        if usage:
                            usage_data.append({"resource_id": r.id, **usage})
                dashboard["usage"] = usage_data
            except (ValueError, Exception):
                dashboard["usage"] = []
        else:
            dashboard["usage"] = []

    elif service_type == "endpoint":
        # "endpoint" bán theo credit/request — không đi qua Resource (chỉ
        # seller_pool/variant tạo Resource, mock/real_api thì không), nên
        # trước đây usage luôn rỗng dù adapter có get_usage(). Số dư thật nằm
        # ở order_balances/usage_records (xem src/usage), key giao cho buyer
        # nằm thẳng trong delivered_data.
        dashboard["delivered_data"] = await delivery_text_of(order, db)
        dashboard["balance"] = await get_usage_summary(order_id, db)
        # Endpoint bán được (tên, method, tham số, giá) cho trang "API của tôi"
        # — không bao giờ lộ đường dẫn/khoá thật của nguồn.
        from src.suppliers.gateway_sources import buyer_endpoints
        dashboard["api"] = await buyer_endpoints(order, db)

    elif service_type == "takedown":
        # Get related tasks
        tasks_result = await db.execute(
            select(ServiceTask).where(ServiceTask.order_id == order_id)
            .order_by(ServiceTask.created_at.desc())
        )
        tasks = tasks_result.scalars().all()
        dashboard["tasks"] = [
            {
                "id": t.id,
                "platform": t.platform,
                "target_url": t.target_url,
                "status": t.status,
                "assignee": t.assignee,
                "result_data": t.result_data,
                "created_at": str(t.created_at),
            }
            for t in tasks
        ]

    else:
        # account, token, cloud, payment, other: stock orders deliver lines read
        # page by page (/orders/{ref}/resources); others deliver a short text.
        summary = (await delivery_summary([order.id], db))[order.id]
        dashboard["delivered_data"] = await delivery_text_of(order, db)
        dashboard["delivery_count"] = summary.delivered_lines if summary.from_resources else None

    return dashboard


@router.get("/admin/orders", response_model=schemas.AdminOrderPage)
async def admin_orders(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    q: str | None = Query(None, max_length=200),
    statuses: str | None = Query(None, description="Comma-separated order statuses"),
    buyer_id: int | None = Query(None, ge=1),
    seller_id: int | None = Query(None, ge=1),
    sort: str = Query("newest", pattern="^(newest|oldest|amount_desc|amount_asc|quantity_desc|quantity_asc)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=admin_list.ADMIN_ORDERS_PAGE_MAX),
):
    return await admin_list.list_admin_orders(
        db, q=q, statuses=[s for s in (statuses or "").split(",") if s], buyer_id=buyer_id,
        seller_id=seller_id, sort=sort, page=page, per_page=per_page,
    )


@router.get("/admin/orders/overview", response_model=schemas.AdminOrdersOverview)
async def admin_orders_overview(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    tz: str = Query("Asia/Ho_Chi_Minh", max_length=64),
    days: int = Query(14, ge=1, le=90),
):
    return await admin_list.admin_orders_overview(db, tz=tz, days=days)


@router.get("/admin/orders/{order_id}/case", response_model=schemas.AdminOrderCase)
async def admin_order_case(order_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    """The admin order page: money trail, lines, case, tasks, parties, story, actions."""
    return await admin_case.admin_order_case(order_id, db)


@router.post("/admin/orders/{order_id}/release", status_code=204)
async def admin_release_order(order_id: int, body: schemas.AdminOrderNote,
                              admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    await admin_case.release_order(order_id, admin, body.note, db)


@router.post("/admin/orders/{order_id}/refund", status_code=204)
async def admin_refund_order(order_id: int, body: schemas.AdminOrderRefund,
                             admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    await admin_case.refund_order(order_id, admin, body.note, body.buyer_message, db)


@router.post("/admin/orders/{order_id}/extend-escrow", status_code=204)
async def admin_extend_escrow(order_id: int, body: schemas.AdminOrderExtendEscrow,
                              admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    await admin_case.extend_escrow(order_id, admin, body.days, body.note, db)


@router.post("/admin/orders/{order_id}/retry-provision", status_code=202)
async def admin_retry_provision(order_id: int, body: schemas.AdminOrderRetry | None = None,
                                admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    await admin_case.retry_provision(order_id, admin, body.note if body else None, db)
    return {"status": "queued"}


@router.post("/admin/orders/{order_id}/notes", status_code=201)
async def admin_order_note(order_id: int, body: schemas.AdminOrderNote,
                           admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await admin_case.add_note(order_id, admin, body.note, db)


@router.get("/admin/orders/{order_id}", response_model=schemas.AdminOrderDetailResponse)
async def admin_order_detail(order_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.get_admin_order_detail(order_id, db)
