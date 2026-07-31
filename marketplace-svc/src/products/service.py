from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.compatibility import check_compatibility, setup_status
from src.adapters.registry import get_spec
from src.exceptions import NotOwner
from src.models.account import Account
from src.models.category import Category
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.order import Order, OrderStatus
from src.models.provider import Provider
from src.models.resource import Resource, ResourceStatus

# Cột duy nhất của ProductVariant cho phép null — xem update_variant.
NULLABLE_VARIANT_FIELDS = {"duration_days"}


async def create_product(seller_id: int, data: dict, db: AsyncSession) -> Product:
    product = Product(seller_id=seller_id, **data)
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


async def _validate_category_exists(category_id: int, db: AsyncSession) -> None:
    category = await db.get(Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Không tìm thấy danh mục")


async def update_product(product_id: int, seller_id: int, data: dict, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")
    if product.seller_id != seller_id:
        raise NotOwner()
    if data.get("category_id") is not None:
        await _validate_category_exists(data["category_id"], db)
    for key, value in data.items():
        if value is not None:
            setattr(product, key, value)
    await db.commit()
    await db.refresh(product)
    return product


async def admin_update_product(product_id: int, data: dict, db: AsyncSession) -> Product:
    """Admin edit of a product's content/status on ANY seller's product.

    Ownership is not checked (admin override). Scope is content + status only;
    commission_rate stays on the operations endpoint and variants/stock remain
    seller-managed.
    """
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")
    if data.get("category_id") is not None:
        await _validate_category_exists(data["category_id"], db)
    for key, value in data.items():
        if value is not None:
            setattr(product, key, value)
    await db.commit()
    await db.refresh(product)
    return product


async def delete_product(product_id: int, seller_id: int, db: AsyncSession) -> None:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")
    if product.seller_id != seller_id:
        raise NotOwner()
    product.status = ProductStatus.paused
    await db.commit()


async def suspend_product(product_id: int, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")
    product.status = ProductStatus.suspended
    await db.commit()
    await db.refresh(product)
    return product


async def create_variant(product_id: int, seller_id: int, data: dict, db: AsyncSession) -> ProductVariant:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")
    if product.seller_id != seller_id:
        raise NotOwner()
    variant = ProductVariant(product_id=product_id, **data)
    db.add(variant)
    await db.commit()
    await db.refresh(variant)
    return variant


async def update_variant(variant_id: int, seller_id: int, data: dict, db: AsyncSession) -> ProductVariant:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Không tìm thấy gói sản phẩm")
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()
    for key, value in data.items():
        # Router đã lọc field không gửi (exclude_unset), nên None ở đây là seller
        # CHỦ Ý xoá giá trị. Chỉ chấp nhận với cột cho phép null — nếu không thì
        # duration_days đặt rồi sẽ không bao giờ trả về "vĩnh viễn" được nữa.
        if value is None and key not in NULLABLE_VARIANT_FIELDS:
            continue
        setattr(variant, key, value)
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
        raise HTTPException(status_code=404, detail="Không tìm thấy gói sản phẩm")
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()

    order_count = await db.scalar(
        select(func.count()).select_from(Order).where(Order.variant_id == variant_id)
    )
    if order_count:
        raise HTTPException(
            status_code=400,
            detail=f"Gói này đã có {order_count} đơn hàng nên không xoá được — lịch sử "
                   f"đơn phải giữ lại. Hãy tắt bán gói này thay vì xoá.",
        )

    resource_count = await db.scalar(
        select(func.count()).select_from(Resource).where(Resource.variant_id == variant_id)
    )
    if resource_count:
        raise HTTPException(
            status_code=400,
            detail=f"Gói này còn {resource_count} tài nguyên trong kho. Xoá hết tài nguyên "
                   f"ở trang Kho hàng trước, hoặc tắt bán gói này thay vì xoá.",
        )

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
    page: int | None = None,
    per_page: int = 100,
) -> dict:
    """Danh sách sản phẩm đang bán — item bản GỌN kèm gói + tồn kho.

    - Số query CỐ ĐỊNH (đếm + trang sản phẩm + gói IN + tồn kho GROUP BY) bất
      kể bao nhiêu sản phẩm/gói — bản cũ 1 + N + N×gói query, 1000 sản phẩm là
      ~3.000 query một request.
    - category_id lọc theo CẢ NHÁNH (danh mục + con cháu) ngay tại DB — đúng
      ngữ nghĩa subtreeIds() client dùng để lọc tay trước đây.
    - page=None trả toàn bộ (trang chủ/hub cần đủ dữ liệu để đếm tổng); truyền
      page thì phân trang chuẩn — hai chế độ chung một phong bì {items, total,
      page, per_page}.
    """
    filters = [Product.status == ProductStatus.active]
    if category_id:
        filters.append(Product.category_id.in_(await _category_subtree_ids(category_id, db)))
    if seller_id:
        filters.append(Product.seller_id == seller_id)

    total = await db.scalar(select(func.count(Product.id)).where(*filters)) or 0

    query = select(Product).where(*filters).order_by(Product.created_at.desc())
    if page is not None:
        query = query.offset((page - 1) * per_page).limit(per_page)
    products = list((await db.execute(query)).scalars())

    variants_by_product = await _variants_by_product([p.id for p in products], db)
    return {
        "items": [
            {**_product_list_dict(p), "variants": variants_by_product.get(p.id, [])}
            for p in products
        ],
        "total": total,
        "page": page or 1,
        "per_page": per_page if page is not None else total,
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
    variants_by_product = await _variants_by_product([p.id for p in products], db)

    out = []
    for p in products:
        variants = variants_by_product.get(p.id, [])
        out.append({
            **_product_list_dict(p),
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
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")
    if product.seller_id != seller_id:
        raise NotOwner()
    return await get_product_detail(product_id, db, include_inactive_variants=True)


async def get_product_detail(
    product_id: int, db: AsyncSession, *, include_inactive_variants: bool = False
) -> dict:
    """Chi tiết sản phẩm.

    Trang mua chỉ thấy gói đang bật. Trang quản lý của seller phải thấy cả gói đã
    tắt — nếu không, tắt bán xong là gói biến mất khỏi chính trang sửa và seller
    không còn đường bật lại.
    """
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")

    seller = await db.get(Account, product.seller_id)
    category = await db.get(Category, product.category_id)

    return {
        **_product_dict(product),
        "variants": await _variant_dicts(product_id, db, include_inactive=include_inactive_variants),
        "seller_email": seller.email if seller else None,
        "category_name": category.name if category else None,
    }


async def _variants_by_product(
    product_ids: list[int], db: AsyncSession, *, include_inactive: bool = False
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
        out[v.product_id].append({
            "id": v.id, "product_id": v.product_id, "name": v.name, "price": v.price,
            "delivery_mode": v.delivery_mode.value, "sla_hours": v.sla_hours,
            "duration_days": v.duration_days,
            "sort_order": v.sort_order, "is_active": v.is_active,
            "stock_count": stock_by_variant.get(v.id, 0),
        })
    return out


async def _variant_dicts(product_id: int, db: AsyncSession, *, include_inactive: bool = False) -> list[dict]:
    by_product = await _variants_by_product([product_id], db, include_inactive=include_inactive)
    return by_product.get(product_id, [])


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
        raise HTTPException(
            status_code=400,
            detail="Provider này chưa được admin duyệt (review_status != approved)",
        )
    if provider.seller_id is not None and provider.seller_id != product.seller_id:
        raise HTTPException(
            status_code=400,
            detail="Provider này do seller khác tự đăng ký — chỉ gắn được vào sản phẩm của chính seller đó",
        )


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
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")

    effective_provider_id = data.get("provider_id", product.provider_id)
    effective_strategy = data.get("pricing_strategy", product.pricing_strategy)
    effective_params = data.get("pricing_params", product.pricing_params)

    provider = await db.get(Provider, effective_provider_id) if effective_provider_id else None
    _validate_provider_assignment(provider, product)
    if not effective_strategy:
        from src.pricing.engine import resolve_pricing
        effective_strategy, _ = await resolve_pricing(product, db)

    compat = check_compatibility(provider.adapter_type if provider else None, effective_strategy)
    if compat.level == "block":
        raise HTTPException(status_code=400, detail=compat.message)
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
        raise HTTPException(status_code=404, detail="Không tìm thấy sản phẩm")
    if product.seller_id != seller_id:
        raise NotOwner()

    effective_strategy = data.get("pricing_strategy", product.pricing_strategy)
    effective_provider_id = data.get("provider_id", product.provider_id)
    effective_params = data.get("pricing_params", product.pricing_params)
    provider = await db.get(Provider, effective_provider_id) if effective_provider_id else None
    if "provider_id" in data and provider is not None and provider.seller_id != seller_id:
        raise HTTPException(
            status_code=400,
            detail="Seller chỉ tự gắn được provider do chính mình đăng ký — provider dùng chung hoặc của seller khác vẫn phải qua admin",
        )
    _validate_provider_assignment(provider, product)
    if not effective_strategy:
        from src.pricing.engine import resolve_pricing
        effective_strategy, _ = await resolve_pricing(product, db)

    compat = check_compatibility(provider.adapter_type if provider else None, effective_strategy)
    if compat.level == "block":
        raise HTTPException(status_code=400, detail=compat.message)
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
    from src.models.pricing_config import PricingConfig

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

        if p.pricing_strategy and p.pricing_params:
            strategy_name = p.pricing_strategy
        else:
            strategy_name = configs.get(p.service_type or "other", "fixed")
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


def _product_list_dict(product: Product) -> dict:
    """Bản GỌN cho item danh sách — không description/specs/features/warranty
    (nặng, chỉ trang chi tiết cần), không commission_rate (không phát ra API
    public). Thêm trường ở đây thì thêm cả ProductListItemBase bên schemas."""
    return {
        "id": product.id, "seller_id": product.seller_id, "category_id": product.category_id,
        "title": product.title, "images": product.images,
        "escrow_days": product.escrow_days, "status": product.status.value,
        "service_type": product.service_type,
        "highlight_text": product.highlight_text, "sold_count": product.sold_count,
        "rating_avg": product.rating_avg, "rating_count": product.rating_count,
        "pricing_strategy": product.pricing_strategy,
        "pricing_params": product.pricing_params,
        "created_at": product.created_at,
    }


def _product_dict(product: Product) -> dict:
    return {
        "id": product.id, "seller_id": product.seller_id, "category_id": product.category_id,
        "title": product.title, "description": product.description, "images": product.images,
        "escrow_days": product.escrow_days, "status": product.status.value,
        "service_type": product.service_type, "features": product.features,
        "specs": product.specs, "warranty_text": product.warranty_text,
        "highlight_text": product.highlight_text, "sold_count": product.sold_count,
        "rating_avg": product.rating_avg, "rating_count": product.rating_count,
        "pricing_strategy": product.pricing_strategy,
        "pricing_params": product.pricing_params,
        "commission_rate": product.commission_rate,
        "created_at": product.created_at, "updated_at": product.updated_at,
    }
