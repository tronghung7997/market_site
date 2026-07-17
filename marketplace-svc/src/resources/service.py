from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import NotOwner, ResourceUnavailable
from src.models.product import ProductVariant
from src.models.resource import Resource, ResourceStatus


async def bulk_add_resources(variant_id: int, seller_id: int, items: list[str], db: AsyncSession) -> int:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Không tìm thấy gói sản phẩm")
    from src.models.product import Product
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()
    for item in items:
        db.add(Resource(variant_id=variant_id, seller_id=seller_id, data=item))
    await db.commit()
    return len(items)


async def list_resources(variant_id: int, seller_id: int, db: AsyncSession) -> list[Resource]:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Không tìm thấy gói sản phẩm")
    from src.models.product import Product
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()
    result = await db.execute(
        select(Resource).where(Resource.variant_id == variant_id).order_by(Resource.created_at.desc())
    )
    return list(result.scalars().all())


async def update_resource_data(resource_id: int, seller_id: int, data: str, db: AsyncSession) -> Resource:
    """Sửa nội dung một tài nguyên còn trong kho.

    Chỉ cho sửa khi `available`. Tài nguyên đã giao thì `Order.delivered_data` là
    bản sao chụp lúc giao — sửa ở đây không đổi được thứ buyer đang cầm, nên cho
    sửa sẽ khiến seller tưởng đã vá cho khách trong khi không.
    """
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài nguyên")
    if resource.seller_id != seller_id:
        raise NotOwner()
    if resource.status != ResourceStatus.available:
        raise HTTPException(
            status_code=400,
            detail="Chỉ sửa được tài nguyên còn trong kho. Tài nguyên đã giao thì "
                   "người mua đã nhận bản cũ — hãy xử lý qua khiếu nại của đơn.",
        )
    if not data.strip():
        raise HTTPException(status_code=400, detail="Nội dung không được để trống")
    resource.data = data.strip()
    await db.commit()
    await db.refresh(resource)
    return resource


async def seller_inventory_summary(seller_id: int, db: AsyncSession) -> list[dict]:
    """Đếm tồn kho theo từng gói sản phẩm của seller.

    Trả cả gói chưa có tài nguyên nào (outer join) — gói hết sạch hàng chính là
    thứ seller cần thấy nhất, mà inner join sẽ giấu đi.
    """
    from src.models.product import Product

    rows = await db.execute(
        select(
            Product.id, Product.title, ProductVariant.id, ProductVariant.name,
            ProductVariant.delivery_mode, ProductVariant.is_active,
            Resource.status, func.count(Resource.id),
        )
        .select_from(Product)
        .join(ProductVariant, ProductVariant.product_id == Product.id)
        .outerjoin(Resource, Resource.variant_id == ProductVariant.id)
        .where(Product.seller_id == seller_id)
        .group_by(
            Product.id, Product.title, ProductVariant.id, ProductVariant.name,
            ProductVariant.delivery_mode, ProductVariant.is_active, Resource.status,
        )
        # Product.id nằm trong khoá sắp xếp vì tên sản phẩm KHÔNG duy nhất — thiếu
        # nó thì variant của hai sản phẩm trùng tên sẽ xen kẽ nhau.
        .order_by(Product.title, Product.id, ProductVariant.sort_order)
    )

    by_variant: dict[int, dict] = {}
    for product_id, title, variant_id, variant_name, delivery_mode, is_active, res_status, count in rows.all():
        entry = by_variant.setdefault(variant_id, {
            "product_id": product_id, "product_title": title,
            "variant_id": variant_id, "variant_name": variant_name,
            "delivery_mode": delivery_mode.value if delivery_mode else None,
            "is_active": is_active,
            "available": 0, "assigned": 0, "expired": 0, "error": 0,
        })
        if res_status is not None:
            entry[res_status.value] = count
    return list(by_variant.values())


async def delete_resource(resource_id: int, seller_id: int, db: AsyncSession) -> None:
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài nguyên")
    if resource.seller_id != seller_id:
        raise NotOwner()
    if resource.status != ResourceStatus.available:
        raise HTTPException(status_code=400, detail="Chỉ có thể xoá tài nguyên đang ở trạng thái sẵn sàng")
    await db.delete(resource)
    await db.commit()


