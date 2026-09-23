"""Nguồn PROXY trong /admin/sources — bảng "gói đang bán" và nhập gói.

Khác nguồn catalog (igbm): proxy không có tồn kho thượng nguồn và không bán
theo SKU/phân loại. Một sản phẩm proxy bán theo pricing `config` với bảng
`plan_prices` keyed `type|network|days` (src/pricing/config_pricing.py) —
mỗi key là MỘT "gói đang bán" (offer) nối tới một dòng trong catalog gói đã
đồng bộ (`supplier_catalog_items`):

- DProxy: key ↔ `provider.config.plan_ids[key]` = plan UUID thượng nguồn
  (đúng cơ chế DProxyAdapter đang provision, không đổi gì ở luồng đơn).
- TopProxy tĩnh: `network` chính là `loaiproxy`, `type` = HTTP/SOCKS5;
  giá vốn tra bậc thang theo số ngày (topproxy_costs).
- TopProxy xoay: `network` = "xoay", giá vốn theo đơn vị ngày/tuần/tháng.

Nhờ vậy "đổi nhà cung cấp" = thêm nguồn mới rồi nhập lại gói cho cùng sản
phẩm; buyer chỉ thấy tên gói của mình, không thấy nguồn.
"""
from __future__ import annotations

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.registry import get_spec
from src.adapters.topproxy import STATIC_LOAIPROXY, _STATIC_TYPES, xoay_cost_for_days
from src.adapters.topproxy_costs import static_cost_xu
from src.exceptions import ErrorCode, api_error
from src.models.category import Category
from src.models.product import Product, ProductStatus
from src.models.provider import Provider
from src.models.supplier_listing import SupplierCatalogItem
from src.pricing.config_pricing import humanize_code, parse_plan_price_key, plan_prices_map
from src.suppliers.service import _min_margin_pct, margin_ok
from src.suppliers.sources import SourceScope, _owner_seller_id, suggest_price

XOAY_NETWORK = "xoay"


def is_proxy_source(provider: Provider) -> bool:
    spec = get_spec(provider.adapter_type)
    return bool(spec and spec.proxy_source)


def _require_proxy(provider: Provider) -> None:
    if not is_proxy_source(provider):
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                        detail="Nguồn này không phải nguồn proxy")


def _plan_key(proxy_type: str, network: str, days: int) -> str:
    return f"{proxy_type.strip()}|{network.strip()}|{int(days)}"


# ----------------------------------------------------------------------
# Giá vốn + mã catalog cho một key
# ----------------------------------------------------------------------

def catalog_external_id(provider: Provider, proxy_type: str, network: str, days: int) -> str | None:
    """`type|network|days` → external_id trong catalog gói của provider."""
    if provider.adapter_type == "dproxy":
        plan_ids = (provider.config or {}).get("plan_ids") or {}
        value = plan_ids.get(_plan_key(proxy_type, network, days))
        return str(value) if value else None
    if provider.adapter_type == "topproxy":
        if (provider.config or {}).get("mode") == "xoay" or network == XOAY_NETWORK:
            cost = xoay_cost_for_days(days)
            return f"xoay:{cost[0]}" if cost else None
        return network
    return None


def cost_for(provider: Provider, item: SupplierCatalogItem | None, proxy_type: str, network: str, days: int) -> int | None:
    """Giá vốn MỘT proxy cho kỳ hạn `days`. None = không tra được."""
    if provider.adapter_type == "topproxy":
        if (provider.config or {}).get("mode") == "xoay" or network == XOAY_NETWORK:
            cost = xoay_cost_for_days(days)
            return cost[1] if cost else None
        return static_cost_xu(network, days)
    if item is None:
        return None
    extra = item.extra or {}
    per_plan = item.cost_price
    try:
        count = max(1, int(extra.get("proxy_count") or 1))
    except (TypeError, ValueError):
        count = 1
    plan_days = int(extra.get("duration_days") or 0) or days
    # Gói DProxy có kỳ hạn cố định; nếu admin bán kỳ hạn khác thì quy đổi tuyến tính để ước lượng.
    return round(per_plan / count * (days / plan_days)) if plan_days else round(per_plan / count)


# ----------------------------------------------------------------------
# Bảng gói đang bán
# ----------------------------------------------------------------------

async def _catalog_by_id(provider_id: int, db: AsyncSession) -> dict[str, SupplierCatalogItem]:
    rows = (await db.execute(
        select(SupplierCatalogItem).where(SupplierCatalogItem.provider_id == provider_id)
    )).scalars().all()
    return {r.external_id: r for r in rows}


