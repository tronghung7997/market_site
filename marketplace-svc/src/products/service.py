from collections import defaultdict

from fastapi import status as http_status
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.compatibility import check_compatibility, setup_status
from src.adapters.registry import get_spec
from src.exceptions import ErrorCode, NotOwner, api_error
from src.i18n.catalog import (
    DEFAULT_LOCALE,
    available_locales,
    merge_i18n_locale,
    resolve_category_fields,
    resolve_product_pricing_params,
    resolve_product_fields,
    resolve_product_specs,
    resolve_variant_fields,
)
from src.models.account import Account
from src.models.category import Category
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.order import Order, OrderStatus
from src.models.pricing_config import PricingConfig
from src.models.provider import Provider
from src.models.resource import Resource, ResourceStatus
from src.pricing.engine import inventory_managed_sql, product_pricing_override, resolve_pricing
from src.products.covers import catalog_items, default_cover_id, images_payload, public_images

# Cột duy nhất của ProductVariant cho phép null — xem update_variant.
NULLABLE_VARIANT_FIELDS = {"duration_days"}
PRODUCT_TRANSLATION_FIELDS = (
    "title", "description", "warranty_text", "highlight_text", "features",
    "specs", "pricing_labels",
)
PRODUCT_LEGACY_MIRROR_FIELDS = (
    "title", "description", "warranty_text", "highlight_text", "features", "specs",
)
PRIMARY_LOCALE_KEY = "_primary_locale"


def _product_i18n_from_scalars(data: dict, *, existing: dict | None = None, locale: str = "vi") -> dict:
    """Mirror writable text scalars into the seller-selected locale bucket.

    ``vi`` remains the default for backward-compatible API clients. The seller
    workbench sends ``content_locale`` explicitly so an EN-only product never
    creates a fake Vietnamese translation (and vice versa).
    """
    fields = {
        k: data[k]
        for k in PRODUCT_TRANSLATION_FIELDS
        if k in data and data[k] is not None
    }
    if not fields:
        return existing or {}
    return merge_i18n_locale(existing, locale, fields)


def _images_for_create(data: dict) -> dict:
    cover_id = data.pop("cover_id", None)
    data.pop("images", None)
    return images_payload(cover_id or default_cover_id(data.get("service_type")))


def _apply_cover_update(product: Product, data: dict) -> None:
    if "cover_id" not in data:
        data.pop("images", None)
        return
    cover_id = data.pop("cover_id")
    data.pop("images", None)
    product.images = None if cover_id is None else images_payload(cover_id)


def list_product_covers() -> dict:
    return {"items": catalog_items()}


async def create_product(seller_id: int, data: dict, db: AsyncSession) -> Product:
    payload = dict(data)
    content_locale = payload.pop("content_locale", "vi")
    payload["images"] = _images_for_create(payload)
    payload["i18n"] = _product_i18n_from_scalars(payload, locale=content_locale)
    payload["i18n"][PRIMARY_LOCALE_KEY] = content_locale
    product = Product(seller_id=seller_id, **payload)
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


async def _validate_category_exists(category_id: int, db: AsyncSession) -> None:
    category = await db.get(Category, category_id)
    if not category:
        raise api_error(ErrorCode.CATEGORY_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)


async def _strategy_after_service_type_change(
    product: Product, service_type: str, db: AsyncSession,
) -> str:
    override = product_pricing_override(product)
    if override is not None:
        return override[0]
    config = (await db.execute(
        select(PricingConfig).where(
            PricingConfig.service_type == service_type,
            PricingConfig.is_active == True,  # noqa: E712
        )
    )).scalars().first()
    return config.strategy if config else "fixed"


async def update_product(product_id: int, seller_id: int, data: dict, db: AsyncSession) -> Product:
    data = dict(data)
    has_content_locale = "content_locale" in data
    content_locale = data.pop("content_locale", None) or "vi"
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    if product.seller_id != seller_id:
        raise NotOwner()
    if data.get("category_id") is not None:
        await _validate_category_exists(data["category_id"], db)
    if data.get("service_type") is not None and data["service_type"] != product.service_type:
        strategy = await _strategy_after_service_type_change(product, data["service_type"], db)
        await _validate_variant_pricing_model(product, strategy, db)
    _apply_cover_update(product, data)
    for key, value in data.items():
        if value is not None:
            setattr(product, key, value)
    text_keys = {"title", "description", "warranty_text", "highlight_text", "features", "specs"}
    if text_keys & data.keys():
        product.i18n = _product_i18n_from_scalars(
            data, existing=product.i18n, locale=content_locale,
        )
        if has_content_locale:
            product.i18n = {**product.i18n, PRIMARY_LOCALE_KEY: content_locale}
    await db.commit()
    await db.refresh(product)
    return product


async def update_seller_product_status(
    product_id: int, seller_id: int, status: str, db: AsyncSession,
) -> Product:
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    if product.seller_id != seller_id:
        raise NotOwner()
    if product.status == ProductStatus.suspended:
        raise api_error(ErrorCode.PRODUCT_SUSPENDED, http_status.HTTP_409_CONFLICT)
    product.status = ProductStatus(status)
    await db.commit()
    await db.refresh(product)
    return product


async def admin_update_product(product_id: int, data: dict, db: AsyncSession) -> Product:
    """Admin edit of a product's content/status on ANY seller's product.

    Ownership is not checked (admin override). Scope is content + status only;
    commission_rate stays on the operations endpoint and variants/stock remain
    seller-managed.
    """
    data = dict(data)
    has_content_locale = "content_locale" in data
    content_locale = data.pop("content_locale", None) or "vi"
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    if data.get("category_id") is not None:
        await _validate_category_exists(data["category_id"], db)
    if data.get("service_type") is not None and data["service_type"] != product.service_type:
        strategy = await _strategy_after_service_type_change(product, data["service_type"], db)
        await _validate_variant_pricing_model(product, strategy, db)
    _apply_cover_update(product, data)
    for key, value in data.items():
        if value is not None:
            setattr(product, key, value)
    text_keys = {"title", "description", "warranty_text", "highlight_text", "features", "specs"}
    if text_keys & data.keys():
        product.i18n = _product_i18n_from_scalars(
            data, existing=product.i18n, locale=content_locale,
        )
        if has_content_locale:
            product.i18n = {**product.i18n, PRIMARY_LOCALE_KEY: content_locale}
    await db.commit()
    await db.refresh(product)
    return product