async def claim_resources(variant_id: int, quantity: int, db: AsyncSession, *, order_id: int, duration_days: int | None) -> list[Resource]:
    from datetime import datetime, timedelta, timezone
    result = await db.execute(
        select(Resource)
        .where(Resource.variant_id == variant_id, Resource.status == ResourceStatus.available)
        .order_by(Resource.created_at)
        .limit(quantity)
        .with_for_update(skip_locked=True)
    )
    resources = list(result.scalars().all())
    if len(resources) < quantity:
        raise ResourceUnavailable()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=duration_days) if duration_days else None
    for r in resources:
        r.status = ResourceStatus.assigned
        r.assigned_at = now
        r.order_id = order_id
        r.expires_at = expires_at
    return resources


async def release_resources(resource_ids: list[int], db: AsyncSession) -> None:
    for rid in resource_ids:
        resource = await db.get(Resource, rid)
        if resource and resource.status == ResourceStatus.assigned:
            resource.status = ResourceStatus.available
    await db.commit()


async def order_resources(order_id: int, account_id: int, db: AsyncSession) -> list[Resource]:
    from src.models.order import Order
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.buyer_id != account_id and order.seller_id != account_id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền thực hiện thao tác này")
    result = await db.execute(
        select(Resource).where(Resource.order_id == order_id).order_by(Resource.id)
    )
    return list(result.scalars().all())


async def mark_resource_error(resource_id: int, seller_id: int, db: AsyncSession) -> Resource:
    from src.alerts.service import create_alert
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài nguyên")
    if resource.seller_id != seller_id:
        raise NotOwner()
    resource.status = ResourceStatus.error
    await create_alert("resource_error", "warning", "seller", seller_id,
                       f"Tài nguyên #{resource_id} được báo lỗi bởi nhà bán", db)
    await db.commit()
    await db.refresh(resource)
    return resource


async def list_all_resources(
    db: AsyncSession,
    *,
    status: str | None = None,
    variant_id: int | None = None,
    product_id: int | None = None,
    seller_id: int | None = None,
    search: str | None = None,
    page: int = 1,
    per_page: int = 20,
) -> dict:
    from sqlalchemy import func as safunc
    from src.models.product import Product
    from src.models.account import Account

    base = (
        select(
            Resource.id,
            Resource.variant_id,
            Resource.seller_id,
            Resource.status,
            Resource.order_id,
            Resource.assigned_at,
            Resource.expires_at,
            Resource.created_at,
            ProductVariant.name.label("variant_name"),
            Product.id.label("product_id"),
            Product.title.label("product_title"),
            Account.email.label("seller_email"),
        )
        .join(ProductVariant, Resource.variant_id == ProductVariant.id)
        .join(Product, ProductVariant.product_id == Product.id)
        .join(Account, Resource.seller_id == Account.id)
    )

    if status:
        base = base.where(Resource.status == status)
    if variant_id:
        base = base.where(Resource.variant_id == variant_id)
    if product_id:
        base = base.where(Product.id == product_id)
    if seller_id:
        base = base.where(Resource.seller_id == seller_id)
    if search:
        term = search.strip()
        try:
            rid = int(term.lstrip("#"))
            base = base.where(Resource.id == rid)
        except ValueError:
            from sqlalchemy import or_
            like = f"%{term}%"
            base = base.where(or_(
                Product.title.ilike(like),
                ProductVariant.name.ilike(like),
                Account.email.ilike(like),
            ))

    count_q = select(safunc.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    rows = await db.execute(
        base.order_by(Resource.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    items = [row._asdict() for row in rows.all()]
    return {"items": items, "total": total, "page": page, "per_page": per_page}


async def resource_status_summary(db: AsyncSession) -> dict[str, int]:
    from sqlalchemy import func as safunc
    result = await db.execute(
        select(Resource.status, safunc.count()).group_by(Resource.status)
    )
    counts = {s.value: 0 for s in ResourceStatus}
    for status_val, n in result.all():
        key = status_val.value if hasattr(status_val, "value") else str(status_val)
        counts[key] = n
    return counts
