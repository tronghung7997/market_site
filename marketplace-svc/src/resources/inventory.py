"""Seller inventory console — package-level views, multi-scope export, report.

The legacy `/seller/inventory/summary` groups by product and paginates
products; the console rebuilt in 2026-09 treats the *package* (variant) as
the unit of work because resources belong to variants and one package can
hold 10–20k rows. Everything here is scoped to instant-delivery variants of
inventory-managed (fixed-price) products, exactly like the summary.
"""
from __future__ import annotations

import csv
import io
from collections import Counter
from collections.abc import AsyncIterator
from datetime import date, datetime, timedelta, timezone

from fastapi import status as http_status
from sqlalchemy import Date, String, and_, case, cast, func, literal, or_, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from src.categories.service import category_subtree_ids
from src.exceptions import ErrorCode, NotOwner, api_error
from src.models.category import Category
from src.models.order import Order
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.pricing.engine import inventory_managed_sql
from src.seller.dashboard import GROSS_STATUSES, RANGE_KEY_PATTERN, DashboardRange, resolve_range
from src.seller.settings import get_export_row_limit, get_low_stock_threshold

PACKAGE_SORTS = ("available_asc", "available_desc", "title", "last_restock", "sold_desc")
PACKAGE_STOCK_TABS = ("all", "low", "out", "error", "inactive")
RESOURCE_SORTS = ("newest", "oldest")
EXPORT_MASKS = ("none", "middle", "edges", "id_only")
EXPORT_COLUMNS = (
    "index", "category", "product", "variant", "id", "status", "data", "order",
    "created_at", "assigned_at", "expires_at", "price",
)
DEFAULT_EXPORT_COLUMNS = ("product", "variant", "id", "status", "data", "order", "created_at")
# CSV headers follow the UI locale the seller is using, not the server's.
EXPORT_HEADERS = {
    "en": {
        "index": "No.", "category": "Category", "product": "Product", "variant": "Variation", "id": "ID",
        "status": "Status", "data": "Content", "order": "Order", "created_at": "Restocked at",
        "assigned_at": "Delivered at", "expires_at": "Expires at", "price": "Price",
    },
    "vi": {
        "index": "STT", "category": "Danh mục", "product": "Sản phẩm", "variant": "Phân loại", "id": "ID",
        "status": "Trạng thái", "data": "Nội dung", "order": "Đơn hàng", "created_at": "Ngày nạp",
        "assigned_at": "Ngày giao", "expires_at": "Hết hạn", "price": "Giá",
    },
}
STATUS_LABELS = {
    "en": {"available": "ready", "assigned": "sold", "error": "error", "expired": "expired", "archived": "hidden"},
    "vi": {"available": "sẵn sàng", "assigned": "đã bán", "error": "lỗi", "expired": "hết hạn", "archived": "đã ẩn"},
}


def export_locale(raw: str | None) -> str:
    return "vi" if (raw or "").lower().startswith("vi") else "en"
REPORT_GROUPS = ("category", "product", "variant", "day", "week")
REPORT_METRICS = ("added", "sold", "error", "expired", "archived", "stock", "revenue")
REPORT_BASES = ("created", "assigned")
SOLD_WINDOW_DAYS = 30
REVENUE_STATUSES = GROSS_STATUSES
MASK_TOKEN = "••••••"


# ---------------------------------------------------------------------------
# Shared scope + stats
# ---------------------------------------------------------------------------

def _available_filter():
    return and_(
        Resource.status == ResourceStatus.available,
        Resource.order_id.is_(None),
        Resource.is_archived == False,  # noqa: E712
    )


def _variant_stats_subquery(sold_since: datetime):
    """Per-variant counters over non-archived rows (+ archived separately)."""
    live = Resource.is_archived == False  # noqa: E712
    return (
        select(
            Resource.variant_id.label("variant_id"),
            func.count(Resource.id).filter(_available_filter()).label("available"),
            func.count(Resource.id).filter(live, Resource.status == ResourceStatus.assigned).label("assigned"),
            func.count(Resource.id).filter(live, Resource.status == ResourceStatus.error).label("error"),
            func.count(Resource.id).filter(live, Resource.status == ResourceStatus.expired).label("expired"),
            func.count(Resource.id).filter(Resource.is_archived == True).label("archived"),  # noqa: E712
            func.count(Resource.id).filter(
                Resource.assigned_at.is_not(None), Resource.assigned_at >= sold_since,
            ).label("sold_30d"),
            func.max(Resource.created_at).label("last_restock_at"),
        )
        .group_by(Resource.variant_id)
        .subquery()
    )


