from collections import defaultdict

from fastapi import status as http_status
from sqlalchemy import func, select
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
from src.pricing.engine import product_pricing_override, resolve_pricing
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

    total = await db.scalar(select(func.count(Product.id)).where(*filters)) or 0

    query = select(Product).where(*filters).order_by(Product.created_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)
    products = list((await db.execute(query)).scalars())

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


async def list_seller_products(seller_id: int, db: AsyncSession) -> list[dict]:
    """Bảng quản lý của seller — mọi lookup gom IN/GROUP BY như bản admin.

    Bản cũ mỗi sản phẩm 2 query (danh mục + gói) cộng 1 query đếm kho MỖI gói
    giao ngay; seller 1000 sản phẩm là ~4.000 query một lần mở trang."""
    products = list((await db.execute(
        select(Product).where(Product.seller_id == seller_id).order_by(Product.created_at.desc())
    )).scalars())
    if not products:
        return []

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
    return out


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
            .where(Resource.variant_id.in_(instant_ids), Resource.status == ResourceStatus.available)
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


async def list_all_products_admin(db: AsyncSession) -> list[dict]:
    """Return every product with seller email, provider name, order count, revenue.

    Mọi lookup gom theo IN/GROUP BY — bản cũ query riêng từng product
    (~6 query × N sản phẩm) làm /admin/products mất 1.5s.
    """
    result = await db.execute(select(Product).order_by(Product.created_at.desc()))
    products = list(result.scalars().all())
    if not products:
        return []

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

    product_ids = [p.id for p in products]
    order_counts = {
        pid: cnt for pid, cnt in (
            await db.execute(
                select(Order.product_id, func.count(Order.id))
                .where(Order.product_id.in_(product_ids))
                .group_by(Order.product_id)
            )
        ).all()
    }
    revenues = {
        pid: total for pid, total in (
            await db.execute(
                select(Order.product_id, func.sum(Order.total_amount))
                .where(
                    Order.product_id.in_(product_ids),
                    Order.status.in_([OrderStatus.delivered, OrderStatus.completed]),
                )
                .group_by(Order.product_id)
            )
        ).all()
    }

    # resolve_pricing fallback tier 2 chỉ đọc PricingConfig active theo
    # service_type — prefetch 1 lần rồi resolve tại chỗ.
    configs: dict[str, str] = {}
    for c in (
        await db.execute(select(PricingConfig).where(PricingConfig.is_active == True))  # noqa: E712
    ).scalars():
        configs.setdefault(c.service_type, c.strategy)

    out = []
    for p in products:
        seller = sellers.get(p.seller_id)
        provider = providers.get(p.provider_id) if p.provider_id else None
        order_count = order_counts.get(p.id, 0)
        revenue = revenues.get(p.id) or 0

        pricing_override = product_pricing_override(p)
        strategy_name = (
            pricing_override[0]
            if pricing_override is not None
            else configs.get(p.service_type or "other", "fixed")
        )
        setup = setup_status(
            provider.adapter_type if provider else None, strategy_name,
            provider_active=provider.is_active if provider else True,
        )

        out.append({
            "id": p.id,
            "title": p.title,
            "service_type": p.service_type or "other",
            "status": p.status.value,
            "seller_email": seller.email if seller else None,
            "provider_name": provider.name if provider else None,
            "adapter_type": provider.adapter_type if provider else None,
            "pricing_strategy": p.pricing_strategy,
            "order_count": order_count,
            "revenue": revenue,
            "needs_setup": setup["needs_setup"],
            "needs_setup_reason": setup["needs_setup_reason"],
            "demo_mode": setup["demo_mode"],
        })
    return out


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
