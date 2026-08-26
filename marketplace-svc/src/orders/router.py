from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.factory import get_adapter
from src.auth.dependencies import get_current_account, get_seller_account, require_role
from src.database import get_session
from src.models.account import Account
from src.models.order import Order
from src.models.product import Product, ProductVariant
from src.models.resource import Resource
from src.models.service_task import ServiceTask
from src.usage.service import get_usage_summary

from . import schemas, service

router = APIRouter(tags=["orders"])


@router.post("/orders", response_model=schemas.OrderResponse, status_code=status.HTTP_201_CREATED)
async def create_order(body: schemas.OrderCreate, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    if body.variant_id:
        return await service.create_order(account.id, body.variant_id, body.quantity, db)
    else:
        return await service.create_order_with_adapter(
            account.id, body.product_id, body.user_config, db,
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


@router.get("/orders/{order_id}", response_model=schemas.OrderResponse)
async def get_order(order_id: int, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.get_order(order_id, account.id, db)


@router.post("/orders/{order_id}/confirm", response_model=schemas.OrderResponse)
async def confirm_order(order_id: int, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.confirm_order(order_id, account.id, db)


@router.get("/seller/orders", response_model=list[schemas.OrderResponse])
async def seller_orders(account: Account = Depends(get_seller_account), db: AsyncSession = Depends(get_session)):
    return await service.list_seller_orders(account.id, db)


@router.post("/seller/orders/{order_id}/accept", response_model=schemas.OrderResponse)
async def accept(order_id: int, account: Account = Depends(get_seller_account), db: AsyncSession = Depends(get_session)):
    return await service.accept_order(order_id, account.id, db)


@router.post("/seller/orders/{order_id}/deliver", response_model=schemas.OrderResponse)
async def deliver(order_id: int, body: schemas.ManualDeliverRequest, account: Account = Depends(get_seller_account), db: AsyncSession = Depends(get_session)):
    return await service.deliver_order(order_id, account.id, body.data, db)


@router.get("/orders/{order_id}/dashboard")
async def order_dashboard(
    order_id: int,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.buyer_id != account.id and order.seller_id != account.id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền thực hiện thao tác này")

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
            select(Resource).where(Resource.order_id == order_id)
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
        dashboard["delivered_data"] = order.delivered_data
        dashboard["balance"] = await get_usage_summary(order_id, db)

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
        # account, token, cloud, payment, other — return delivered_data
        dashboard["delivered_data"] = order.delivered_data

    return dashboard


@router.get("/admin/orders", response_model=list[schemas.OrderResponse])
async def admin_orders(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_all_orders(db)


@router.get("/admin/orders/{order_id}", response_model=schemas.AdminOrderDetailResponse)
async def admin_order_detail(order_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.get_admin_order_detail(order_id, db)
