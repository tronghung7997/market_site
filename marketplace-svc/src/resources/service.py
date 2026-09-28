import csv
import io
from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import status
from sqlalchemy import and_, case, delete, func, inspect, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from src.audit.service import log_event
from src.database import id_in
from src.exceptions import ErrorCode, NotOwner, ResourceUnavailable, api_error
from src.logging import current_request_id
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.resource import (
    LINE_HEAD_CHARS, Resource, ResourceStatus, line_summary, resource_data_hash, resource_search_key,
)
from src.orders.codes import parse_order_ref
from src.pricing.engine import inventory_managed_sql
from src.resources import batches as stock_batches
from src.resources.batches import batches_by_id, order_batches
from src.resources.schemas import EXPORT_BATCH_ROWS, RESOURCE_DATA_MAX_LENGTH

INVENTORY_LOW_STOCK = 5


def _content_match(term: str):
    """Content is encrypted, so search is exact: the first `|` field (username /
    UID / licence key, case-insensitive) or a whole pasted line, both through
    keyed digests."""
    key = resource_search_key(term)
    if not key:
        return None
    return or_(Resource.data_lookup == key, Resource.data_hash == resource_data_hash(term))


def _resource_search_clause(search: str | None):
    if not search or not search.strip():
        return None
    q = search.strip()
    if q.startswith("#") and q[1:].isdigit():
        return Resource.order_id == int(q[1:])
    if q.isdigit():
        n = int(q)
        return or_(Resource.id == n, Resource.order_id == n, _content_match(q))
    parsed = parse_order_ref(q.lstrip("#"))
    if parsed is not None and parsed[0] == "code":
        # Sellers see order codes, so "#ORD-…" / "ord-…" finds the sold rows.
        from src.models.order import Order
        return Resource.order_id.in_(select(Order.id).where(Order.order_code == parsed[1]))
    return _content_match(q)


def _fixed_strategy_sql():
    return inventory_managed_sql()


def _check_line_length(item: str, line: int = 1) -> None:
    if len(item) > RESOURCE_DATA_MAX_LENGTH:
        raise api_error(
            ErrorCode.RESOURCE_TOO_LONG, status.HTTP_422_UNPROCESSABLE_CONTENT,
            line=line, max=RESOURCE_DATA_MAX_LENGTH,
        )