def _scope_filters(seller_id: int) -> list:
    return [
        Product.seller_id == seller_id,
        inventory_managed_sql(),
        ProductVariant.delivery_mode == DeliveryMode.instant,
    ]


ParentCategory = aliased(Category)


def _package_row(row, low_stock: int) -> dict:
    (pid, pkey, ptitle, pstatus, images, service_type, cat_id, cat_name, cat_parent_id, cat_parent_name,
     vid, vkey, vname, price, delivery_mode, is_active,
     available, assigned, error, expired, archived, sold_30d, last_restock_at) = row
    available = int(available or 0)
    cover_id = None
    if isinstance(images, dict):
        cover_id = images.get("cover_id")
    if not is_active:
        stock_state = "inactive"
    elif available == 0:
        stock_state = "out"
    elif available <= low_stock:
        stock_state = "low"
    else:
        stock_state = "in_stock"
    return {
        "product_id": pid,
        "product_key": pkey,
        "product_title": ptitle,
        "product_status": pstatus.value if hasattr(pstatus, "value") else str(pstatus),
        "cover_id": cover_id,
        "service_type": service_type,
        "category_id": cat_id,
        "category_name": cat_name,
        "category_parent_id": cat_parent_id,
        "category_parent_name": cat_parent_name,
        "variant_id": vid,
        "variant_key": vkey,
        "variant_name": vname,
        "price": int(price),
        "delivery_mode": delivery_mode.value if hasattr(delivery_mode, "value") else delivery_mode,
        "is_active": bool(is_active),
        "available": available,
        "assigned": int(assigned or 0),
        "error": int(error or 0),
        "expired": int(expired or 0),
        "archived": int(archived or 0),
        "sold_30d": int(sold_30d or 0),
        "last_restock_at": last_restock_at,
        "stock_state": stock_state,
    }


def _package_columns(stats):
    return (
        Product.id.label("product_id"), Product.public_key.label("product_key"),
        Product.title.label("product_title"),
        Product.status.label("product_status"), Product.images.label("images"),
        Product.service_type.label("service_type"),
        Category.id.label("category_id"), Category.name.label("category_name"),
        ParentCategory.id.label("category_parent_id"), ParentCategory.name.label("category_parent_name"),
        ProductVariant.id.label("variant_id"), ProductVariant.public_key.label("variant_key"),
        ProductVariant.name.label("variant_name"),
        ProductVariant.price.label("price"), ProductVariant.delivery_mode.label("delivery_mode"),
        ProductVariant.is_active.label("is_active"),
        func.coalesce(stats.c.available, 0).label("available"),
        func.coalesce(stats.c.assigned, 0).label("assigned"),
        func.coalesce(stats.c.error, 0).label("error"),
        func.coalesce(stats.c.expired, 0).label("expired"),
        func.coalesce(stats.c.archived, 0).label("archived"),
        func.coalesce(stats.c.sold_30d, 0).label("sold_30d"),
        stats.c.last_restock_at.label("last_restock_at"),
    )


def _package_base(stats, filters):
    return (
        select(*_package_columns(stats))
        .select_from(ProductVariant)
        .join(Product, Product.id == ProductVariant.product_id)
        .join(Category, Category.id == Product.category_id)
        .outerjoin(ParentCategory, ParentCategory.id == Category.parent_id)
        .outerjoin(stats, stats.c.variant_id == ProductVariant.id)
        .where(*filters)
    )


def _search_filter(search: str | None):
    if not search or not search.strip():
        return None
    raw = search.strip()
    term = f"%{raw}%"
    clauses = [Product.title.ilike(term), ProductVariant.name.ilike(term)]
    if raw.startswith("#") and raw[1:].isdigit():
        raw = raw[1:]
    if raw.isdigit():
        clauses.extend([Product.id == int(raw), ProductVariant.id == int(raw)])
    else:
        # Public keys are what sellers now see in URLs and labels.
        key = raw.lower()
        clauses.extend([Product.public_key == key, ProductVariant.public_key == key])
    return or_(*clauses)


