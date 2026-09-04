from fastapi import status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.exceptions import ErrorCode, NotOwner, ResourceUnavailable, api_error
from src.logging import current_request_id
from src.models.pricing_config import PricingConfig
from src.models.product import DeliveryMode, Product, ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.pricing.engine import product_pricing_override


async def bulk_add_resources(variant_id: int, seller_id: int, items: list[str], db: AsyncSession) -> int:
    # Serialize uploads per variant so two concurrent requests cannot both pass
    # the duplicate check and sell the same credential twice.
    variant = (await db.execute(
        select(ProductVariant)
        .where(ProductVariant.id == variant_id)
        .with_for_update()
    )).scalar_one_or_none()
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    from src.models.product import Product
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()
    if variant.delivery_mode != DeliveryMode.instant:
        raise api_error(ErrorCode.INVENTORY_NOT_INSTANT, status.HTTP_400_BAD_REQUEST)

    unique_items = list(dict.fromkeys(item.strip() for item in items if item.strip()))
    if not unique_items:
        await db.commit()
        return 0
    existing = set((await db.execute(
        select(Resource.data).where(
            Resource.variant_id == variant_id,
            Resource.data.in_(unique_items),
        )
    )).scalars())
    new_items = [item for item in unique_items if item not in existing]
    for item in new_items:
        db.add(Resource(variant_id=variant_id, seller_id=seller_id, data=item))
    await db.commit()
    return len(new_items)