def formula_prices(params: dict) -> dict[str, int]:
    """Sản phẩm cấu hình theo CÔNG THỨC (base_price × type_mult × network_mult
    × days/30 — cách admin cấu hình DProxy/TopProxy trước khi có /admin/sources)
    → bảng `type|network|days` tương đương, để bảng gói đang bán liệt kê được
    và sửa giá thì chuyển hẳn sang plan_prices."""
    base = params.get("base_price")
    types = params.get("type_mult") or {}
    networks = params.get("network_mult") or {}
    durations = [d for d in (params.get("duration_options") or []) if isinstance(d, dict)]
    if not isinstance(base, (int, float)) or not types or not networks or not durations:
        return {}
    out: dict[str, int] = {}
    for proxy_type, t_mult in types.items():
        for network, n_mult in networks.items():
            for d in durations:
                try:
                    days = int(d.get("days", 0))
                    price = round(float(base) * float(t_mult) * float(n_mult) * days / 30)
                except (TypeError, ValueError):
                    continue
                if days >= 1 and price > 0:
                    out[_plan_key(proxy_type, network, days)] = price
    return out


def effective_prices(params: dict) -> tuple[dict[str, int], bool]:
    """(bảng giá, from_formula)."""
    prices = plan_prices_map(params)
    if prices:
        return prices, False
    return formula_prices(params), True


def _offer_rows(provider: Provider, product: Product, catalog: dict[str, SupplierCatalogItem], min_margin: float) -> list[dict]:
    params = product.pricing_params or {}
    prices, from_formula = effective_prices(params)
    type_display = params.get("type_display") or {}
    network_display = params.get("network_display") or {}
    out = []
    for key, price in prices.items():
        parsed = parse_plan_price_key(key)
        if parsed is None:
            continue
        proxy_type, network, days = parsed
        ext = catalog_external_id(provider, proxy_type, network, days)
        item = catalog.get(ext) if ext else None
        cost = cost_for(provider, item, proxy_type, network, days)
        out.append({
            "product_id": product.id, "product_title": product.title, "product_key": product.public_key,
            "product_status": product.status.value if hasattr(product.status, "value") else str(product.status),
            "plan_key": key, "type": proxy_type, "network": network, "days": days,
            "label": f"{type_display.get(proxy_type) or humanize_code(proxy_type)} · {network_display.get(network) or humanize_code(network)} · {days} ngày",
            "price": price, "cost_price": cost,
            "margin_pct": round((price - cost) / cost * 100, 1) if cost else None,
            "margin_ok": margin_ok(price, cost, min_margin) if cost else True,
            "external_id": ext, "external_name": item.name if item else None,
            "unmapped": bool(provider.adapter_type == "dproxy" and not ext),
            # Giá suy từ công thức cũ — sửa một dòng sẽ chuyển cả sản phẩm sang bảng giá cố định.
            "from_formula": from_formula,
        })
    return out


async def list_offers(provider: Provider, scope: SourceScope, db: AsyncSession) -> list[dict]:
    _require_proxy(provider)
    stmt = select(Product).where(Product.provider_id == provider.id, Product.pricing_strategy == "config")
    if not scope.is_admin:
        stmt = stmt.where(Product.seller_id == scope.seller_id)
    products = (await db.execute(stmt.order_by(Product.id))).scalars().all()
    catalog = await _catalog_by_id(provider.id, db)
    min_margin = _min_margin_pct(provider)
    rows: list[dict] = []
    for product in products:
        rows.extend(_offer_rows(provider, product, catalog, min_margin))
    return rows


# ----------------------------------------------------------------------
# Nhập gói → sản phẩm
# ----------------------------------------------------------------------

def _validate_item(provider: Provider, item: SupplierCatalogItem, spec: dict) -> tuple[str, str, int]:
    proxy_type = str(spec.get("type") or "").strip()
    network = str(spec.get("network") or "").strip()
    extra = item.extra or {}
    try:
        days = int(spec.get("days") or extra.get("duration_days") or 0)
    except (TypeError, ValueError):
        days = 0
    if provider.adapter_type == "topproxy":
        if extra.get("mode") == "xoay":
            network = XOAY_NETWORK
            proxy_type = proxy_type or "HTTP"
            if xoay_cost_for_days(days) is None:
                raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                                detail="Key xoay: số ngày phải >= 1")
        else:
            network = item.external_id
            proxy_type = proxy_type or "HTTP"
            if network not in STATIC_LOAIPROXY:
                raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                                detail=f"Mã loại proxy không hợp lệ: {network}")
        if proxy_type not in _STATIC_TYPES:
            raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                            detail=f"TopProxy chỉ nhận giao thức {', '.join(sorted(_STATIC_TYPES))}")
    if not proxy_type or not network or days < 1:
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                        detail="Mỗi gói cần loại, nhà mạng/quốc gia và số ngày >= 1")
    if "|" in proxy_type or "|" in network:
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST, detail="Mã không được chứa ký tự |")
    return proxy_type, network, days