async def list_packages(
    seller_id: int,
    db: AsyncSession,
    *,
    search: str | None = None,
    category_ids: list[int] | None = None,
    product_status: str = "active",
    stock: str = "all",
    include_inactive: bool = False,
    sort: str = "available_asc",
    view: str = "grouped",
    page: int = 1,
    per_page: int = 20,
) -> dict:
    low_stock = await get_low_stock_threshold(db)
    now = datetime.now(timezone.utc)
    stats = _variant_stats_subquery(now - timedelta(days=SOLD_WINDOW_DAYS))
    filters = _scope_filters(seller_id)
    if product_status == "active":
        filters.append(Product.status == ProductStatus.active)
    elif product_status == "paused":
        filters.append(Product.status == ProductStatus.paused)
    if category_ids:
        # A parent category means its whole branch (Mạng xã hội → Facebook, TikTok…).
        filters.append(Product.category_id.in_(await category_subtree_ids(category_ids, db) or [-1]))
    search_clause = _search_filter(search)
    if search_clause is not None:
        filters.append(search_clause)

    scope = _package_base(stats, filters).subquery()
    c = scope.c
    avail = c.available
    err = c.error
    is_active = c.is_active
    low_cond = and_(is_active, avail > 0, avail <= low_stock)
    out_cond = and_(is_active, avail == 0)
    error_cond = err > 0
    inactive_cond = is_active == False  # noqa: E712

    count_row = (await db.execute(select(
        func.count(),
        func.sum(case((low_cond, 1), else_=0)),
        func.sum(case((out_cond, 1), else_=0)),
        func.sum(case((error_cond, 1), else_=0)),
        func.sum(case((inactive_cond, 1), else_=0)),
        func.sum(case((is_active, avail), else_=0)),
        func.sum(c.sold_30d),
        func.count(func.distinct(c.product_id)),
    ).select_from(scope))).one()
    counts = {
        "all": int(count_row[0] or 0),
        "low": int(count_row[1] or 0),
        "out": int(count_row[2] or 0),
        "error": int(count_row[3] or 0),
        "inactive": int(count_row[4] or 0),
        "available_total": int(count_row[5] or 0),
        "sold_30d": int(count_row[6] or 0),
        "products": int(count_row[7] or 0),
    }

    # Category facet over the seller's whole managed scope (not the current filter).
    facet_rows = (await db.execute(
        select(Category.id, Category.name, Category.parent_id, ParentCategory.name, Category.sort_order, func.count(func.distinct(ProductVariant.id)))
        .select_from(ProductVariant)
        .join(Product, Product.id == ProductVariant.product_id)
        .join(Category, Category.id == Product.category_id)
        .outerjoin(ParentCategory, ParentCategory.id == Category.parent_id)
        .where(*_scope_filters(seller_id))
        .group_by(Category.id, Category.name, Category.parent_id, ParentCategory.name, Category.sort_order)
        .order_by(ParentCategory.name.nulls_first(), Category.sort_order, Category.name)
    )).all()
    categories = [
        {"id": cid, "name": name, "parent_id": pid, "parent_name": pname, "count": int(n)}
        for cid, name, pid, pname, _sort, n in facet_rows
    ]

    page_filters = []
    if stock == "low":
        page_filters.append(low_cond)
    elif stock == "out":
        page_filters.append(out_cond)
    elif stock == "error":
        page_filters.append(error_cond)
    elif stock == "inactive":
        page_filters.append(inactive_cond)
    elif not include_inactive:
        page_filters.append(is_active)

    if sort == "available_desc":
        variant_order = [avail.desc(), c.product_title, c.variant_id]
    elif sort == "title":
        variant_order = [c.product_title, c.variant_name, c.variant_id]
    elif sort == "last_restock":
        variant_order = [c.last_restock_at.desc().nulls_last(), c.product_title, c.variant_id]
    elif sort == "sold_desc":
        variant_order = [c.sold_30d.desc(), c.product_title, c.variant_id]
    else:
        variant_order = [avail.asc(), c.product_title, c.variant_id]

    if view == "flat":
        total = int(await db.scalar(select(func.count()).select_from(scope).where(*page_filters)) or 0)
        rows = (await db.execute(
            select(scope).where(*page_filters).order_by(*variant_order)
            .offset((page - 1) * per_page).limit(per_page)
        )).all()
        return {
            "items": [_package_row(r, low_stock) for r in rows],
            "total": total, "page": page, "per_page": per_page,
            "counts": counts, "categories": categories, "low_stock_threshold": low_stock,
            "view": view,
        }

    # Grouped: paginate products, order products by the same key aggregated.
    if sort == "available_desc":
        product_key = func.max(avail).desc()
    elif sort == "last_restock":
        product_key = func.max(c.last_restock_at).desc().nulls_last()
    elif sort == "sold_desc":
        product_key = func.sum(c.sold_30d).desc()
    elif sort == "title":
        product_key = func.min(c.product_title).asc()
    else:
        product_key = func.min(avail).asc()
    product_page = (await db.execute(
        select(c.product_id, func.count().over().label("filtered_total"))
        .select_from(scope).where(*page_filters)
        .group_by(c.product_id)
        .order_by(product_key, func.min(c.product_title), c.product_id)
        .offset((page - 1) * per_page).limit(per_page)
    )).all()
    product_ids = [r[0] for r in product_page]
    total = int(product_page[0].filtered_total) if product_page else 0
    if not product_page and page > 1:
        total = int(await db.scalar(
            select(func.count(func.distinct(c.product_id))).select_from(scope).where(*page_filters)
        ) or 0)
    items: list[dict] = []
    if product_ids:
        rows = (await db.execute(
            select(scope).where(c.product_id.in_(product_ids), *page_filters).order_by(*variant_order)
        )).all()
        by_product: dict[int, list[dict]] = {}
        for r in rows:
            by_product.setdefault(r[0], []).append(_package_row(r, low_stock))
        for pid in product_ids:
            items.extend(by_product.get(pid, []))
    return {
        "items": items,
        "total": total, "page": page, "per_page": per_page,
        "counts": counts, "categories": categories, "low_stock_threshold": low_stock,
        "view": view,
    }