async def bulk_add_resources(
    variant_id: int, seller_id: int, items: list[str], db: AsyncSession, *,
    format_line: str | None = None, login_note: str | None = None, batch_id: int | None = None,
    _retry: bool = True,
) -> dict:
    """Returns {"count", "skipped_duplicate", "skipped_existing", "skipped_market", "batch_id"}:
    duplicates inside the paste, rows this variant already holds, and rows
    this seller already holds elsewhere (another package, or sold before) —
    the console explains each bucket separately. Other shops' stock is never
    consulted: two sellers may list the same content.

    The lines join `batch_id`, or a new batch with `format_line` /
    `login_note` (created only once a line is actually added, so a re-upload of
    known stock leaves no empty batch). Without either they have no batch."""
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

    batch = await stock_batches.owned_batch(batch_id, seller_id, db, variant_id=variant_id) if batch_id is not None else None
    if batch is None and format_line is not None:
        stock_batches.clean_format(format_line)
    cleaned = [item.strip() for item in items if item.strip()]
    for line, item in enumerate(cleaned, start=1):
        _check_line_length(item, line)
    # Two lines that only differ in line endings / padding are the same key.
    by_hash: dict[str, str] = {}
    for item in cleaned:
        by_hash.setdefault(resource_data_hash(item), item)
    if not by_hash:
        await db.commit()
        return {"count": 0, "skipped_duplicate": 0, "skipped_existing": 0, "skipped_market": 0, "batch_id": batch_id}
    taken = (await db.execute(
        select(Resource.data_hash, Resource.variant_id)
        .where(Resource.seller_id == seller_id, Resource.data_hash.in_(list(by_hash)))
    )).all()
    in_variant = {h for h, vid in taken if vid == variant_id}
    elsewhere = {h for h, vid in taken if vid != variant_id}
    new_items = [item for h, item in by_hash.items() if h not in in_variant and h not in elsewhere]
    if new_items and batch is None and format_line is not None:
        batch = await stock_batches.new_batch(
            db, variant_id=variant_id, seller_id=seller_id, actor_id=seller_id,
            format_line=format_line, login_note=login_note,
        )
    for item in new_items:
        db.add(Resource(variant_id=variant_id, seller_id=seller_id, data=item, batch_id=batch.id if batch else None))
    if elsewhere:
        # The shop tried to list stock it already holds or has sold — worth a
        # trace even when it is an honest re-upload.
        await log_event(
            db, "warning",
            f"Seller #{seller_id} uploaded {len(elsewhere)} resource(s) already in their shop",
            request_id=current_request_id(),
            metadata={"event": "resource_duplicate_upload", "seller_id": seller_id, "variant_id": variant_id, "count": len(elsewhere)},
        )
    try:
        await db.commit()
    except IntegrityError:
        # Lost a race with an upload to another of this seller's packages (the
        # per-variant lock above only serialises uploads to this one): recheck
        # once, then the remaining clash is a real duplicate.
        await db.rollback()
        if _retry:
            return await bulk_add_resources(
                variant_id, seller_id, items, db,
                format_line=format_line, login_note=login_note, batch_id=batch_id, _retry=False,
            )
        raise api_error(ErrorCode.RESOURCE_DUPLICATE, status.HTTP_409_CONFLICT) from None
    return {
        "count": len(new_items),
        "skipped_duplicate": len(cleaned) - len(by_hash),
        "skipped_existing": len(in_variant),
        "skipped_market": len(elsewhere),
        "batch_id": batch.id if batch else batch_id,
    }


async def resource_data_by_id(resources: list[Resource], db: AsyncSession) -> dict[int, str]:
    """`{resource_id: data}` for rows whose (deferred) content is needed: reuses
    what the session already loaded and selects the rest in one query."""
    values: dict[int, str] = {}
    missing: list[int] = []
    for resource in resources:
        loaded = inspect(resource).dict
        if "data" in loaded:
            values[resource.id] = loaded["data"]
        else:
            missing.append(resource.id)
    if missing:
        rows = await db.execute(select(Resource.id, Resource.data).where(id_in(Resource.id, missing)))
        values.update(dict(rows.all()))
    return values


# Lines up to this length ride along in list responses; longer ones (cookie
# exports, up to RESOURCE_DATA_MAX_LENGTH) come as their head and are fetched
# one at a time when opened (`order_line_text`) or streamed (delivery.txt).
INLINE_LINE_MAX = 2_000


async def line_heads(resources: list[Resource], db: AsyncSession) -> dict[int, tuple[str, int]]:
    """`{resource_id: (head, length)}` without decrypting whole lines. Rows the
    gv migration has not summarised yet fall back to their full content."""
    if not resources:
        return {}
    stored = {
        rid: (head, length)
        for rid, head, length in (await db.execute(
            select(Resource.id, Resource.data_head, Resource.data_length)
            .where(id_in(Resource.id, [r.id for r in resources]))
        )).all()
    }
    pending = [r for r in resources if stored[r.id][0] is None or stored[r.id][1] is None]
    for rid, data in (await resource_data_by_id(pending, db)).items():
        head, length, _ = line_summary(data)
        stored[rid] = (head, length)
    return {r.id: stored[r.id] for r in resources}


async def line_views(resources: list[Resource], db: AsyncSession) -> dict[int, dict]:
    """List payload of each line: `data` in full when it is short, otherwise
    None with `data_preview` (its head); `data_length` either way."""
    if not resources:
        return {}
    lengths = dict((await db.execute(
        select(Resource.id, Resource.data_length).where(id_in(Resource.id, [r.id for r in resources]))
    )).all())
    short = [r for r in resources if lengths[r.id] is None or lengths[r.id] <= INLINE_LINE_MAX]
    full = await resource_data_by_id(short, db)
    long_rows = [r for r in resources if r.id not in full]
    heads = await line_heads(long_rows, db)
    views: dict[int, dict] = {}
    for r in resources:
        if r.id in full and len(full[r.id]) <= INLINE_LINE_MAX:
            views[r.id] = {"data": full[r.id], "data_preview": None, "data_length": len(full[r.id])}
            continue
        head, length = heads[r.id] if r.id in heads else (full[r.id][:LINE_HEAD_CHARS], len(full[r.id]))
        views[r.id] = {"data": None, "data_preview": f"{head}…", "data_length": length}
    return views