async def update_product_translation(
    product_id: int,
    locale: str,
    data: dict,
    db: AsyncSession,
    *,
    seller_id: int | None = None,
) -> Product:
    """Update one locale without leaking changes into another locale.

    Vietnamese remains mirrored into the legacy scalar columns while the
    storefront migration is in progress. English only touches ``i18n.en``.
    """
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    if seller_id is not None and product.seller_id != seller_id:
        raise NotOwner()

    fields = {key: value for key, value in data.items() if key in PRODUCT_TRANSLATION_FIELDS}
    if "title" in fields and (
        not isinstance(fields["title"], str) or not fields["title"].strip()
    ):
        raise api_error(ErrorCode.PRODUCT_TITLE_EMPTY, http_status.HTTP_422_UNPROCESSABLE_CONTENT)

    product.i18n = merge_i18n_locale(product.i18n, locale, fields)
    if locale == "vi":
        for key in PRODUCT_LEGACY_MIRROR_FIELDS:
            if key in fields:
                setattr(product, key, fields[key])

    await db.commit()
    await db.refresh(product)
    return product


async def delete_product(product_id: int, seller_id: int, db: AsyncSession) -> None:
    # Backward-compatible pause endpoint. Keep the same lifecycle guard as the
    # explicit status operation so DELETE cannot clear an admin suspension.
    await update_seller_product_status(product_id, seller_id, "paused", db)