async def resolve_variant_ref(ref: str, db: AsyncSession) -> int:
    """`/seller/inventory/{ref}` accepts the public key (what the UI links to)
    or the legacy numeric id. Raises 404 when neither matches."""
    raw = ref.strip()
    if raw.isdigit():
        variant_id = int(raw)
    else:
        variant_id = await db.scalar(
            select(ProductVariant.id).where(ProductVariant.public_key == raw.lower())
        )
    if not variant_id:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    return variant_id


async def _owned_variant(variant_id: int, seller_id: int, db: AsyncSession) -> tuple[ProductVariant, Product]:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    product = await db.get(Product, variant.product_id)
    if not product or product.seller_id != seller_id:
        raise NotOwner()
    return variant, product


async def get_package(variant_id: int, seller_id: int, db: AsyncSession) -> dict:
    variant, product = await _owned_variant(variant_id, seller_id, db)
    low_stock = await get_low_stock_threshold(db)
    now = datetime.now(timezone.utc)
    stats = _variant_stats_subquery(now - timedelta(days=SOLD_WINDOW_DAYS))
    rows = (await db.execute(
        _package_base(stats, [Product.id == product.id])
        .order_by(ProductVariant.sort_order, ProductVariant.id)
    )).all()
    all_rows = [_package_row(r, low_stock) for r in rows]
    current = next((s for s in all_rows if s["variant_id"] == variant_id), None)
    if current is None or current["delivery_mode"] != DeliveryMode.instant.value:
        # Manual-delivery variants have no inventory to manage.
        raise api_error(ErrorCode.INVENTORY_NOT_INSTANT, http_status.HTTP_400_BAD_REQUEST)
    siblings = [s for s in all_rows if s["delivery_mode"] == DeliveryMode.instant.value]
    field_count = await expected_field_count(variant_id, db)
    return {
        **current,
        "low_stock_threshold": low_stock,
        "expected_field_count": field_count,
        "siblings": [
            {
                "variant_id": s["variant_id"], "variant_key": s["variant_key"],
                "variant_name": s["variant_name"],
                "available": s["available"], "is_active": s["is_active"],
                "delivery_mode": s["delivery_mode"], "price": s["price"],
            }
            for s in siblings
        ],
    }