async def import_plans(
    provider: Provider, scope: SourceScope, items: list[dict], db: AsyncSession, *,
    owner_seller_id: int | None = None,
) -> list[dict]:
    """Mỗi item = một GÓI ĐANG BÁN (một key `type|network|days` với giá bán)
    nối tới một dòng catalog. Gộp nhiều gói vào một sản phẩm bằng
    `product_id` (sản phẩm có sẵn của cùng seller, cùng nguồn) hoặc
    `group_key` (các item cùng key → một sản phẩm mới).

    item: external_id, type, network, days, price, title?, category_id?,
          type_label?, network_label?, status?, description?, product_id?, group_key?
    """
    from src.products.service import create_product, update_product_operations

    _require_proxy(provider)
    # Thêm vào sản phẩm có sẵn thì chủ sở hữu là seller của sản phẩm đó —
    # chỉ sản phẩm MỚI mới cần nguồn đã giao seller (hoặc admin chỉ định).
    needs_owner = any(not spec.get("product_id") for spec in items)
    seller_id = _owner_seller_id(provider, scope, owner_seller_id) if needs_owner else None
    if provider.review_status != "approved":
        raise api_error(ErrorCode.PROVIDER_NOT_APPROVED, status.HTTP_400_BAD_REQUEST)
    catalog = await _catalog_by_id(provider.id, db)
    min_margin = _min_margin_pct(provider)
    created: list[dict] = []
    new_products: dict[str, Product] = {}
    touched: dict[int, Product] = {}
    plan_ids_patch: dict[str, str] = {}

    for spec in items:
        item = catalog.get(str(spec["external_id"]))
        if item is None:
            raise api_error(ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND,
                            detail=f"Gói {spec['external_id']} không có trong catalog đã đồng bộ — bấm Đồng bộ ngay")
        proxy_type, network, days = _validate_item(provider, item, spec)
        key = _plan_key(proxy_type, network, days)
        cost = cost_for(provider, item, proxy_type, network, days)
        price = int(spec.get("price") or (suggest_price(cost, max(min_margin, 30)) if cost else 0))
        if price <= 0:
            raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST, detail=f"Gói {key}: cần giá bán > 0")

        product: Product | None = None
        if spec.get("product_id"):
            product = touched.get(int(spec["product_id"])) or await db.get(Product, int(spec["product_id"]))
            if product is None or (not scope.is_admin and product.seller_id != scope.seller_id):
                raise api_error(ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
            if product.provider_id not in (None, provider.id):
                raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST, detail="Sản phẩm đang dùng nguồn khác")
        elif spec.get("group_key") and spec["group_key"] in new_products:
            product = new_products[spec["group_key"]]
        if product is None:
            category = await db.get(Category, int(spec.get("category_id") or 0))
            if category is None:
                raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                                detail="Cần chọn danh mục cho sản phẩm mới")
            product = await create_product(seller_id, {
                "category_id": category.id,
                "title": (spec.get("title") or item.name).strip()[:255],
                "description": spec.get("description") or "Giao ngay sau thanh toán. Quản lý, đổi IP và gia hạn tại Proxy của tôi.",
                "escrow_days": int(spec.get("escrow_days") or 1),
                "status": ProductStatus(spec.get("status") or "draft"),
                "service_type": "proxy", "provider_id": provider.id, "pricing_strategy": "config",
            }, db)
            if spec.get("group_key"):
                new_products[spec["group_key"]] = product
        touched[product.id] = product

        params = dict(product.pricing_params or {})
        prices, from_formula = effective_prices(params)
        prices = dict(prices)
        if from_formula:
            for k in ("base_price", "type_mult", "network_mult", "duration_options"):
                params.pop(k, None)
        prices[key] = price
        params["plan_prices"] = prices
        params.setdefault("type_display", {})
        params.setdefault("network_display", {})
        if spec.get("type_label"):
            params["type_display"][proxy_type] = str(spec["type_label"])[:80]
        if spec.get("network_label"):
            params["network_display"][network] = str(spec["network_label"])[:80]
        elif network == XOAY_NETWORK:
            params["network_display"].setdefault(network, "Key xoay")
        product.pricing_params = params      # ghi tạm; update_product_operations validate lại ở dưới
        if provider.adapter_type == "dproxy":
            plan_ids_patch[key] = item.external_id
        created.append({
            "product_id": product.id, "product_title": product.title, "public_key": product.public_key,
            "plan_key": key, "price": price, "cost_price": cost,
            "margin_ok": margin_ok(price, cost, min_margin) if cost else True,
        })

    if plan_ids_patch:
        # DProxy: ma trận plan là của PROVIDER — ghi trước để validate sản phẩm đi qua.
        config = dict(provider.config or {})
        plan_ids = dict(config.get("plan_ids") or {})
        plan_ids.update(plan_ids_patch)
        config["plan_ids"] = plan_ids
        config.pop("plan_id", None)
        provider.config = config
        await db.flush()
    for product in touched.values():
        await update_product_operations(product.id, {
            "provider_id": provider.id, "pricing_strategy": "config", "pricing_params": product.pricing_params,
        }, db)
    await db.commit()
    return created


