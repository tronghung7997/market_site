import csv
import io
from collections.abc import AsyncIterator

from fastapi import status
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.exceptions import ErrorCode, NotOwner, ResourceUnavailable, api_error
from src.logging import current_request_id
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.pricing.engine import inventory_managed_sql

INVENTORY_LOW_STOCK = 5


def _resource_search_clause(search: str | None):
    if not search or not search.strip():
        return None
    q = search.strip()
    if q.startswith("#") and q[1:].isdigit():
        return Resource.order_id == int(q[1:])
    if q.isdigit():
        n = int(q)
        return or_(Resource.id == n, Resource.order_id == n, Resource.data.ilike(f"%{q}%"))
    return Resource.data.ilike(f"%{q}%")


def _fixed_strategy_sql():
    return inventory_managed_sql()


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
    per_page: int = 50,
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
    search_clause = _resource_search_clause(search)
    if search_clause is not None:
        filters.append(search_clause)

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

    await log_event(
        db,
        "warning" if action == "delete" else "info",
        f"Seller bulk resource action={action} variant=#{variant_id} count={len(affected_ids)}",
        request_id=current_request_id(),
        metadata={
            "event": f"seller_resources_bulk_{action}",
            "seller_id": seller_id,
            "variant_id": variant_id,
            "resource_ids": affected_ids,
            # Resource plaintext is intentionally excluded from the audit log.
        },
    )
    await db.commit()
    return action, len(affected_ids), affected_ids


def _empty_inventory_counts() -> dict:
    return {"all": 0, "out": 0, "low": 0, "error": 0, "available": 0}


async def seller_inventory_summary(
    seller_id: int,
    db: AsyncSession,
    *,
    search: str | None = None,
    stock: str | None = None,
    product_status: str = "active",
    product_id: int | None = None,
    variant_id: int | None = None,
    page: int = 1,
    per_page: int = 50,
) -> dict:
    """Đếm tồn kho theo từng gói, phân trang theo sản phẩm."""
    empty = {
        "items": [], "total": 0, "page": page, "per_page": per_page,
        "counts": _empty_inventory_counts(),
    }
    product_filters = [
        Product.seller_id == seller_id,
        _fixed_strategy_sql(),
        ProductVariant.delivery_mode == DeliveryMode.instant,
    ]
    if product_status == "active" and product_id is None and variant_id is None:
        product_filters.append(Product.status == ProductStatus.active)
    if product_id is not None:
        product_filters.append(Product.id == product_id)
    if variant_id is not None:
        owner = await db.scalar(
            select(Product.id)
            .join(ProductVariant, ProductVariant.product_id == Product.id)
            .where(
                ProductVariant.id == variant_id,
                Product.seller_id == seller_id,
            )
        )
        if owner is None:
            return empty
        product_filters.append(Product.id == owner)
    if search and search.strip() and product_id is None and variant_id is None:
        raw_term = search.strip()
        term = f"%{raw_term}%"
        search_filters = [Product.title.ilike(term), ProductVariant.name.ilike(term)]
        if raw_term.isdigit():
            numeric_id = int(raw_term)
            search_filters.extend([
                Product.id == numeric_id,
                ProductVariant.id == numeric_id,
            ])
        product_filters.append(or_(*search_filters))

    matching_product_ids = (
        select(Product.id)
        .join(ProductVariant, ProductVariant.product_id == Product.id)
        .where(*product_filters)
        .distinct()
    )
    product_stock = (
        select(
            Product.id.label("product_id"),
            Product.title.label("product_title"),
            func.count(Resource.id).filter(
                Resource.status == ResourceStatus.available,
                Resource.order_id.is_(None),
                Resource.is_archived == False,  # noqa: E712
            ).label("available"),
            func.count(Resource.id).filter(
                Resource.status == ResourceStatus.error,
                Resource.is_archived == False,  # noqa: E712
            ).label("errors"),
        )
        .join(ProductVariant, ProductVariant.product_id == Product.id)
        .outerjoin(Resource, Resource.variant_id == ProductVariant.id)
        .where(
            Product.id.in_(matching_product_ids),
            ProductVariant.delivery_mode == DeliveryMode.instant,
        )
        .group_by(Product.id, Product.title)
        .subquery()
    )
    out_condition = product_stock.c.available == 0
    low_condition = and_(
        product_stock.c.available > 0,
        product_stock.c.available <= INVENTORY_LOW_STOCK,
    )
    error_condition = product_stock.c.errors > 0
    count_row = (await db.execute(select(
        func.count(product_stock.c.product_id),
        func.sum(case((out_condition, 1), else_=0)),
        func.sum(case((low_condition, 1), else_=0)),
        func.sum(case((error_condition, 1), else_=0)),
        func.sum(product_stock.c.available),
    ))).one()
    counts = {
        "all": int(count_row[0] or 0),
        "out": int(count_row[1] or 0),
        "low": int(count_row[2] or 0),
        "error": int(count_row[3] or 0),
        "available": int(count_row[4] or 0),
    }
    stock_tab = (stock or "all").strip().lower()
    page_filters = []
    if product_id is None and variant_id is None:
        if stock_tab == "out":
            page_filters.append(out_condition)
        elif stock_tab == "low":
            page_filters.append(low_condition)
        elif stock_tab == "error":
            page_filters.append(error_condition)
    page_rows = (await db.execute(
        select(
            product_stock.c.product_id,
            func.count().over().label("filtered_total"),
        )
        .where(*page_filters)
        .order_by(product_stock.c.product_title, product_stock.c.product_id)
        .offset((page - 1) * per_page).limit(per_page)
    )).all()
    page_ids = [row.product_id for row in page_rows]
    total = int(page_rows[0].filtered_total) if page_rows else 0
    if not page_rows and page > 1:
        total = int(await db.scalar(
            select(func.count()).select_from(product_stock).where(*page_filters)
        ) or 0)
    if not page_ids:
        return {
            **empty,
            "total": total,
            "counts": counts,
        }

    stock_rows = await db.execute(
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
            Product.id.in_(page_ids),
            ProductVariant.delivery_mode == DeliveryMode.instant,
        )
        .group_by(
            Product.id, Product.title, ProductVariant.id, ProductVariant.name,
            ProductVariant.delivery_mode, ProductVariant.is_active, Resource.status,
        )
        .order_by(Product.title, Product.id, ProductVariant.sort_order, ProductVariant.id)
    )
    archived_rows = await db.execute(
        select(Resource.variant_id, func.count(Resource.id))
        .where(
            Resource.variant_id.in_(
                select(ProductVariant.id).where(ProductVariant.product_id.in_(page_ids))
            ),
            Resource.is_archived == True,  # noqa: E712
        )
        .group_by(Resource.variant_id)
    )
    archived_by_variant = dict(archived_rows.all())

    by_variant: dict[int, dict] = {}
    for pid, title, vid, vname, delivery_mode, is_active, res_status, count in stock_rows.all():
        entry = by_variant.setdefault(vid, {
            "product_id": pid, "product_title": title,
            "variant_id": vid, "variant_name": vname,
            "delivery_mode": delivery_mode.value if delivery_mode else None,
            "is_active": is_active,
            "available": 0, "assigned": 0, "expired": 0, "error": 0,
            "archived": archived_by_variant.get(vid, 0),
        })
        if res_status is not None:
            entry[res_status.value] = count

    grouped: dict[int, list[dict]] = {}
    for entry in by_variant.values():
        grouped.setdefault(entry["product_id"], []).append(entry)

    items: list[dict] = []
    for pid in page_ids:
        items.extend(grouped.get(pid, []))
    return {
        "items": items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "counts": counts,
    }