async def with_order_codes(resources: list[Resource], db: AsyncSession) -> list[dict]:
    """Serialize resources for the seller console: the public code of the order
    they were sold on (never the id) and a masked preview instead of content."""
    from src.models.order import Order
    from src.resources.inventory import preview_data
    order_ids = {r.order_id for r in resources if r.order_id is not None}
    codes: dict[int, str] = {}
    if order_ids:
        rows = await db.execute(select(Order.id, Order.order_code).where(Order.id.in_(order_ids)))
        codes = dict(rows.all())
    heads = await line_heads(resources, db)
    return [
        {
            "id": r.id, "variant_id": r.variant_id, "status": r.status, "data_preview": preview_data(*heads[r.id]),
            "order_id": r.order_id, "order_code": codes.get(r.order_id) if r.order_id is not None else None,
            "assigned_at": r.assigned_at, "expires_at": r.expires_at, "created_at": r.created_at,
            "refund_amount_cap": r.refund_amount_cap, "is_archived": r.is_archived, "batch_id": r.batch_id,
        }
        for r in resources
    ]


async def list_resources(
    variant_id: int,
    seller_id: int,
    db: AsyncSession,
    *,
    status_filter: ResourceStatus | None = None,
    search: str | None = None,
    include_archived: bool = False,
    archived_only: bool = False,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    has_order: bool | None = None,
    batch: int | str | None = None,
    sort: str = "newest",
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
    filters = seller_resource_filters(
        variant_id, status_filter=status_filter, search=search, include_archived=include_archived,
        archived_only=archived_only, created_from=created_from, created_to=created_to, has_order=has_order,
        batch=batch,
    )

    total = int(await db.scalar(select(func.count()).select_from(Resource).where(*filters)) or 0)
    order = (Resource.created_at.asc(), Resource.id.asc()) if sort == "oldest" else (Resource.created_at.desc(), Resource.id.desc())
    result = await db.execute(
        select(Resource)
        .where(*filters)
        .order_by(*order)
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    return list(result.scalars().all()), total


def seller_resource_filters(
    variant_id: int,
    *,
    status_filter: ResourceStatus | None = None,
    search: str | None = None,
    include_archived: bool = False,
    archived_only: bool = False,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    has_order: bool | None = None,
    batch: int | str | None = None,
) -> list:
    """One filter set shared by list / export / "select all matching" bulk actions.
    `batch` is a batch id, or "none" for stock uploaded without one."""
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
    if created_from is not None:
        filters.append(Resource.created_at >= created_from)
    if created_to is not None:
        filters.append(Resource.created_at < created_to)
    if has_order is True:
        filters.append(Resource.order_id.is_not(None))
    elif has_order is False:
        filters.append(Resource.order_id.is_(None))
    if batch == "none":
        filters.append(Resource.batch_id.is_(None))
    elif isinstance(batch, int):
        filters.append(Resource.batch_id == batch)
    return filters


async def reveal_resource(resource_id: int, seller_id: int, db: AsyncSession) -> dict:
    """Full content of one stock line for its seller, recorded in the audit log."""
    resource = await db.get(Resource, resource_id, options=[undefer(Resource.data)])
    if not resource:
        raise api_error(ErrorCode.RESOURCE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await _verify_resource_ownership(resource, seller_id, db)
    await log_event(
        db,
        "info",
        f"Seller revealed resource #{resource_id}",
        request_id=current_request_id(),
        metadata={
            "event": "seller_resource_revealed", "actor_id": seller_id,
            "subject_type": "resource", "subject_id": resource_id, "variant_id": resource.variant_id,
        },
    )
    await db.commit()
    return {"id": resource.id, "data": resource.data}


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


async def _assert_not_in_shop(data: str, seller_id: int, db: AsyncSession, *, except_id: int) -> None:
    """Editing a row into a value the shop already holds elsewhere is the same
    duplicate as uploading it; the unique index would reject it with a bare
    500 otherwise."""
    clash = await db.scalar(
        select(Resource.id).where(
            Resource.seller_id == seller_id,
            Resource.data_hash == resource_data_hash(data),
            Resource.id != except_id,
        ).limit(1)
    )
    if clash is not None:
        raise api_error(ErrorCode.RESOURCE_DUPLICATE, status.HTTP_409_CONFLICT)


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
    _check_line_length(data.strip())
    await _assert_not_in_shop(data, resource.seller_id, db, except_id=resource.id)
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
    _check_line_length(data.strip())
    await _assert_not_in_shop(data, resource.seller_id, db, except_id=resource.id)
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


BULK_ALL_MATCHING_LIMIT = 50_000


async def bulk_resource_action(
    variant_id: int,
    seller_id: int,
    action: str,
    resource_ids: list[int] | None,
    db: AsyncSession,
    *,
    match_filters: list | None = None,
) -> tuple[str, int, list[int]]:
    """Archive / restore / delete either an explicit id list or every row
    matching the caller's current filter (`match_filters`, built with
    seller_resource_filters). Filter mode skips rows that cannot take the
    action (assigned units) instead of failing the whole batch, because a
    "select all 12k matching" click cannot be expected to pre-screen them."""
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    from src.models.product import Product
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()

    # Lock and read only id/status/order_id: a "select all matching" click can
    # cover 50 000 rows of up to 200 KB each, and the stock text is not needed.
    locked = select(Resource.id, Resource.status, Resource.order_id).with_for_update(of=Resource)
    by_filter = match_filters is not None
    if by_filter:
        rows = (await db.execute(
            locked.where(*match_filters).order_by(Resource.id).limit(BULK_ALL_MATCHING_LIMIT)
        )).all()
        if action in ("archive", "delete"):
            rows = [r for r in rows if r.status != ResourceStatus.assigned]
    else:
        resource_ids = resource_ids or []
        rows = (await db.execute(
            locked.where(id_in(Resource.id, resource_ids), Resource.variant_id == variant_id)
        )).all()
        if len(set(resource_ids)) != len(resource_ids) or len(rows) != len(resource_ids):
            raise api_error(ErrorCode.RESOURCE_NOT_EDITABLE, status.HTTP_400_BAD_REQUEST)
    affected_ids = [r.id for r in rows]

    if action == "restore":
        if affected_ids:
            await db.execute(update(Resource).where(id_in(Resource.id, affected_ids)).values(is_archived=False))
    elif action in ("archive", "delete"):
        if any(r.status == ResourceStatus.assigned for r in rows):
            raise api_error(ErrorCode.RESOURCE_NOT_DELETABLE, status.HTTP_400_BAD_REQUEST)
        deletable = {
            r.id for r in rows
            if action == "delete" and r.order_id is None and r.status == ResourceStatus.available
        }
        archived = [rid for rid in affected_ids if rid not in deletable]
        if deletable:
            await db.execute(delete(Resource).where(id_in(Resource.id, deletable)))
        if archived:
            await db.execute(update(Resource).where(id_in(Resource.id, archived)).values(is_archived=True))

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
                .order_by(Resource.id).limit(EXPORT_BATCH_ROWS).options(undefer(Resource.data))
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
        # Oldest stock first (FIFO) — the same rule warranty replacements follow.
        .order_by(Resource.created_at, Resource.id)
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


ORDER_RESOURCES_PAGE_MAX = 200


async def order_resources(
    order_id: int, account_id: int, db: AsyncSession, *,
    after: int | None = None, limit: int = 100, ids: list[int] | None = None,
) -> dict:
    """One page of an order's delivered lines (every status, oldest first). Short
    lines carry their content; long ones only their head (`line_views`) and are
    read one at a time with `order_line_text`. An order can hold 5 000 lines of
    up to 200 KB, so lines are never returned all at once: `next_after` continues the page, `line_no`
    keeps the #01… numbering stable across pages, `total` counts every line.
    With `ids`, only those lines of the order (e.g. the ones a dispute names)."""
    from src.models.order import Order
    order = await db.get(Order, order_id)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != account_id and order.seller_id != account_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    limit = max(1, min(limit, ORDER_RESOURCES_PAGE_MAX))
    total = await db.scalar(select(func.count(Resource.id)).where(Resource.order_id == order_id)) or 0
    if ids is not None:
        numbered = (
            select(Resource.id.label("id"), func.row_number().over(order_by=Resource.id).label("line_no"))
            .where(Resource.order_id == order_id)
            .subquery()
        )
        picked = (await db.execute(
            select(Resource, numbered.c.line_no)
            .join(numbered, numbered.c.id == Resource.id)
            .where(id_in(Resource.id, ids[:ORDER_RESOURCES_PAGE_MAX]))
            .order_by(Resource.id)
        )).all()
        views = await line_views([r for r, _ in picked], db)
        return {
            "items": [
                {**_resource_fields(r), **views[r.id], "line_no": line_no, "order_code": order.order_code}
                for r, line_no in picked
            ],
            "next_after": None,
            "total": total,
            "batches": await batches_by_id({r.batch_id for r, _ in picked if r.batch_id is not None}, db),
        }
    before = 0
    if after is not None:
        before = await db.scalar(
            select(func.count(Resource.id)).where(Resource.order_id == order_id, Resource.id <= after)
        ) or 0
    rows = list((await db.execute(
        select(Resource)
        .where(Resource.order_id == order_id, *([Resource.id > after] if after is not None else []))
        .order_by(Resource.id)
        .limit(limit + 1)
    )).scalars())
    page = rows[:limit]
    views = await line_views(page, db)
    return {
        "items": [
            {**_resource_fields(r), **views[r.id], "line_no": before + index + 1, "order_code": order.order_code}
            for index, r in enumerate(page)
        ],
        "next_after": page[-1].id if len(rows) > limit else None,
        "total": total,
        # Every batch of the order (a handful), so later pages group the same way.
        "batches": await order_batches(order_id, db),
    }


async def order_line_text(order_id: int, resource_id: int, account_id: int, db: AsyncSession) -> str:
    """One delivered line of an order in full, for its buyer or seller."""
    from src.models.order import Order
    order = await db.get(Order, order_id)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != account_id and order.seller_id != account_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    data = await db.scalar(select(Resource.data).where(Resource.id == resource_id, Resource.order_id == order_id))
    if data is None:
        raise api_error(ErrorCode.RESOURCE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return data


def _resource_fields(r: Resource) -> dict:
    return {
        "id": r.id, "variant_id": r.variant_id, "status": r.status, "batch_id": r.batch_id,
        "order_id": r.order_id, "assigned_at": r.assigned_at, "expires_at": r.expires_at,
        "created_at": r.created_at, "refund_amount_cap": r.refund_amount_cap, "is_archived": r.is_archived,
    }


async def mark_resource_error(resource_id: int, seller_id: int, db: AsyncSession) -> Resource:
    from src.alerts.service import fp_resource, upsert_incident
    resource = await db.get(Resource, resource_id)
    if not resource:
        raise api_error(ErrorCode.RESOURCE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if resource.seller_id != seller_id:
        raise NotOwner()
    resource.status = ResourceStatus.error
    variant = await db.get(ProductVariant, resource.variant_id)
    await upsert_incident(
        db,
        fingerprint=fp_resource(resource_id, "resource_error"),
        type_="resource_error",
        severity="warning",
        target_type="seller",
        target_id=seller_id,
        message="Một tài nguyên trong kho được báo lỗi bởi nhà bán",
        href=f"/seller/inventory/{variant.public_key}?status=error" if variant else None,
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