# ----------------------------------------------------------------------
# Sửa giá / gỡ một gói
# ----------------------------------------------------------------------

async def _scoped_product(provider: Provider, scope: SourceScope, product_id: int, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if product is None or product.provider_id != provider.id or (not scope.is_admin and product.seller_id != scope.seller_id):
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return product


async def update_offer(provider: Provider, scope: SourceScope, product_id: int, plan_key: str, db: AsyncSession, *, price: int) -> dict:
    from src.products.service import update_product_operations

    _require_proxy(provider)
    product = await _scoped_product(provider, scope, product_id, db)
    params = dict(product.pricing_params or {})
    prices, from_formula = effective_prices(params)
    prices = dict(prices)
    if plan_key not in prices:
        raise api_error(ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND, detail="Gói không có trong sản phẩm")
    if from_formula:
        # Chốt bảng giá hiện hành rồi mới sửa: buyer form chuyển từ ma trận tự do sang chọn gói.
        for k in ("base_price", "type_mult", "network_mult", "duration_options"):
            params.pop(k, None)
    if price <= 0:
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST, detail="Giá bán phải > 0")
    prices[plan_key] = int(price)
    params["plan_prices"] = prices
    await update_product_operations(product.id, {"pricing_params": params}, db)
    await db.commit()
    catalog = await _catalog_by_id(provider.id, db)
    rows = _offer_rows(provider, product, catalog, _min_margin_pct(provider))
    return next(r for r in rows if r["plan_key"] == plan_key)


async def remove_offer(provider: Provider, scope: SourceScope, product_id: int, plan_key: str, db: AsyncSession) -> None:
    """Gỡ một gói khỏi sản phẩm. Gỡ gói cuối cùng → sản phẩm về nháp (không
    còn gì để bán) thay vì để một sản phẩm `config` không có bảng giá."""
    from src.products.service import update_product_operations

    _require_proxy(provider)
    product = await _scoped_product(provider, scope, product_id, db)
    params = dict(product.pricing_params or {})
    prices, from_formula = effective_prices(params)
    prices = dict(prices)
    if from_formula:
        for k in ("base_price", "type_mult", "network_mult", "duration_options"):
            params.pop(k, None)
    prices.pop(plan_key, None)
    params["plan_prices"] = prices
    if prices:
        await update_product_operations(product.id, {"pricing_params": params}, db)
    else:
        product.pricing_params = params
        product.status = ProductStatus.draft
    await db.commit()


async def reprice_offers(provider: Provider, scope: SourceScope, db: AsyncSession, *, margin_pct: float, round_to: int = 1000) -> dict:
    """Đặt lại giá mọi gói của nguồn = vốn × (1 + margin)."""
    from src.products.service import update_product_operations

    _require_proxy(provider)
    catalog = await _catalog_by_id(provider.id, db)
    stmt = select(Product).where(Product.provider_id == provider.id, Product.pricing_strategy == "config")
    if not scope.is_admin:
        stmt = stmt.where(Product.seller_id == scope.seller_id)
    updated = skipped = 0
    for product in (await db.execute(stmt)).scalars().all():
        params = dict(product.pricing_params or {})
        prices, from_formula = effective_prices(params)
        prices = dict(prices)
        if from_formula:
            for k in ("base_price", "type_mult", "network_mult", "duration_options"):
                params.pop(k, None)
        changed = False
        for key in list(prices):
            parsed = parse_plan_price_key(key)
            if parsed is None:
                continue
            ext = catalog_external_id(provider, *parsed)
            cost = cost_for(provider, catalog.get(ext) if ext else None, *parsed)
            if not cost:
                skipped += 1
                continue
            prices[key] = suggest_price(cost, margin_pct, round_to)
            changed = True
            updated += 1
        if changed:
            params["plan_prices"] = prices
            await update_product_operations(product.id, {"pricing_params": params}, db)
    await db.commit()
    return {"updated": updated, "skipped": skipped}