async def suspend_product(product_id: int, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    product.status = ProductStatus.suspended
    await db.commit()
    await db.refresh(product)
    return product


async def create_variant(product_id: int, seller_id: int, data: dict, db: AsyncSession) -> ProductVariant:
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    if product.seller_id != seller_id:
        raise NotOwner()
    strategy, _ = await resolve_pricing(product, db)
    if strategy != "fixed":
        raise api_error(ErrorCode.VARIANT_FIXED_ONLY, http_status.HTTP_409_CONFLICT)
    payload = dict(data)
    content_locale = payload.pop("content_locale", "vi")
    if "name" in payload and payload["name"] is not None:
        payload["i18n"] = merge_i18n_locale(
            {}, content_locale, {"name": payload["name"]},
        )
        payload["i18n"][PRIMARY_LOCALE_KEY] = content_locale
    variant = ProductVariant(product_id=product_id, **payload)
    db.add(variant)
    await db.commit()
    await db.refresh(variant)
    return variant


async def update_variant(variant_id: int, seller_id: int, data: dict, db: AsyncSession) -> ProductVariant:
    data = dict(data)
    has_content_locale = "content_locale" in data
    content_locale = data.pop("content_locale", None) or "vi"
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()
    if (
        data.get("delivery_mode") == DeliveryMode.manual.value
        and variant.delivery_mode == DeliveryMode.instant
    ):
        resource_count = await db.scalar(
            select(func.count()).select_from(Resource).where(Resource.variant_id == variant_id)
        )
        if resource_count:
            raise api_error(ErrorCode.VARIANT_HAS_HISTORY, http_status.HTTP_409_CONFLICT)
    for key, value in data.items():
        # Router đã lọc field không gửi (exclude_unset), nên None ở đây là seller
        # CHỦ Ý xoá giá trị. Chỉ chấp nhận với cột cho phép null — nếu không thì
        # duration_days đặt rồi sẽ không bao giờ trả về "vĩnh viễn" được nữa.
        if value is None and key not in NULLABLE_VARIANT_FIELDS:
            continue
        setattr(variant, key, value)
    if "name" in data and data["name"] is not None:
        variant.i18n = merge_i18n_locale(
            variant.i18n, content_locale, {"name": data["name"]},
        )
        if has_content_locale:
            variant.i18n = {**variant.i18n, PRIMARY_LOCALE_KEY: content_locale}
    await db.commit()
    await db.refresh(variant)
    return variant


async def update_variant_translation(
    variant_id: int,
    seller_id: int,
    locale: str,
    name: str,
    db: AsyncSession,
) -> ProductVariant:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()
    clean_name = name.strip()
    if not clean_name:
        raise api_error(ErrorCode.VARIANT_NAME_EMPTY, http_status.HTTP_422_UNPROCESSABLE_CONTENT)
    variant.i18n = merge_i18n_locale(variant.i18n, locale, {"name": clean_name})
    if locale == "vi":
        variant.name = clean_name
    await db.commit()
    await db.refresh(variant)
    return variant


async def delete_variant(variant_id: int, seller_id: int, db: AsyncSession) -> None:
    """Xoá một gói sản phẩm.

    Chặn khi gói còn tài nguyên hoặc đã có đơn: cả hai đều là FK trỏ tới đây, nên
    trước đây lệnh xoá ném ForeignKeyViolationError thành 500 và seller bấm nút
    thì không thấy gì xảy ra. Với gói đã bán thì xoá cũng là sai — lịch sử đơn cần
    giữ lại; muốn dừng bán thì tắt gói (`is_active = false`).
    """
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()

    order_count = await db.scalar(
        select(func.count()).select_from(Order).where(Order.variant_id == variant_id)
    )
    if order_count:
        raise api_error(ErrorCode.VARIANT_HAS_ORDERS, http_status.HTTP_400_BAD_REQUEST, count=order_count)

    resource_count = await db.scalar(
        select(func.count()).select_from(Resource).where(Resource.variant_id == variant_id)
    )
    if resource_count:
        raise api_error(ErrorCode.VARIANT_HAS_RESOURCES, http_status.HTTP_400_BAD_REQUEST, count=resource_count)

    await db.delete(variant)
    await db.commit()


async def _category_subtree_ids(category_id: int, db: AsyncSession) -> list[int]:
    """category_id + toàn bộ hậu duệ đang ACTIVE.

    Cùng ngữ nghĩa với subtreeIds() phía frontend (lib/categories.ts) — client
    vốn chỉ nhìn thấy cây active từ /categories, nên lọc server cũng phải giới
    hạn trong nhánh active để trả đúng tập sản phẩm client từng lọc tay."""
    rows = (await db.execute(select(Category.id, Category.parent_id).where(Category.is_active))).all()
    if category_id not in {cid for cid, _ in rows}:
        return []
    children: dict[int | None, list[int]] = defaultdict(list)
    for cid, pid in rows:
        children[pid].append(cid)
    out: list[int] = []
    stack = [category_id]
    while stack:
        current = stack.pop()
        out.append(current)
        stack.extend(children.get(current, []))
    return out


async def list_products(
    db: AsyncSession,
    category_id: int | None = None,
    seller_id: int | None = None,
    search: str | None = None,
    in_stock: bool = False,
    fulfillment: str | None = None,
    min_price: int | None = None,
    max_price: int | None = None,
    sort: str = "newest",
    page: int = 1,
    per_page: int = 50,
    locale: str = DEFAULT_LOCALE,
) -> dict:
    """Danh sách sản phẩm đang bán — item bản GỌN kèm gói + tồn kho.

    - Số query CỐ ĐỊNH (đếm + trang sản phẩm + gói IN + tồn kho GROUP BY) bất
      kể bao nhiêu sản phẩm/gói — bản cũ 1 + N + N×gói query, 1000 sản phẩm là
      ~3.000 query một request.
    - category_id lọc theo CẢ NHÁNH (danh mục + con cháu) ngay tại DB — đúng
      ngữ nghĩa subtreeIds() client dùng để lọc tay trước đây.
    - Luôn phân trang server-side để một request public không thể kéo toàn bộ
      catalog và tồn kho. Envelope giữ khuôn {items, total, page, per_page}.
    - ``locale`` resolves title/highlight/variant names server-side (EN default).
    """
    filters = [Product.status == ProductStatus.active]
    if category_id:
        filters.append(Product.category_id.in_(await _category_subtree_ids(category_id, db)))
    if seller_id:
        filters.append(Product.seller_id == seller_id)

    has_browse_filters = bool(
        search or in_stock or fulfillment or min_price is not None
        or max_price is not None or sort != "newest"
    )
    variants_by_product: dict[int, list[dict]] | None = None

    if has_browse_filters:
        products = list((await db.execute(
            select(Product).where(*filters).order_by(Product.created_at.desc(), Product.id.desc())
        )).scalars())
        if search:
            needle = search.strip().casefold()
            matching_products = []
            for product in products:
                localized = resolve_product_fields(product, locale)
                if (
                    needle in localized["title"].casefold()
                    or needle in (localized.get("highlight_text") or "").casefold()
                ):
                    matching_products.append(product)
            products = matching_products

        variants_by_product = await _variants_by_product(
            [product.id for product in products], db, locale=locale,
        )

        def browse_price(product: Product) -> int:
            variants = variants_by_product.get(product.id, [])
            prices = [row["price"] for row in variants if row["price"] > 0]
            if prices:
                return min(prices)
            params = product.pricing_params or {}
            if product.pricing_strategy == "credit":
                unit = params.get("credit_price", 0)
                packages = params.get("packages", [])
                sizes = [
                    row.get("size", 0) for row in packages
                    if isinstance(row, dict) and isinstance(row.get("size"), (int, float)) and row["size"] > 0
                ] if isinstance(packages, list) else []
                return int(unit * min(sizes)) if isinstance(unit, (int, float)) and unit > 0 and sizes else 0
            if product.pricing_strategy == "config":
                base = params.get("base_price", 0)
                duration_options = params.get("duration_options", [])
                durations = [
                    row.get("days", 0) for row in duration_options
                    if isinstance(row, dict) and isinstance(row.get("days"), (int, float)) and row["days"] > 0
                ] if isinstance(duration_options, list) else []
                days = min(durations) if durations else 30
                type_mult = params.get("type_mult") or {}
                network_mult = params.get("network_mult") or {}
                type_values = [value for value in type_mult.values() if isinstance(value, (int, float)) and value > 0] if isinstance(type_mult, dict) else []
                network_values = [value for value in network_mult.values() if isinstance(value, (int, float)) and value > 0] if isinstance(network_mult, dict) else []
                return round(base * (min(type_values) if type_values else 1) * (min(network_values) if network_values else 1) * days / 30) if isinstance(base, (int, float)) and base > 0 else 0
            base = params.get("base_price", 0)
            return int(base) if isinstance(base, (int, float)) and base > 0 else 0

        if in_stock:
            products = [
                product for product in products
                if product.pricing_strategy not in (None, "fixed")
                or sum(row["stock_count"] for row in variants_by_product.get(product.id, [])) > 0
            ]
        if fulfillment == "instant":
            products = [
                product for product in products
                if product.pricing_strategy in (None, "fixed")
                and any(row["delivery_mode"] == "instant" for row in variants_by_product.get(product.id, []))
            ]
        if min_price is not None:
            products = [product for product in products if browse_price(product) >= min_price]
        if max_price is not None:
            products = [product for product in products if 0 < browse_price(product) <= max_price]

        if sort == "bestseller":
            products.sort(key=lambda product: (product.sold_count, product.id), reverse=True)
        elif sort == "rating":
            products.sort(key=lambda product: (product.rating_avg or 0, product.rating_count, product.id), reverse=True)
        elif sort == "price_asc":
            products.sort(key=lambda product: (browse_price(product) <= 0, browse_price(product), product.id))
        elif sort == "price_desc":
            products.sort(key=lambda product: (browse_price(product), product.id), reverse=True)

        total = len(products)
        start = (page - 1) * per_page
        products = products[start:start + per_page]
    else:
        total = await db.scalar(select(func.count(Product.id)).where(*filters)) or 0
        query = select(Product).where(*filters).order_by(Product.created_at.desc(), Product.id.desc())
        query = query.offset((page - 1) * per_page).limit(per_page)
        products = list((await db.execute(query)).scalars())

    if variants_by_product is None:
        variants_by_product = await _variants_by_product(
            [p.id for p in products], db, locale=locale,
        )
    return {
        "items": [
            {
                **_product_list_dict(p, locale=locale),
                "variants": variants_by_product.get(p.id, []),
            }
            for p in products
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


async def get_product_catalog_summary(db: AsyncSession) -> dict:
    """Global public-catalog totals without loading every product into Next.js."""
    active_products = Product.status == ProductStatus.active
    products = await db.scalar(select(func.count(Product.id)).where(active_products)) or 0
    variants = await db.scalar(
        select(func.count(ProductVariant.id))
        .join(Product, Product.id == ProductVariant.product_id)
        .where(active_products, ProductVariant.is_active == True)  # noqa: E712
    ) or 0
    available_stock = await db.scalar(
        select(func.count(Resource.id))
        .join(ProductVariant, ProductVariant.id == Resource.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(
            active_products,
            ProductVariant.is_active == True,  # noqa: E712
            ProductVariant.delivery_mode == DeliveryMode.instant,
            Resource.status == ResourceStatus.available,
            Resource.order_id.is_(None),
            Resource.is_archived == False,  # noqa: E712
        )
    ) or 0
    category_rows = (await db.execute(
        select(Product.category_id, func.count(Product.id))
        .where(active_products)
        .group_by(Product.category_id)
    )).all()
    return {
        "products": products,
        "variants": variants,
        "available_stock": available_stock,
        "category_counts": [
            {"category_id": category_id, "count": count}
            for category_id, count in category_rows
        ],
    }


SELLER_LOW_STOCK = 20


def _empty_seller_counts() -> dict:
    return {
        "all": 0, "active": 0, "paused": 0, "low_stock": 0,
        "out_of_stock": 0, "total_stock": 0,
    }


def _seller_search_filters(seller_id: int, search: str | None) -> list:
    filters = [Product.seller_id == seller_id]
    if search and search.strip():
        term = search.strip()
        search_filters = [Product.title.ilike(f"%{term}%")]
        if term.isdigit():
            search_filters.append(Product.id == int(term))
        filters.append(or_(*search_filters))
    return filters


def _available_stock_by_product():
    return (
        select(
            ProductVariant.product_id.label("product_id"),
            func.count(Resource.id).label("stock"),
        )
        .join(Resource, Resource.variant_id == ProductVariant.id)
        .where(
            ProductVariant.delivery_mode == DeliveryMode.instant,
            Resource.status == ResourceStatus.available,
            Resource.order_id.is_(None),
            Resource.is_archived == False,  # noqa: E712
        )
        .group_by(ProductVariant.product_id)
        .subquery()
    )


async def list_seller_products(
    seller_id: int,
    db: AsyncSession,
    *,
    search: str | None = None,
    status: str | None = None,
    category: str | None = None,
    service_type: str | None = None,
    page: int = 1,
    per_page: int = 50,
) -> dict:
    """Bảng quản lý của seller — mọi lookup gom IN/GROUP BY như bản admin.

    Bản cũ mỗi sản phẩm 2 query (danh mục + gói) cộng 1 query đếm kho MỖI gói
    giao ngay; seller 1000 sản phẩm là ~4.000 query một lần mở trang."""
    filters = _seller_search_filters(seller_id, search)
    stock = _available_stock_by_product()
    stock_col = func.coalesce(stock.c.stock, 0)
    managed = inventory_managed_sql()
    scoped = (
        select(
            Product.id,
            Product.status,
            Product.service_type,
            Product.created_at,
            Category.name.label("category_name"),
            stock_col.label("stock"),
            managed.label("managed"),
        )
        .outerjoin(Category, Category.id == Product.category_id)
        .outerjoin(stock, stock.c.product_id == Product.id)
        .where(*filters)
    )
    scope = scoped.subquery()
    facet_base = (
        select(Product.category_id, Product.service_type)
        .where(*filters)
        .subquery()
    )
    categories = list((await db.execute(
        select(Category.name)
        .join(facet_base, facet_base.c.category_id == Category.id)
        .distinct().order_by(Category.name)
    )).scalars())
    service_types = list((await db.execute(
        select(facet_base.c.service_type)
        .where(facet_base.c.service_type.is_not(None))
        .distinct().order_by(facet_base.c.service_type)
    )).scalars())
    count_row = (await db.execute(select(
        func.count(scope.c.id),
        func.sum(case((scope.c.status == ProductStatus.active, 1), else_=0)),
        func.sum(case((scope.c.status.in_([ProductStatus.paused, ProductStatus.draft]), 1), else_=0)),
        func.sum(case((scope.c.managed & (scope.c.stock > 0) & (scope.c.stock <= SELLER_LOW_STOCK), 1), else_=0)),
        func.sum(case((scope.c.managed & (scope.c.stock == 0), 1), else_=0)),
        func.sum(case((scope.c.managed, scope.c.stock), else_=0)),
    ))).one()
    counts = {
        "all": int(count_row[0] or 0),
        "active": int(count_row[1] or 0),
        "paused": int(count_row[2] or 0),
        "low_stock": int(count_row[3] or 0),
        "out_of_stock": int(count_row[4] or 0),
        "total_stock": int(count_row[5] or 0),
    }
    tab = (status or "all").strip().lower()
    page_filters = []
    if tab == "active":
        page_filters.append(scope.c.status == ProductStatus.active)
    elif tab == "paused":
        page_filters.append(scope.c.status.in_([ProductStatus.paused, ProductStatus.draft]))
    elif tab == "low_stock":
        page_filters.append(scope.c.managed & (scope.c.stock > 0) & (scope.c.stock <= SELLER_LOW_STOCK))
    elif tab == "out_of_stock":
        page_filters.append(scope.c.managed & (scope.c.stock == 0))
    if category:
        page_filters.append(scope.c.category_name == category)
    if service_type:
        page_filters.append(scope.c.service_type == service_type)

    page_rows = (await db.execute(
        select(scope.c.id, func.count().over().label("filtered_total"))
        .where(*page_filters)
        .order_by(scope.c.created_at.desc(), scope.c.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )).all()
    page_ids = [row.id for row in page_rows]
    total = int(page_rows[0].filtered_total) if page_rows else 0
    if not page_rows and page > 1:
        total = int(await db.scalar(
            select(func.count()).select_from(scope).where(*page_filters)
        ) or 0)
    if not page_ids:
        return {
            "items": [], "total": total, "page": page, "per_page": per_page,
            "counts": counts, "categories": categories, "service_types": service_types,
        }
    products = list((await db.execute(
        select(Product).where(Product.id.in_(page_ids))
        .order_by(Product.created_at.desc(), Product.id.desc())
    )).scalars())
    products.sort(key=lambda p: page_ids.index(p.id))

    category_names = {
        c.id: c.name
        for c in (await db.execute(
            select(Category).where(Category.id.in_({p.category_id for p in products}))
        )).scalars()
    }
    # Seller portal: raw scalars (edit forms), not storefront-localized copy.
    variants_by_product = await _variants_by_product(
        [p.id for p in products], db, locale=None,
    )
    pricing_configs = {
        config.service_type: config
        for config in (await db.execute(
            select(PricingConfig).where(PricingConfig.is_active == True)  # noqa: E712
        )).scalars()
    }

    out = []
    for p in products:
        variants = variants_by_product.get(p.id, [])
        item = _product_list_dict(p, locale=None)
        pricing = product_pricing_override(p)
        if pricing is None:
            config = pricing_configs.get(p.service_type or "other")
            pricing = (config.strategy, config.params) if config else ("fixed", {})
        item["pricing_strategy"], item["pricing_params"] = pricing
        out.append({
            **item,
            "category_name": category_names.get(p.category_id),
            "variant_count": len(variants),
            "total_stock": sum(v["stock_count"] for v in variants),
        })
    return {
        "items": out, "total": total, "page": page, "per_page": per_page,
        "counts": counts, "categories": categories, "service_types": service_types,
    }


async def get_seller_stats(seller_id: int, db: AsyncSession) -> dict:
    product_count = await db.scalar(
        select(func.count(Product.id)).where(Product.seller_id == seller_id)
    ) or 0
    active_count = await db.scalar(
        select(func.count(Product.id)).where(
            Product.seller_id == seller_id, Product.status == ProductStatus.active
        )
    ) or 0
    total_orders = await db.scalar(
        select(func.count(Order.id)).where(Order.seller_id == seller_id)
    ) or 0
    pending_orders = await db.scalar(
        select(func.count(Order.id)).where(
            Order.seller_id == seller_id, Order.status == OrderStatus.pending
        )
    ) or 0
    total_revenue = await db.scalar(
        select(func.sum(Order.total_amount)).where(
            Order.seller_id == seller_id, Order.status.in_([OrderStatus.delivered, OrderStatus.completed])
        )
    ) or 0

    return {
        "product_count": product_count,
        "active_count": active_count,
        "total_orders": total_orders,
        "pending_orders": pending_orders,
        "total_revenue": total_revenue,
    }


async def get_own_product_detail(product_id: int, seller_id: int, db: AsyncSession) -> dict:
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    if product.seller_id != seller_id:
        raise NotOwner()
    # Seller portal sees stored scalars (what they edit), not EN-resolved storefront copy.
    return await get_product_detail(
        product_id, db, include_inactive_variants=True, localize=False,
    )


async def get_product_detail(
    product_id: int,
    db: AsyncSession,
    *,
    include_inactive_variants: bool = False,
    locale: str = DEFAULT_LOCALE,
    localize: bool = True,
    public: bool = False,
) -> dict:
    """Chi tiết sản phẩm.

    Trang mua chỉ thấy gói đang bật. Trang quản lý của seller phải thấy cả gói đã
    tắt — nếu không, tắt bán xong là gói biến mất khỏi chính trang sửa và seller
    không còn đường bật lại.

    Public storefront only exposes active products; seller/admin detail remains
    available for managing paused or suspended products. Seller detail uses
    ``localize=False`` so the edit form shows stored scalars.
    """
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    if public and product.status != ProductStatus.active:
        # Use 404 so public callers cannot distinguish a hidden product from a
        # nonexistent one or access it directly by its ID.
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)

    seller = await db.get(Account, product.seller_id)
    category = await db.get(Category, product.category_id)

    if localize:
        base = _product_dict(product, locale=locale)
        category_name = (
            resolve_category_fields(category, locale)["name"] if category else None
        )
        variants = await _variant_dicts(
            product_id, db, include_inactive=include_inactive_variants, locale=locale,
        )
    else:
        base = _product_dict(product, locale=None)
        category_name = category.name if category else None
        variants = await _variant_dicts(
            product_id, db, include_inactive=include_inactive_variants, locale=None,
        )

    return {
        **base,
        "variants": variants,
        "seller_name": seller.email.split("@", 1)[0] if seller else None,
        "seller_email": seller.email if seller else None,
        "category_name": category_name,
    }


async def _variants_by_product(
    product_ids: list[int],
    db: AsyncSession,
    *,
    include_inactive: bool = False,
    locale: str | None = DEFAULT_LOCALE,
) -> dict[int, list[dict]]:
    """Serialize gói kèm tồn kho thật cho NHIỀU sản phẩm bằng đúng 2 query:
    gói (IN product_ids) + đếm Resource available GROUP BY variant_id. Dùng
    chung cho list lẫn detail để hai nơi không lệch số."""
    if not product_ids:
        return {}
    variant_filter = [ProductVariant.product_id.in_(product_ids)]
    if not include_inactive:
        variant_filter.append(ProductVariant.is_active)
    variants = list((await db.execute(
        select(ProductVariant).where(*variant_filter).order_by(ProductVariant.sort_order)
    )).scalars())

    # Chỉ gói giao ngay mới có khái niệm tồn kho — gói manual/adapter giữ 0
    # như bản cũ, đừng đếm Resource cho chúng.
    instant_ids = [v.id for v in variants if v.delivery_mode == DeliveryMode.instant]
    stock_by_variant: dict[int, int] = {}
    if instant_ids:
        rows = await db.execute(
            select(Resource.variant_id, func.count(Resource.id))
            .where(
                Resource.variant_id.in_(instant_ids),
                Resource.status == ResourceStatus.available,
                Resource.order_id.is_(None),
                Resource.is_archived == False,  # noqa: E712
            )
            .group_by(Resource.variant_id)
        )
        stock_by_variant = dict(rows.all())

    out: dict[int, list[dict]] = defaultdict(list)
    for v in variants:
        name = v.name
        if locale is not None:
            name = resolve_variant_fields(v, locale)["name"]
        management = {} if locale is not None else {
            "translations": _management_variant_translations(v),
            "primary_locale": (v.i18n or {}).get(PRIMARY_LOCALE_KEY, "vi"),
        }
        out[v.product_id].append({
            "id": v.id, "product_id": v.product_id, "name": name, "price": v.price,
            "delivery_mode": v.delivery_mode.value, "sla_hours": v.sla_hours,
            "duration_days": v.duration_days,
            "sort_order": v.sort_order, "is_active": v.is_active,
            "stock_count": stock_by_variant.get(v.id, 0),
            **management,
        })
    return out


async def _variant_dicts(
    product_id: int,
    db: AsyncSession,
    *,
    include_inactive: bool = False,
    locale: str | None = DEFAULT_LOCALE,
) -> list[dict]:
    by_product = await _variants_by_product(
        [product_id], db, include_inactive=include_inactive, locale=locale,
    )
    return by_product.get(product_id, [])


async def _validate_variant_pricing_model(
    product: Product, effective_strategy: str, db: AsyncSession,
) -> None:
    if effective_strategy == "fixed":
        return
    variant_count = await db.scalar(
        select(func.count()).select_from(ProductVariant).where(
            ProductVariant.product_id == product.id,
        )
    )
    if variant_count:
        raise api_error(ErrorCode.PRODUCT_HAS_FIXED_VARIANTS, http_status.HTTP_409_CONFLICT)


def _validate_provider_assignment(provider: Provider | None, product: Product) -> None:
    """Gắn provider vào product phải qua 2 cửa, bất kể ai gắn (admin hay seller):

    - Chỉ provider `review_status == "approved"` mới được gắn — provider seller
      tự đăng ký (Provider.seller_id != None) mặc định `pending_review`, admin
      phải bấm duyệt trước (providers/service.py::review_provider).
    - Provider có seller_id (do một seller cụ thể tự đăng ký) chỉ được gắn vào
      SẢN PHẨM CỦA CHÍNH SELLER ĐÓ — admin duyệt xong không có nghĩa admin có
      thể gắn backend riêng của seller B vào sản phẩm seller A.
    """
    if provider is None:
        return
    if provider.review_status != "approved":
        raise api_error(ErrorCode.PROVIDER_NOT_APPROVED, http_status.HTTP_400_BAD_REQUEST)
    if provider.seller_id is not None and provider.seller_id != product.seller_id:
        raise api_error(ErrorCode.PROVIDER_NOT_OWNED, http_status.HTTP_400_BAD_REQUEST)


def _validate_pricing_params_for_provider(
    provider: Provider | None, strategy: str | None, params: dict | None,
) -> None:
    """Cửa thứ hai sau check_compatibility: các GIÁ TRỊ option trong tham số giá
    có phải thứ adapter thật sự nhận không (AdapterSpec.validate_pricing_params).

    Chạy trên tham số HIỆU DỤNG ở cả hai đường lưu (admin operations + seller
    pricing) nên không có lối nào ghi được một sản phẩm mà mọi đơn chắc chắn
    fail — xem docstring validate_topproxy_pricing_params.
    """
    spec = get_spec(provider.adapter_type) if provider else None
    if spec is None or spec.validate_pricing_params is None:
        return
    spec.validate_pricing_params(strategy, params or {})


async def update_product_operations(product_id: int, data: dict, db: AsyncSession) -> Product:
    """Admin gắn provider + chiến lược giá cho một sản phẩm.

    Validate TRƯỚC khi setattr: tính "effective" provider/strategy từ `data`
    đè lên giá trị hiện có (không mutate product khi chưa biết hợp lệ hay
    không) — làm ngược lại (setattr rồi mới validate) có rủi ro autoflush đẩy
    cấu hình sai xuống DB trước khi HTTPException kịp raise, vì Provider/
    resolve_pricing bên dưới cũng chạy SELECT trên cùng session.
    """
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)

    effective_provider_id = data.get("provider_id", product.provider_id)
    effective_strategy = data.get("pricing_strategy", product.pricing_strategy)
    effective_params = data.get("pricing_params", product.pricing_params)

    provider = await db.get(Provider, effective_provider_id) if effective_provider_id else None
    _validate_provider_assignment(provider, product)
    if not effective_strategy:
        effective_strategy, _ = await resolve_pricing(product, db)
    await _validate_variant_pricing_model(product, effective_strategy, db)

    compat = check_compatibility(provider.adapter_type if provider else None, effective_strategy)
    if compat.level == "block":
        raise api_error(ErrorCode.PRODUCT_PRICING_INCOMPATIBLE, http_status.HTTP_400_BAD_REQUEST)
    _validate_pricing_params_for_provider(provider, effective_strategy, effective_params)

    for key, value in data.items():
        setattr(product, key, value)
    await db.commit()
    await db.refresh(product)
    return product


async def update_seller_pricing(product_id: int, seller_id: int, data: dict, db: AsyncSession) -> Product:
    """Seller tự đặt chiến lược giá + tham số cho sản phẩm của mình — và, từ
    seller self-service (spec 2026-07-21 mục "Trạng thái triển khai"), tự gắn
    một trong CÁC PROVIDER CỦA CHÍNH HỌ đã được admin duyệt.

    commission_rate vẫn admin-only (operations endpoint). provider_id giờ có 2
    đường: admin gắn bất kỳ provider nào (kể cả hạ tầng dùng chung) qua
    /admin/products/{id}/operations, HOẶC seller tự gắn provider CỦA CHÍNH HỌ
    (Provider.seller_id == seller_id) — không được gắn provider dùng chung
    (seller_id=None) hay của seller khác, đó vẫn là quyết định của admin.
    """
    product = await db.get(Product, product_id)
    if not product:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, http_status.HTTP_404_NOT_FOUND)
    if product.seller_id != seller_id:
        raise NotOwner()

    effective_strategy = data.get("pricing_strategy", product.pricing_strategy)
    effective_provider_id = data.get("provider_id", product.provider_id)
    effective_params = data.get("pricing_params", product.pricing_params)
    provider = await db.get(Provider, effective_provider_id) if effective_provider_id else None
    if "provider_id" in data and provider is not None and provider.seller_id != seller_id:
        raise api_error(ErrorCode.SELLER_PROVIDER_RESTRICTED, http_status.HTTP_400_BAD_REQUEST)
    _validate_provider_assignment(provider, product)
    if not effective_strategy:
        effective_strategy, _ = await resolve_pricing(product, db)
    await _validate_variant_pricing_model(product, effective_strategy, db)

    compat = check_compatibility(provider.adapter_type if provider else None, effective_strategy)
    if compat.level == "block":
        raise api_error(ErrorCode.PRODUCT_PRICING_INCOMPATIBLE, http_status.HTTP_400_BAD_REQUEST)
    _validate_pricing_params_for_provider(provider, effective_strategy, effective_params)

    for key, value in data.items():
        setattr(product, key, value)
    await db.commit()
    await db.refresh(product)
    return product


def _empty_admin_counts() -> dict:
    return {
        "all": 0, "active": 0, "draft": 0, "paused": 0,
        "suspended": 0, "needs_setup": 0, "total_revenue": 0,
    }


def _admin_strategy_name(
    pricing_strategy: str | None,
    pricing_params: dict | None,
    service_type: str | None,
    configs: dict[str, str],
) -> str:
    if pricing_strategy == "fixed":
        return "fixed"
    if pricing_strategy and pricing_params:
        return pricing_strategy
    return configs.get(service_type or "other", "fixed")


async def list_all_products_admin(
    db: AsyncSession,
    *,
    search: str | None = None,
    status: str | None = None,
    seller: str | None = None,
    provider: str | None = None,
    service_type: str | None = None,
    has_provider: bool | None = None,
    sort_by: str | None = None,
    sort_dir: str = "desc",
    page: int = 1,
    per_page: int = 50,
) -> dict:
    """Return every product with seller email, provider name, order count, revenue.

    Mọi lookup gom theo IN/GROUP BY — bản cũ query riêng từng product
    (~6 query × N sản phẩm) làm /admin/products mất 1.5s.
    """
    filters = []
    if search and search.strip():
        term = search.strip()
        search_filters = [
            Product.title.ilike(f"%{term}%"),
            Account.email.ilike(f"%{term}%"),
            Provider.name.ilike(f"%{term}%"),
        ]
        if term.isdigit():
            search_filters.append(Product.id == int(term))
        filters.append(or_(*search_filters))
    if has_provider is True:
        filters.append(Product.provider_id.is_not(None))
    elif has_provider is False:
        filters.append(Product.provider_id.is_(None))

    configs: dict[str, str] = {}
    for c in (
        await db.execute(select(PricingConfig).where(PricingConfig.is_active == True))  # noqa: E712
    ).scalars():
        configs.setdefault(c.service_type, c.strategy)

    scan = list((await db.execute(
        select(
            Product.id, Product.title, Product.status, Product.service_type,
            Product.pricing_strategy, Product.pricing_params, Product.created_at,
            Account.email, Provider.name, Provider.adapter_type, Provider.is_active,
        )
        .outerjoin(Account, Product.seller_id == Account.id)
        .outerjoin(Provider, Product.provider_id == Provider.id)
        .where(*filters)
        .order_by(Product.created_at.desc(), Product.id.desc())
    )).all())

    annotated = []
    for row in scan:
        strategy = _admin_strategy_name(
            row.pricing_strategy, row.pricing_params, row.service_type, configs,
        )
        setup = setup_status(
            row.adapter_type, strategy,
            provider_active=True if row.is_active is None else bool(row.is_active),
        )
        seller_key = row.email or "—"
        provider_key = row.name or "Seller Pool"
        annotated.append({
            "id": row.id,
            "title": row.title or "",
            "status": row.status.value if row.status else "",
            "service_type": row.service_type or "other",
            "created_at": row.created_at,
            "seller_key": seller_key,
            "provider_key": provider_key,
            "needs_setup": setup["needs_setup"],
            "needs_setup_reason": setup["needs_setup_reason"],
            "demo_mode": setup["demo_mode"],
            "strategy_name": strategy,
        })

    def matches(item: dict, skip: str | None = None) -> bool:
        if skip != "seller" and seller and item["seller_key"] != seller:
            return False
        if skip != "provider" and provider and item["provider_key"] != provider:
            return False
        if skip != "service" and service_type and item["service_type"] != service_type:
            return False
        tab = (status or "all").strip().lower()
        if skip != "status":
            if tab == "needs_setup":
                if not item["needs_setup"]:
                    return False
            elif tab != "all" and item["status"] != tab:
                return False
        return True

    def facet(key_name: str, skip: str) -> list[dict]:
        tally: dict[str, int] = {}
        for item in annotated:
            if not matches(item, skip=skip):
                continue
            key = item[key_name]
            tally[key] = tally.get(key, 0) + 1
        return [
            {"key": key, "count": count}
            for key, count in sorted(tally.items(), key=lambda pair: (-pair[1], pair[0]))
        ]

    scoped = [item for item in annotated if matches(item)]
    counts = _empty_admin_counts()
    counts["all"] = len([item for item in annotated if matches(item, skip="status")])
    for item in annotated:
        if not matches(item, skip="status"):
            continue
        if item["status"] in counts:
            counts[item["status"]] += 1
        if item["needs_setup"]:
            counts["needs_setup"] += 1

    sort_key = (sort_by or "created_at").strip().lower()
    descending = (sort_dir or "desc").lower() != "asc"
    order_counts: dict[int, int] = {}
    revenues: dict[int, int] = {}
    scoped_ids = [item["id"] for item in scoped]
    count_ids = [item["id"] for item in annotated if matches(item, skip="status")]
    metric_ids = set(scoped_ids) | set(count_ids)
    if metric_ids:
        order_counts = {
            pid: cnt for pid, cnt in (
                await db.execute(
                    select(Order.product_id, func.count(Order.id))
                    .where(Order.product_id.in_(metric_ids))
                    .group_by(Order.product_id)
                )
            ).all() if pid in metric_ids
        }
        revenues = {
            pid: int(total or 0) for pid, total in (
                await db.execute(
                    select(Order.product_id, func.sum(Order.total_amount))
                    .where(
                        Order.product_id.in_(metric_ids),
                        Order.status.in_([OrderStatus.delivered, OrderStatus.completed]),
                    )
                    .group_by(Order.product_id)
                )
            ).all() if pid in metric_ids
        }
        counts["total_revenue"] = sum(revenues.get(pid, 0) for pid in count_ids)

    def sort_value(item: dict):
        if sort_key == "title":
            return item["title"].lower()
        if sort_key == "status":
            return item["status"]
        if sort_key == "service_type":
            return item["service_type"]
        if sort_key == "seller_email":
            return item["seller_key"].lower()
        if sort_key == "provider_name":
            return item["provider_key"].lower()
        if sort_key == "order_count":
            return order_counts.get(item["id"], 0)
        if sort_key == "revenue":
            return revenues.get(item["id"], 0)
        return item["created_at"] or 0

    scoped.sort(key=lambda item: (sort_value(item), item["id"]), reverse=descending)
    total = len(scoped)
    page_items = scoped[(page - 1) * per_page: page * per_page]
    products = []
    if page_items:
        by_id = {
            p.id: p for p in (
                await db.execute(select(Product).where(Product.id.in_([i["id"] for i in page_items])))
            ).scalars()
        }
        products = [by_id[item["id"]] for item in page_items if item["id"] in by_id]
    setup_by_id = {item["id"]: item for item in page_items}
    if not products:
        return {
            "items": [], "total": total, "page": page, "per_page": per_page,
            "counts": counts, "sellers": facet("seller_key", "seller"),
            "providers": facet("provider_key", "provider"),
            "services": facet("service_type", "service"),
        }

    seller_ids = {p.seller_id for p in products}
    sellers = {
        a.id: a for a in (
            await db.execute(select(Account).where(Account.id.in_(seller_ids)))
        ).scalars()
    }

    provider_ids = {p.provider_id for p in products if p.provider_id}
    providers = {}
    if provider_ids:
        providers = {
            pr.id: pr for pr in (
                await db.execute(select(Provider).where(Provider.id.in_(provider_ids)))
            ).scalars()
        }

    out = []
    for p in products:
        seller = sellers.get(p.seller_id)
        provider = providers.get(p.provider_id) if p.provider_id else None
        meta = setup_by_id.get(p.id, {})
        out.append({
            "id": p.id,
            "title": p.title,
            "service_type": p.service_type or "other",
            "status": p.status.value,
            "seller_email": seller.email if seller else None,
            "provider_name": provider.name if provider else None,
            "adapter_type": provider.adapter_type if provider else None,
            "pricing_strategy": p.pricing_strategy,
            "order_count": order_counts.get(p.id, 0),
            "revenue": revenues.get(p.id) or 0,
            "needs_setup": meta.get("needs_setup", False),
            "needs_setup_reason": meta.get("needs_setup_reason"),
            "demo_mode": meta.get("demo_mode", False),
        })
    return {
        "items": out, "total": total, "page": page, "per_page": per_page,
        "counts": counts, "sellers": facet("seller_key", "seller"),
        "providers": facet("provider_key", "provider"),
        "services": facet("service_type", "service"),
    }


def _product_list_dict(product: Product, *, locale: str | None = DEFAULT_LOCALE) -> dict:
    """Bản GỌN cho item danh sách — không description/specs/features/warranty
    (nặng, chỉ trang chi tiết cần), không commission_rate (không phát ra API
    public). Thêm trường ở đây thì thêm cả ProductListItemBase bên schemas.

    When ``locale`` is set, title/highlight_text are resolved via i18n.
    Pass ``locale=None`` for raw scalars (seller tables).
    """
    if locale is not None:
        localized = resolve_product_fields(product, locale)
        title = localized["title"]
        highlight_text = localized["highlight_text"]
        meta = {
            "locale": localized["locale"],
            "available_locales": localized["available_locales"],
        }
    else:
        title = product.title
        highlight_text = product.highlight_text
        meta = {}
    images = public_images(product.images)
    return {
        "id": product.id, "seller_id": product.seller_id, "category_id": product.category_id,
        "title": title, "images": images,
        "cover_id": None if images is None else images["cover_id"],
        "escrow_days": product.escrow_days, "status": product.status.value,
        "service_type": product.service_type,
        "highlight_text": highlight_text, "sold_count": product.sold_count,
        "rating_avg": product.rating_avg, "rating_count": product.rating_count,
        "pricing_strategy": product.pricing_strategy,
        "pricing_params": resolve_product_pricing_params(product, locale) if locale is not None else product.pricing_params,
        "created_at": product.created_at,
        **meta,
    }


def _management_translations(product: Product) -> dict[str, dict]:
    """Return editable locale buckets without applying storefront fallback."""
    translations = {
        locale: dict(bucket)
        for locale, bucket in (product.i18n or {}).items()
        if locale in {"en", "vi"} and isinstance(bucket, dict)
    }
    # Legacy rows predate explicit locale selection and stored Vietnamese in
    # scalar columns, so keep their management fallback. New EN-primary rows
    # carry a marker and must not be presented as if a VI translation exists.
    if (product.i18n or {}).get(PRIMARY_LOCALE_KEY) != "en":
        vi = dict(translations.get("vi") or {})
        for field in PRODUCT_TRANSLATION_FIELDS:
            value = getattr(product, field, None)
            if field not in vi and value is not None:
                vi[field] = value
        if vi:
            translations["vi"] = vi
    return translations


def _management_variant_translations(variant: ProductVariant) -> dict[str, dict]:
    """Return editable package-name buckets without storefront fallback."""
    translations = {
        locale: dict(bucket)
        for locale, bucket in (variant.i18n or {}).items()
        if locale in {"en", "vi"} and isinstance(bucket, dict)
    }
    if (variant.i18n or {}).get(PRIMARY_LOCALE_KEY) != "en":
        vi = dict(translations.get("vi") or {})
        vi.setdefault("name", variant.name)
        translations["vi"] = vi
    return translations


def _product_dict(product: Product, *, locale: str | None = DEFAULT_LOCALE) -> dict:
    if locale is not None:
        localized = resolve_product_fields(product, locale)
        text = {
            "title": localized["title"],
            "description": localized["description"],
            "features": localized["features"],
            "warranty_text": localized["warranty_text"],
            "highlight_text": localized["highlight_text"],
            "locale": localized["locale"],
            "available_locales": localized["available_locales"],
        }
    else:
        translations = _management_translations(product)
        text = {
            "title": product.title,
            "description": product.description,
            "features": product.features,
            "warranty_text": product.warranty_text,
            "highlight_text": product.highlight_text,
            "locale": None,
            "available_locales": available_locales(translations),
            "translations": translations,
            "primary_locale": (product.i18n or {}).get(PRIMARY_LOCALE_KEY, "vi"),
        }
    images = public_images(product.images)
    return {
        "id": product.id, "seller_id": product.seller_id, "category_id": product.category_id,
        **text,
        "images": images,
        "cover_id": None if images is None else images["cover_id"],
        "escrow_days": product.escrow_days, "status": product.status.value,
        "service_type": product.service_type,
        "specs": resolve_product_specs(product, locale) if locale is not None else product.specs,
        "sold_count": product.sold_count,
        "rating_avg": product.rating_avg, "rating_count": product.rating_count,
        "pricing_strategy": product.pricing_strategy,
        "pricing_params": resolve_product_pricing_params(product, locale) if locale is not None else product.pricing_params,
        "commission_rate": product.commission_rate,
        "created_at": product.created_at, "updated_at": product.updated_at,
    }