async def export_resources(
    variant_id: int,
    seller_id: int,
    db: AsyncSession,
    *,
    format: str,
    status_filter: ResourceStatus | None = None,
    search: str | None = None,
    archived_only: bool = False,
) -> AsyncIterator[str]:
    """Stream one seller-owned variant without loading its inventory into memory."""
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    product = await db.get(Product, variant.product_id)
    if not product or product.seller_id != seller_id:
        raise NotOwner()

    filters = [Resource.variant_id == variant_id]
    if archived_only:
        filters.append(Resource.is_archived == True)  # noqa: E712
    else:
        filters.append(Resource.is_archived == False)  # noqa: E712
    if status_filter:
        filters.append(Resource.status == status_filter)
    search_clause = _resource_search_clause(search)
    if search_clause is not None:
        filters.append(search_clause)

    async def generate() -> AsyncIterator[str]:
        cursor = 0
        if format == "csv":
            yield "ID,Status,Data,Order,Created At\r\n"
        while True:
            rows = list((await db.execute(
                select(Resource).where(*filters, Resource.id > cursor)
                .order_by(Resource.id).limit(1_000)
            )).scalars())
            if not rows:
                break
            for resource in rows:
                if format == "txt":
                    yield f"{resource.data}\n"
                    continue
                output = io.StringIO()
                csv.writer(output).writerow([
                    resource.id,
                    resource.status.value,
                    resource.data,
                    resource.order_id or "",
                    resource.created_at.isoformat(),
                ])
                yield output.getvalue()
            cursor = rows[-1].id

    return generate()


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
            like = f"%{term}%"
            matching_variants = (
                select(ProductVariant.id)
                .join(Product, ProductVariant.product_id == Product.id)
                .where(or_(
                    Product.title.ilike(like),
                    ProductVariant.name.ilike(like),
                ))
            )
            matching_sellers = select(Account.id).where(Account.email.ilike(like))
            base = base.where(or_(
                Resource.variant_id.in_(matching_variants),
                Resource.seller_id.in_(matching_sellers),
            ))

    count_q = select(safunc.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    rows = await db.execute(
        base.order_by(Resource.created_at.desc(), Resource.id.desc())
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