async def bulk_set_package_active(
    variant_ids: list[int], seller_id: int, is_active: bool, db: AsyncSession,
) -> dict:
    wanted = list(dict.fromkeys(variant_ids))
    rows = (await db.execute(
        select(ProductVariant, Product.seller_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(ProductVariant.id.in_(wanted))
    )).all()
    found = {v.id: (v, owner) for v, owner in rows}
    updated: list[int] = []
    skipped: list[dict] = []
    for vid in wanted:
        entry = found.get(vid)
        if entry is None:
            skipped.append({"id": vid, "reason": "not_found"})
            continue
        variant, owner = entry
        if owner != seller_id:
            skipped.append({"id": vid, "reason": "not_owner"})
            continue
        if variant.is_active != is_active:
            variant.is_active = is_active
        updated.append(vid)
    await db.commit()
    return {"updated": updated, "skipped": skipped, "is_active": is_active}


# ---------------------------------------------------------------------------
# Restock preview
# ---------------------------------------------------------------------------

def _field_count(item: str) -> int:
    return item.count("|") + 1


async def expected_field_count(variant_id: int, db: AsyncSession, sample: int = 500) -> int | None:
    """Most common `|`-field count among the package's recent rows (None if empty)."""
    rows = (await db.execute(
        select(Resource.data).where(Resource.variant_id == variant_id)
        .order_by(Resource.id.desc()).limit(sample)
    )).scalars().all()
    if not rows:
        return None
    return Counter(_field_count(r) for r in rows).most_common(1)[0][0]


async def preview_restock(variant_id: int, seller_id: int, items: list[str], db: AsyncSession) -> dict:
    await _owned_variant(variant_id, seller_id, db)
    cleaned = [item.strip() for item in items if item.strip()]
    unique = list(dict.fromkeys(cleaned))
    duplicate_in_file = len(cleaned) - len(unique)
    existing: set[str] = set()
    if unique:
        existing = set((await db.execute(
            select(Resource.data).where(Resource.variant_id == variant_id, Resource.data.in_(unique))
        )).scalars())
    expected = await expected_field_count(variant_id, db)
    if expected is None and unique:
        expected = Counter(_field_count(i) for i in unique).most_common(1)[0][0]
    malformed: list[dict] = []
    if expected is not None and expected > 1:
        for line_no, item in enumerate(cleaned, start=1):
            n = _field_count(item)
            if n != expected:
                malformed.append({"line": line_no, "fields": n})
                if len(malformed) >= 50:
                    break
    to_add = [i for i in unique if i not in existing]
    return {
        "total_lines": len(cleaned),
        "duplicate_in_file": duplicate_in_file,
        "existing_in_stock": len(unique) - len(to_add),
        "to_add": len(to_add),
        "expected_field_count": expected,
        "malformed": malformed,
        "malformed_total": sum(1 for i in cleaned if expected and expected > 1 and _field_count(i) != expected),
    }


# ---------------------------------------------------------------------------
# Export (multi-scope, masked)
# ---------------------------------------------------------------------------

def mask_data(data: str, mode: str, mask_char: str = "•") -> str:
    token = mask_char * 6
    if mode == "none":
        return data
    if mode == "middle":
        parts = data.split("|")
        if len(parts) >= 3:
            return "|".join([parts[0]] + [token] * (len(parts) - 2) + [parts[-1]])
        if len(parts) == 2:
            return f"{parts[0]}|{token}"
        mode = "edges"
    if mode == "edges":
        if len(data) > 10:
            return f"{data[:4]}{token}{data[-4:]}"
        return f"{data[:2]}{token}" if len(data) > 2 else token
    return ""


async def resolve_export_variants(
    seller_id: int,
    db: AsyncSession,
    *,
    variant_ids: list[int] | None,
    product_ids: list[int] | None,
    category_ids: list[int] | None,
    include_inactive: bool,
) -> list[int]:
    filters = _scope_filters(seller_id)
    scope_clauses = []
    if variant_ids:
        scope_clauses.append(ProductVariant.id.in_(variant_ids))
    if product_ids:
        scope_clauses.append(Product.id.in_(product_ids))
    if category_ids:
        scope_clauses.append(Product.category_id.in_(await category_subtree_ids(category_ids, db) or [-1]))
    if scope_clauses:
        filters.append(or_(*scope_clauses))
    if not include_inactive:
        filters.append(ProductVariant.is_active == True)  # noqa: E712
    rows = (await db.execute(
        select(ProductVariant.id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(*filters)
        .order_by(Product.title, Product.id, ProductVariant.sort_order, ProductVariant.id)
    )).scalars().all()
    return list(rows)


def _resource_filters(
    variant_ids: list[int],
    *,
    statuses: list[str] | None,
    include_archived: bool,
    archived_only: bool = False,
    created_from: datetime | None,
    created_to: datetime | None,
    assigned_from: datetime | None,
    assigned_to: datetime | None,
) -> list:
    filters = [Resource.variant_id.in_(variant_ids)]
    if archived_only:
        filters.append(Resource.is_archived == True)  # noqa: E712
    elif not include_archived:
        filters.append(Resource.is_archived == False)  # noqa: E712
    if statuses:
        filters.append(Resource.status.in_([ResourceStatus(s) for s in statuses]))
    if created_from is not None:
        filters.append(Resource.created_at >= created_from)
    if created_to is not None:
        filters.append(Resource.created_at < created_to)
    if assigned_from is not None:
        filters.append(Resource.assigned_at >= assigned_from)
    if assigned_to is not None:
        filters.append(Resource.assigned_at < assigned_to)
    return filters


def _export_select():
    return (
        select(
            Resource.id, Resource.status, Resource.data, Resource.order_id,
            Resource.created_at, Resource.assigned_at, Resource.expires_at, Resource.is_archived,
            ProductVariant.id, ProductVariant.name, ProductVariant.price,
            Product.id, Product.title, Category.name, ParentCategory.name,
        )
        .join(ProductVariant, ProductVariant.id == Resource.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .join(Category, Category.id == Product.category_id)
        .outerjoin(ParentCategory, ParentCategory.id == Category.parent_id)
    )


def _export_row(row, columns: list[str], mask: str, mask_char: str, *, index: int = 0, locale: str = "en") -> dict:
    (rid, rstatus, data, order_id, created_at, assigned_at, expires_at, archived,
     vid, vname, price, pid, ptitle, cat_name, cat_parent) = row
    labels = STATUS_LABELS[locale]
    status_label = labels[rstatus.value]
    if archived:
        status_label = f"{labels['archived']} ({status_label})"
    values = {
        "index": index,
        "category": f"{cat_parent} › {cat_name}" if cat_parent else cat_name,
        "product": f"{ptitle} (#{pid})",
        "variant": f"{vname} (#{vid})",
        "id": rid,
        "status": status_label,
        "data": "" if mask == "id_only" else mask_data(data, mask, mask_char),
        "order": order_id or "",
        "created_at": created_at.isoformat() if created_at else "",
        "assigned_at": assigned_at.isoformat() if assigned_at else "",
        "expires_at": expires_at.isoformat() if expires_at else "",
        "price": int(price),
    }
    return {col: values[col] for col in columns}


def normalize_columns(columns: list[str] | None, mask: str) -> list[str]:
    cols = [c for c in (columns or DEFAULT_EXPORT_COLUMNS) if c in EXPORT_COLUMNS]
    if mask == "id_only":
        cols = [c for c in cols if c != "data"]
        if "id" not in cols:
            cols.insert(0, "id")
        if "status" not in cols:
            cols.insert(1, "status")
    return cols or list(DEFAULT_EXPORT_COLUMNS)


async def export_preview(
    seller_id: int, db: AsyncSession, *, variant_ids: list[int], limit: int,
    columns: list[str], mask: str, mask_char: str, locale: str = "en", **resource_filters,
) -> dict:
    row_limit = await get_export_row_limit(db)
    if not variant_ids:
        return {"rows": [], "total": 0, "packages": 0, "row_limit": row_limit, "columns": columns}
    filters = _resource_filters(variant_ids, **resource_filters)
    total = int(await db.scalar(select(func.count()).select_from(Resource).where(*filters)) or 0)
    rows = (await db.execute(
        _export_select().where(*filters).order_by(Resource.variant_id, Resource.id).limit(limit)
    )).all()
    return {
        "rows": [_export_row(r, columns, mask, mask_char, index=i, locale=locale) for i, r in enumerate(rows, start=1)],
        "total": total,
        "packages": len(variant_ids),
        "row_limit": row_limit,
        "columns": columns,
        "headers": {c: EXPORT_HEADERS[locale][c] for c in columns},
    }


async def export_stream(
    db: AsyncSession, *, variant_ids: list[int], fmt: str, columns: list[str],
    mask: str, mask_char: str, row_limit: int, locale: str = "en", **resource_filters,
) -> AsyncIterator[str]:
    filters = _resource_filters(variant_ids, **resource_filters) if variant_ids else [literal(False)]

    async def generate() -> AsyncIterator[str]:
        if fmt == "csv":
            out = io.StringIO()
            # UTF-8 BOM so Excel opens Vietnamese headers correctly.
            out.write("\ufeff")
            csv.writer(out).writerow([EXPORT_HEADERS[locale][c] for c in columns])
            yield out.getvalue()
        cursor = 0
        emitted = 0
        while emitted < row_limit:
            batch = (await db.execute(
                _export_select().where(*filters, Resource.id > cursor)
                .order_by(Resource.id).limit(min(1_000, row_limit - emitted))
            )).all()
            if not batch:
                break
            for row in batch:
                emitted += 1
                record = _export_row(row, columns, mask, mask_char, index=emitted, locale=locale)
                if fmt == "txt":
                    yield f"{record.get('data', '')}\n"
                else:
                    out = io.StringIO()
                    csv.writer(out).writerow([record[c] for c in columns])
                    yield out.getvalue()
            cursor = batch[-1][0]

    return generate()


# ---------------------------------------------------------------------------
# Report (aggregates only — never resource content)
# ---------------------------------------------------------------------------

def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _local_day(column, rng: DashboardRange, bucket: str):
    return cast(func.date_trunc(bucket, func.timezone(rng.tz, column)), Date)


async def _report_entity_rows(
    variant_ids: list[int], rng: DashboardRange, group_by: str, db: AsyncSession, *, previous: bool = False,
) -> dict[tuple, dict]:
    start = rng.compare_start if previous else rng.start
    end = rng.compare_end if previous else rng.end
    if group_by == "category":
        key_cols = [Category.id, Category.name, ParentCategory.name]
        select_cols = [Category.id, Category.name, cast(literal(None), String)]
        ctx_cols = [cast(literal(None), String), cast(literal(None), String), Category.id, Category.name, ParentCategory.name]
    elif group_by == "product":
        key_cols = [Product.id, Product.title, Category.id, Category.name, ParentCategory.name]
        select_cols = [Product.id, Product.title, Category.name]
        ctx_cols = [Product.id, Product.title, Category.id, Category.name, ParentCategory.name]
    else:
        key_cols = [ProductVariant.id, ProductVariant.name, Product.id, Product.title, Category.id, Category.name, ParentCategory.name]
        select_cols = [ProductVariant.id, ProductVariant.name, Product.title]
        ctx_cols = [Product.id, Product.title, Category.id, Category.name, ParentCategory.name]
    live = Resource.is_archived == False  # noqa: E712
    res_rows = (await db.execute(
        select(
            *select_cols,
            *ctx_cols,
            func.count(Resource.id).filter(Resource.created_at >= start, Resource.created_at < end).label("added"),
            func.count(Resource.id).filter(Resource.assigned_at >= start, Resource.assigned_at < end).label("sold"),
            func.count(Resource.id).filter(
                live, Resource.status == ResourceStatus.error,
                Resource.assigned_at >= start, Resource.assigned_at < end,
            ).label("error"),
            func.count(Resource.id).filter(
                live, Resource.status == ResourceStatus.expired,
                Resource.expires_at >= start, Resource.expires_at < end,
            ).label("expired"),
            func.count(Resource.id).filter(
                Resource.is_archived == True, Resource.created_at >= start, Resource.created_at < end,  # noqa: E712
            ).label("archived"),
            func.count(Resource.id).filter(_available_filter()).label("stock"),
        )
        .select_from(ProductVariant)
        .join(Product, Product.id == ProductVariant.product_id)
        .join(Category, Category.id == Product.category_id)
        .outerjoin(ParentCategory, ParentCategory.id == Category.parent_id)
        .outerjoin(Resource, Resource.variant_id == ProductVariant.id)
        .where(ProductVariant.id.in_(variant_ids))
        .group_by(*key_cols)
    )).all()
    if group_by == "category":
        rev_key = Product.category_id
    elif group_by == "product":
        rev_key = Product.id
    else:
        rev_key = Order.variant_id
    rev_rows = (await db.execute(
        select(rev_key, func.coalesce(func.sum(Order.total_amount), 0))
        .select_from(Order)
        .join(Product, Product.id == Order.product_id)
        .where(
            Order.variant_id.in_(variant_ids),
            Order.status.in_(REVENUE_STATUSES),
            Order.created_at >= start, Order.created_at < end,
        )
        .group_by(rev_key)
    )).all()
    revenue = {k: int(v) for k, v in rev_rows}
    out: dict[tuple, dict] = {}
    for key_id, label, sublabel, pid, ptitle, cid, cname, cparent, added, sold, error, expired, archived, stock in res_rows:
        out[(key_id,)] = {
            "key": str(key_id), "label": label, "sublabel": sublabel,
            "product_id": pid, "product_title": ptitle, "category_id": cid, "category_name": cname,
            "category_parent_name": cparent,
            "added": int(added), "sold": int(sold), "error": int(error), "expired": int(expired),
            "archived": int(archived), "stock": int(stock), "revenue": revenue.get(key_id, 0),
        }
    return out


async def _report_time_rows(
    variant_ids: list[int], rng: DashboardRange, bucket: str, basis: str, db: AsyncSession,
) -> dict[tuple, dict]:
    live = Resource.is_archived == False  # noqa: E712
    date_col = Resource.assigned_at if basis == "assigned" else Resource.created_at
    day = _local_day(date_col, rng, bucket)
    res_rows = (await db.execute(
        select(
            day,
            func.count(Resource.id).filter(Resource.created_at >= rng.start, Resource.created_at < rng.end).label("added"),
            func.count(Resource.id).filter(Resource.assigned_at >= rng.start, Resource.assigned_at < rng.end).label("sold"),
            func.count(Resource.id).filter(live, Resource.status == ResourceStatus.error).label("error"),
            func.count(Resource.id).filter(live, Resource.status == ResourceStatus.expired).label("expired"),
            func.count(Resource.id).filter(Resource.is_archived == True).label("archived"),  # noqa: E712
        )
        .where(
            Resource.variant_id.in_(variant_ids),
            date_col >= rng.start, date_col < rng.end,
        )
        .group_by(day)
    )).all()
    order_day = _local_day(Order.created_at, rng, bucket)
    rev_rows = (await db.execute(
        select(order_day, func.coalesce(func.sum(Order.total_amount), 0))
        .where(
            Order.variant_id.in_(variant_ids),
            Order.status.in_(REVENUE_STATUSES),
            Order.created_at >= rng.start, Order.created_at < rng.end,
        )
        .group_by(order_day)
    )).all()
    revenue = {d: int(v) for d, v in rev_rows}
    by_day = {r[0]: r for r in res_rows}
    out: dict[tuple, dict] = {}
    cur = rng.from_date if bucket == "day" else _week_start(rng.from_date)
    step = timedelta(days=1 if bucket == "day" else 7)
    while cur <= rng.to_date:
        r = by_day.get(cur)
        out[(cur,)] = {
            "key": cur.isoformat(), "label": cur.isoformat(), "sublabel": None,
            "product_id": None, "product_title": None, "category_id": None, "category_name": None,
            "category_parent_name": None,
            "added": int(r[1]) if r else 0, "sold": int(r[2]) if r else 0,
            "error": int(r[3]) if r else 0, "expired": int(r[4]) if r else 0,
            "archived": int(r[5]) if r else 0, "stock": 0, "revenue": revenue.get(cur, 0),
        }
        cur += step
    return out


async def inventory_report(
    seller_id: int,
    db: AsyncSession,
    *,
    variant_ids: list[int],
    range_key: str | None,
    tz: str | None,
    from_date: date | None,
    to_date: date | None,
    group_by: str = "variant",
    basis: str = "created",
    compare: bool = True,
    low_only: bool = False,
    has_error: bool = False,
    no_activity: bool = False,
) -> dict:
    rng = resolve_range(range_key, tz, from_date, to_date)
    low_stock = await get_low_stock_threshold(db)
    if not variant_ids:
        rows: dict[tuple, dict] = {}
        prev: dict[tuple, dict] = {}
    elif group_by in ("day", "week"):
        rows = await _report_time_rows(variant_ids, rng, group_by, basis, db)
        prev = {}
    else:
        rows = await _report_entity_rows(variant_ids, rng, group_by, db)
        prev = await _report_entity_rows(variant_ids, rng, group_by, db, previous=True) if compare else {}
    items = []
    for key, row in rows.items():
        if group_by not in ("day", "week"):
            if low_only and not (row["stock"] <= low_stock):
                continue
            if has_error and row["error"] == 0:
                continue
            if no_activity and (row["added"] or row["sold"]):
                continue
        p = prev.get(key)
        items.append({**row, "prev": {k: p[k] for k in REPORT_METRICS} if p else None})
    if group_by not in ("day", "week"):
        items.sort(key=lambda r: (-r["sold"], -r["stock"], r["label"] or ""))
    totals = {m: sum(r[m] for r in items) for m in REPORT_METRICS}
    prev_totals = {m: sum((r["prev"] or {}).get(m, 0) for r in items) for m in REPORT_METRICS} if prev else None
    return {
        "range": rng.as_dict(),
        "group_by": group_by,
        "basis": basis,
        "packages": len(variant_ids),
        "rows": items,
        "totals": totals,
        "prev_totals": prev_totals,
        "low_stock_threshold": low_stock,
    }


def report_csv(report: dict) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    group_by = report["group_by"]
    head = {"category": ["Category"], "product": ["Product", "Category"], "variant": ["Package", "Product"]}.get(
        group_by, ["Period"],
    )
    metric_head = ["Added", "Sold", "Returned (error)", "Expired", "Archived", "Stock now", "Revenue"]
    w.writerow(head + metric_head + ([f"Prev {m}" for m in metric_head] if report.get("prev_totals") else []))
    for r in report["rows"]:
        label = [r["label"]] + ([r["sublabel"] or ""] if len(head) == 2 else [])
        line = label + [r[m] for m in REPORT_METRICS]
        if report.get("prev_totals"):
            line += [(r["prev"] or {}).get(m, 0) for m in REPORT_METRICS]
        w.writerow(line)
    total_line = ["Total"] + ([""] if len(head) == 2 else []) + [report["totals"][m] for m in REPORT_METRICS]
    if report.get("prev_totals"):
        total_line += [report["prev_totals"][m] for m in REPORT_METRICS]
    w.writerow(total_line)
    return out.getvalue()