async def list_resources(
    variant_id: int,
    seller_id: int,
    db: AsyncSession,
    *,
    status_filter: ResourceStatus | None = None,
    search: str | None = None,
    include_archived: bool = False,
    archived_only: bool = False,
    page: int = 1,
    per_page: int = 10_000,
) -> tuple[list[Resource], int]:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    from src.models.product import Product
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()
    filters = [Resource.variant_id == variant_id]
    if archived_only:
        filters.append(Resource.is_archived == True)  # noqa: E712
    elif not include_archived:
        filters.append(Resource.is_archived == False)  # noqa: E712
    if status_filter:
        filters.append(Resource.status == status_filter)
    if search and search.strip():
        q = search.strip()
        if q.startswith("#") and q[1:].isdigit():
            filters.append(Resource.order_id == int(q[1:]))
        elif q.isdigit():
            filters.append(or_(Resource.id == int(q), Resource.order_id == int(q), Resource.data.ilike(f"%{q}%")))
        else:
            filters.append(Resource.data.ilike(f"%{q}%"))

    total = int(await db.scalar(select(func.count()).select_from(Resource).where(*filters)) or 0)
    result = await db.execute(
        select(Resource)
        .where(*filters)
        .order_by(Resource.created_at.desc(), Resource.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return list(result.scalars().all()), total


async def _verify_resource_ownership(resource: Resource, seller_id: int, db: AsyncSession) -> None:
    if resource.seller_id == seller_id:
        return
    variant = await db.get(ProductVariant, resource.variant_id)
    if variant:
        from src.models.product import Product
        product = await db.get(Product, variant.product_id)
        if product and product.seller_id == seller_id:
            # Preserve the historical seller recorded on resources that have
            # belonged to an order. Only heal denormalized ownership for stock.
            if resource.order_id is None:
                resource.seller_id = seller_id
            return
    raise NotOwner()


async def update_resource_data(resource_id: int, seller_id: int, data: str, db: AsyncSession) -> Resource:
    """Sửa nội dung một tài nguyên còn trong kho hoặc đã thu hồi lỗi."""
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise api_error(ErrorCode.RESOURCE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await _verify_resource_ownership(resource, seller_id, db)
    if resource.order_id is not None or resource.status not in (ResourceStatus.available, ResourceStatus.error):
        raise api_error(ErrorCode.RESOURCE_NOT_EDITABLE, status.HTTP_400_BAD_REQUEST)
    if not data.strip():
        raise api_error(ErrorCode.RESOURCE_EMPTY, status.HTTP_400_BAD_REQUEST)
    resource.data = data.strip()
    await db.commit()
    await db.refresh(resource)
    return resource


async def restock_resource(
    resource_id: int,
    seller_id: int,
    db: AsyncSession,
    *,
    data: str,
) -> Resource:
    """Đưa một tài nguyên (lỗi/đã thu hồi) trở lại kho bán."""
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise api_error(ErrorCode.RESOURCE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await _verify_resource_ownership(resource, seller_id, db)
    if resource.status != ResourceStatus.error or resource.order_id is not None:
        raise api_error(ErrorCode.RESOURCE_NOT_EDITABLE, status.HTTP_400_BAD_REQUEST)
    if not data.strip():
        raise api_error(ErrorCode.RESOURCE_EMPTY, status.HTTP_400_BAD_REQUEST)
    resource.data = data.strip()
    resource.status = ResourceStatus.available
    resource.order_id = None
    resource.assigned_at = None
    resource.expires_at = None
    resource.is_archived = False
    await log_event(
        db,
        "info",
        f"Seller restocked resource #{resource_id}",
        request_id=current_request_id(),
        metadata={"event": "seller_resource_restocked", "resource_id": resource_id, "seller_id": seller_id},
    )
    await db.commit()
    await db.refresh(resource)
    return resource


async def archive_resource(resource_id: int, seller_id: int, db: AsyncSession) -> Resource:
    """Ẩn tài nguyên khỏi kho mà không vi phạm ràng buộc khoá ngoại."""
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise api_error(ErrorCode.RESOURCE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await _verify_resource_ownership(resource, seller_id, db)
    if resource.status == ResourceStatus.assigned:
        raise api_error(ErrorCode.RESOURCE_NOT_DELETABLE, status.HTTP_400_BAD_REQUEST)
    resource.is_archived = True
    await log_event(
        db,
        "info",
        f"Seller archived resource #{resource_id}",
        request_id=current_request_id(),
        metadata={"event": "seller_resource_archived", "resource_id": resource_id, "seller_id": seller_id},
    )
    await db.commit()
    await db.refresh(resource)
    return resource


async def restore_resource(resource_id: int, seller_id: int, db: AsyncSession) -> Resource:
    """Restore visibility without changing order or inventory lifecycle state."""
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise api_error(ErrorCode.RESOURCE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await _verify_resource_ownership(resource, seller_id, db)
    resource.is_archived = False
    await log_event(
        db,
        "info",
        f"Seller restored resource #{resource_id}",
        request_id=current_request_id(),
        metadata={"event": "seller_resource_restored", "resource_id": resource_id, "seller_id": seller_id},
    )
    await db.commit()
    await db.refresh(resource)
    return resource


async def bulk_resource_action(
    variant_id: int,
    seller_id: int,
    action: str,
    resource_ids: list[int],
    db: AsyncSession,
) -> tuple[str, int, list[int]]:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    from src.models.product import Product
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()

    result = await db.execute(
        select(Resource).where(
            Resource.id.in_(resource_ids),
            Resource.variant_id == variant_id,
        ).with_for_update()
    )
    resources = list(result.scalars().all())
    if len(set(resource_ids)) != len(resource_ids) or len(resources) != len(resource_ids):
        raise api_error(ErrorCode.RESOURCE_NOT_EDITABLE, status.HTTP_400_BAD_REQUEST)
    affected_ids: list[int] = []

    if action == "restore":
        for r in resources:
            r.is_archived = False
            affected_ids.append(r.id)
    elif action in ("archive", "delete"):
        for r in resources:
            if r.status == ResourceStatus.assigned:
                raise api_error(ErrorCode.RESOURCE_NOT_DELETABLE, status.HTTP_400_BAD_REQUEST)
            if action == "delete" and r.order_id is None and r.status == ResourceStatus.available:
                await db.delete(r)
            else:
                r.is_archived = True
            affected_ids.append(r.id)

    await db.commit()
    return action, len(affected_ids), affected_ids


async def seller_inventory_summary(seller_id: int, db: AsyncSession) -> list[dict]:
    """Đếm tồn kho theo từng gói sản phẩm của seller."""
    products = list((await db.execute(
        select(Product).where(Product.seller_id == seller_id)
    )).scalars())
    configs = {
        config.service_type: config.strategy
        for config in (await db.execute(
            select(PricingConfig).where(PricingConfig.is_active == True)  # noqa: E712
        )).scalars()
    }
    inventory_product_ids = []
    for product in products:
        override = product_pricing_override(product)
        strategy = (
            override[0]
            if override is not None
            else configs.get(product.service_type or "other", "fixed")
        )
        if strategy == "fixed":
            inventory_product_ids.append(product.id)
    if not inventory_product_ids:
        return []

    rows = await db.execute(
        select(
            Product.id, Product.title, ProductVariant.id, ProductVariant.name,
            ProductVariant.delivery_mode, ProductVariant.is_active,
            Resource.status, func.count(Resource.id),
        )
        .select_from(Product)
        .join(ProductVariant, ProductVariant.product_id == Product.id)
        .outerjoin(
            Resource,
            and_(
                Resource.variant_id == ProductVariant.id,
                Resource.is_archived == False,  # noqa: E712
                or_(Resource.status != ResourceStatus.available, Resource.order_id.is_(None)),
            ),
        )
        .where(
            Product.id.in_(inventory_product_ids),
            ProductVariant.delivery_mode == DeliveryMode.instant,
        )
        .group_by(
            Product.id, Product.title, ProductVariant.id, ProductVariant.name,
            ProductVariant.delivery_mode, ProductVariant.is_active, Resource.status,
        )
        .order_by(Product.title, Product.id, ProductVariant.sort_order)
    )

    archived_rows = await db.execute(
        select(Resource.variant_id, func.count(Resource.id))
        .where(
            Resource.variant_id.in_(select(ProductVariant.id).where(
                ProductVariant.product_id.in_(inventory_product_ids),
                ProductVariant.delivery_mode == DeliveryMode.instant,
            )),
            Resource.is_archived == True,  # noqa: E712
        )
        .group_by(Resource.variant_id)
    )
    archived_by_variant = dict(archived_rows.all())

    by_variant: dict[int, dict] = {}
    for product_id, title, variant_id, variant_name, delivery_mode, is_active, res_status, count in rows.all():
        entry = by_variant.setdefault(variant_id, {
            "product_id": product_id, "product_title": title,
            "variant_id": variant_id, "variant_name": variant_name,
            "delivery_mode": delivery_mode.value if delivery_mode else None,
            "is_active": is_active,
            "available": 0, "assigned": 0, "expired": 0, "error": 0,
            "archived": archived_by_variant.get(variant_id, 0),
        })
        if res_status is not None:
            entry[res_status.value] = count
    return list(by_variant.values())


async def delete_resource(resource_id: int, seller_id: int, db: AsyncSession) -> None:
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise api_error(ErrorCode.RESOURCE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await _verify_resource_ownership(resource, seller_id, db)
    if resource.status not in (ResourceStatus.available, ResourceStatus.error):
        raise api_error(ErrorCode.RESOURCE_NOT_DELETABLE, status.HTTP_400_BAD_REQUEST)
    if resource.order_id is not None or resource.status == ResourceStatus.error:
        resource.is_archived = True
        await db.commit()
        return
    await db.delete(resource)
    await db.commit()


async def claim_resources(variant_id: int, quantity: int, db: AsyncSession, *, order_id: int, duration_days: int | None) -> list[Resource]:
    from datetime import datetime, timedelta, timezone
    result = await db.execute(
        select(Resource)
        .where(
            Resource.variant_id == variant_id,
            Resource.status == ResourceStatus.available,
            Resource.order_id.is_(None),
            Resource.is_archived == False,  # noqa: E712
        )
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
    """Release resources in the caller-owned transaction. Never commits."""
    for rid in resource_ids:
        resource = await db.get(Resource, rid)
        if resource and resource.status == ResourceStatus.assigned:
            resource.status = ResourceStatus.available
            resource.order_id = None
            resource.assigned_at = None
            resource.expires_at = None
            resource.refund_amount_cap = None


async def order_resources(order_id: int, account_id: int, db: AsyncSession) -> list[Resource]:
    from src.models.order import Order
    order = await db.get(Order, order_id)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != account_id and order.seller_id != account_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    result = await db.execute(
        select(Resource).where(Resource.order_id == order_id).order_by(Resource.id)
    )
    return list(result.scalars().all())


async def mark_resource_error(resource_id: int, seller_id: int, db: AsyncSession) -> Resource:
    from src.alerts.service import fp_resource, upsert_incident
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise api_error(ErrorCode.RESOURCE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if resource.seller_id != seller_id:
        raise NotOwner()
    resource.status = ResourceStatus.error
    await upsert_incident(
        db,
        fingerprint=fp_resource(resource_id, "resource_error"),
        type_="resource_error",
        severity="warning",
        target_type="seller",
        target_id=seller_id,
        message=f"Tài nguyên #{resource_id} được báo lỗi bởi nhà bán",
    )
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


async def resource_seller_facet(db: AsyncSession) -> list[dict]:
    """Đếm tài nguyên theo người bán — nguồn dữ liệu cho dropdown lọc admin."""
    from sqlalchemy import func as safunc
    from src.models.account import Account

    rows = await db.execute(
        select(
            Resource.seller_id,
            Account.email.label("seller_email"),
            safunc.count().label("count"),
        )
        .join(Account, Resource.seller_id == Account.id)
        .group_by(Resource.seller_id, Account.email)
        .order_by(safunc.count().desc(), Account.email)
    )
    return [row._asdict() for row in rows.all()]
