"""Quản lý NGUỒN HÀNG cho seller/admin — mọi provider `external_stock`.

Một "nguồn hàng" = một Provider catalog (igbm hôm nay, shop khác ngày mai)
được GIAO cho một seller (`Provider.seller_id`). Seller thấy nguồn của mình
ở /seller/sources; admin thấy mọi nguồn ở /admin/sources. Cùng một bộ hàm,
khác nhau ở `SourceScope`:

- duyệt catalog đã đồng bộ (tìm không dấu, lọc nhóm/tồn/giá vốn),
- nhập SKU → sản phẩm + gói + mapping (giá bán gợi ý theo margin),
- gắn SKU vào gói có sẵn, đổi SKU, gỡ,
- bảng gói đã gắn (vốn / giá / margin / tồn / sync), sửa giá, áp margin hàng loạt.

Không gọi thượng nguồn ở đây trừ "đồng bộ ngay" — mọi số liệu lấy từ
snapshot `supplier_catalog_items` + cache `supplier_listings`.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.registry import get_spec
from src.exceptions import ErrorCode, api_error
from src.models.account import Account
from src.models.category import Category
from src.models.order import Order, OrderStatus
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.provider import Provider
from src.models.supplier_listing import SupplierCatalogItem, SupplierListing, SupplierPurchase
from src.suppliers.service import (
    DEFAULT_MIN_MARGIN_PCT,
    DEFAULT_ROUND_TO,
    _min_margin_pct,
    apply_upstream,
    attach_listing,
    fold_text,
    margin_ok,
    price_rule,
    suggest_price,
    sync_provider_listings,
)


@dataclass(frozen=True)
class SourceScope:
    """seller_id=None → admin (mọi nguồn, mọi seller)."""

    seller_id: int | None

    @property
    def is_admin(self) -> bool:
        return self.seller_id is None


def _not_found():
    return api_error(ErrorCode.PROVIDER_NOT_CONFIGURED, status.HTTP_404_NOT_FOUND, detail="Không tìm thấy nguồn hàng")


async def get_source(provider_id: int, scope: SourceScope, db: AsyncSession) -> Provider:
    provider = await db.get(Provider, provider_id)
    spec = get_spec(provider.adapter_type) if provider else None
    if provider is None or spec is None or not spec.external_stock:
        raise _not_found()
    if not scope.is_admin and provider.seller_id != scope.seller_id:
        raise _not_found()
    return provider


def _owner_seller_id(provider: Provider, scope: SourceScope, requested: int | None) -> int:
    """Seller sở hữu sản phẩm nhập từ nguồn này. Seller: chính mình. Admin:
    seller được giao nguồn, hoặc seller chỉ định."""
    if not scope.is_admin:
        return scope.seller_id
    owner = requested or provider.seller_id
    if owner is None:
        raise api_error(
            ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
            detail="Nguồn chưa giao cho seller nào — chọn seller sở hữu sản phẩm",
        )
    return owner


# ----------------------------------------------------------------------
# Danh sách nguồn
# ----------------------------------------------------------------------

SOURCE_KINDS: dict[str, dict] = {
    # Các loại nguồn admin thêm được từ wizard "Thêm nguồn". Thêm nhà cung cấp
    # mới = thêm adapter + một dòng ở đây (label, mô tả, ô config cần điền).
    "igbm": {
        "label": "Acc Station (igbm.net)", "kind": "catalog",
        "description": "Kho tài khoản & key, hàng nghìn SKU. Mua theo từng đơn, giao ngay.",
        # Wizard chỉ hỏi kết nối; luật giá + ngưỡng an toàn lấy CATALOG_DEFAULTS,
        # sửa sau ở tab Cài đặt của nguồn.
        "fields": [
            {"key": "api_key", "label": "API key", "secret": True,
             "hint": "Lấy ở igbm.net → Tài liệu API."},
            {"key": "base_url", "label": "Máy chủ API", "default": "https://igbm.net", "advanced": True},
        ],
    },
    "topproxy": {
        "label": "TopProxy", "kind": "server",
        "description": "Server proxy datacenter, cấp IP theo gói và thời hạn.",
        "fields": [
            {"key": "base_url", "label": "Base URL"},
            {"key": "api_key", "label": "API key", "secret": True},
        ],
    },
    "dproxy": {
        "label": "DProxy", "kind": "server",
        "description": "Proxy dân cư xoay, mua theo loại / mạng / số ngày.",
        "fields": [
            {"key": "base_url", "label": "Base URL"},
            {"key": "api_key", "label": "API key", "secret": True},
        ],
    },
}


# Cấu hình mặc định cho nguồn catalog mới tạo từ wizard. Nguồn cũ không có
# follow_cost → giữ hành vi cũ (không tự đổi giá) cho tới khi admin bật.
CATALOG_DEFAULTS: dict = {
    "markup_pct": 30, "round_to": DEFAULT_ROUND_TO, "follow_cost": True,
    "min_margin_pct": int(DEFAULT_MIN_MARGIN_PCT), "auto_pause_after_failures": 3, "low_balance_vnd": 200_000,
}

# Khoá cấu hình seller nội bộ được sửa (luật giá + ngưỡng). Kết nối, tên,
# bật/tắt, seller sở hữu: chỉ admin.
SELLER_SETTING_KEYS = ("markup_pct", "round_to", "follow_cost", "min_margin_pct",
                       "auto_pause_after_failures", "low_balance_vnd")
ADMIN_SETTING_KEYS = ("name", "base_url", "api_key", "is_active", "seller_id")


def source_kind(adapter_type: str) -> str:
    spec = get_spec(adapter_type)
    if spec is not None and spec.external_stock:
        return "catalog"
    return SOURCE_KINDS.get(adapter_type, {}).get("kind", "server")


def list_source_kinds() -> list[dict]:
    return [{"adapter_type": k, **v} for k, v in SOURCE_KINDS.items()]


async def list_sources(scope: SourceScope, db: AsyncSession) -> list[dict]:
    """Nguồn = provider catalog (external_stock) hoặc provider đã giao cho
    seller (server proxy…). Seller chỉ thấy nguồn giao cho mình."""
    stmt = select(Provider).order_by(Provider.id)
    if not scope.is_admin:
        stmt = stmt.where(Provider.seller_id == scope.seller_id)
    providers = [
        p for p in (await db.execute(stmt)).scalars()
        if get_spec(p.adapter_type) is not None
        and (get_spec(p.adapter_type).external_stock or p.seller_id is not None)
    ]
    if not providers:
        return []
    ids = [p.id for p in providers]
    catalog_counts = dict((await db.execute(
        select(SupplierCatalogItem.provider_id, func.count(SupplierCatalogItem.id))
        .where(SupplierCatalogItem.provider_id.in_(ids)).group_by(SupplierCatalogItem.provider_id)
    )).all())
    catalog_synced = dict((await db.execute(
        select(SupplierCatalogItem.provider_id, func.max(SupplierCatalogItem.synced_at))
        .where(SupplierCatalogItem.provider_id.in_(ids)).group_by(SupplierCatalogItem.provider_id)
    )).all())
    listing_stmt = (
        select(SupplierListing.provider_id, SupplierListing.sync_error, SupplierListing.cost_price,
               ProductVariant.price, Product.id, SupplierListing.auto_paused_at, ProductVariant.is_active)
        .join(ProductVariant, ProductVariant.id == SupplierListing.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(SupplierListing.provider_id.in_(ids))
    )
    if not scope.is_admin:
        listing_stmt = listing_stmt.where(Product.seller_id == scope.seller_id)
    listing_rows = (await db.execute(listing_stmt)).all()
    product_stmt = (
        select(Product.provider_id, func.count(Product.id))
        .where(Product.provider_id.in_(ids))
    )
    if not scope.is_admin:
        product_stmt = product_stmt.where(Product.seller_id == scope.seller_id)
    product_counts = dict((await db.execute(product_stmt.group_by(Product.provider_id))).all())
    sellers: dict[int, Account] = {}
    seller_ids = {p.seller_id for p in providers if p.seller_id}
    if seller_ids:
        sellers = {a.id: a for a in (await db.execute(
            select(Account).where(Account.id.in_(seller_ids))
        )).scalars()}
    stats = await _purchase_stats(ids, scope, db, days=7)
    names = await _business_names(list(seller_ids), db)
    out = []
    for p in providers:
        min_margin = _min_margin_pct(p)
        rule = price_rule(p)
        mine = [r for r in listing_rows if r[0] == p.id]
        # sync_error "delisted" = nguồn gỡ SKU (chặn bán); chuỗi khác = lần
        # đồng bộ gần nhất lỗi (giữ cache cũ, vẫn bán) → báo ở cấp nguồn.
        n_err = sum(1 for r in mine if r[1] == "delisted")
        n_low = sum(1 for r in mine if r[1] != "delisted" and r[5] is None and r[6] and not margin_ok(r[3], r[2], min_margin))
        n_paused = sum(1 for r in mine if r[5] is not None)
        sync_error = next((r[1] for r in mine if r[1] and r[1] != "delisted"), None)
        seller = sellers.get(p.seller_id)
        out.append({
            "id": p.id, "name": p.name, "adapter_type": p.adapter_type,
            "kind": source_kind(p.adapter_type),
            "is_active": p.is_active, "review_status": p.review_status,
            "seller_id": p.seller_id, "seller_email": seller.email if seller else None,
            "seller_is_internal": bool(seller.is_internal) if seller else False,
            "seller_business_name": names.get(p.seller_id) if p.seller_id else None,
            "min_margin_pct": min_margin,
            "markup_pct": rule.markup_pct, "round_to": rule.round_to, "follow_cost": rule.follow_cost,
            "balance_vnd": _balance_of(p),
            "active_listing_count": sum(
                1 for r in mine if r[1] != "delisted" and r[5] is None and r[6] and margin_ok(r[3], r[2], min_margin)
            ),
            "sync_error": sync_error,
            "stats_7d": stats.get(p.id, _empty_stats()),
            "low_balance_vnd": (p.config or {}).get("low_balance_vnd"),
            "catalog_count": int(catalog_counts.get(p.id, 0)),
            "catalog_synced_at": catalog_synced.get(p.id),
            "listing_count": len(mine), "listing_error_count": n_err,
            "listing_low_margin_count": n_low,
            "listing_auto_paused_count": n_paused,
            "product_count": int(product_counts.get(p.id, 0)),
            "attention_count": n_err + n_low + n_paused,
            "last_test_result": p.last_test_result,
            "last_tested_at": p.last_tested_at,
        })
    return out


# ----------------------------------------------------------------------
# Duyệt catalog
# ----------------------------------------------------------------------

async def browse_catalog(
    provider: Provider, scope: SourceScope, db: AsyncSession, *,
    q: str = "", group: str = "", in_stock: bool = True, max_cost: int | None = None,
    page: int = 1, per_page: int = 50, sort: str = "stock",
) -> dict:
    base = select(SupplierCatalogItem).where(SupplierCatalogItem.provider_id == provider.id)
    if in_stock:
        base = base.where(SupplierCatalogItem.amount > 0)
    if group:
        base = base.where(SupplierCatalogItem.group_name == group)
    if max_cost is not None:
        base = base.where(SupplierCatalogItem.cost_price <= max_cost)
    for term in fold_text(q).split():
        base = base.where(SupplierCatalogItem.name_norm.contains(term))
    if q.strip().isdigit():
        base = select(SupplierCatalogItem).where(
            SupplierCatalogItem.provider_id == provider.id,
            SupplierCatalogItem.external_id == q.strip(),
        )

    order = {
        "stock": SupplierCatalogItem.amount.desc(),
        "cost_asc": SupplierCatalogItem.cost_price.asc(),
        "cost_desc": SupplierCatalogItem.cost_price.desc(),
        "name": SupplierCatalogItem.name.asc(),
    }.get(sort, SupplierCatalogItem.amount.desc())
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    per_page = max(1, min(per_page, 200))
    page = max(1, page)
    items = list((await db.execute(
        base.order_by(order, SupplierCatalogItem.id).offset((page - 1) * per_page).limit(per_page)
    )).scalars())

    # Nhóm gốc + số SKU còn hàng — cho sidebar lọc.
    groups = [
        {"name": g, "count": int(n)} for g, n in (await db.execute(
            select(SupplierCatalogItem.group_name, func.count(SupplierCatalogItem.id))
            .where(SupplierCatalogItem.provider_id == provider.id, SupplierCatalogItem.amount > 0)
            .group_by(SupplierCatalogItem.group_name)
            .order_by(func.count(SupplierCatalogItem.id).desc())
        )).all()
    ]

    # SKU nào đã gắn gói (trong phạm vi seller) — để UI đánh dấu "đã nhập".
    attached: dict[str, list[dict]] = {}
    if items:
        ext_ids = [it.external_id for it in items]
        stmt = (
            select(SupplierListing.external_product_id, ProductVariant.id, ProductVariant.name,
                   ProductVariant.price, Product.id, Product.title)
            .join(ProductVariant, ProductVariant.id == SupplierListing.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(SupplierListing.provider_id == provider.id,
                   SupplierListing.external_product_id.in_(ext_ids))
        )
        if not scope.is_admin:
            stmt = stmt.where(Product.seller_id == scope.seller_id)
        for ext, vid, vname, vprice, pid, ptitle in (await db.execute(stmt)).all():
            attached.setdefault(ext, []).append({
                "variant_id": vid, "variant_name": vname, "price": vprice,
                "product_id": pid, "product_title": ptitle,
            })

    min_margin = _min_margin_pct(provider)
    return {
        "items": [{
            "external_id": it.external_id, "name": it.name, "cost_price": it.cost_price,
            "amount": it.amount, "min_qty": it.min_qty, "max_qty": it.max_qty,
            "format_hint": it.format_hint, "group_name": it.group_name,
            "category_path": it.category_path, "synced_at": it.synced_at,
            "attached": attached.get(it.external_id, []),
        } for it in items],
        "total": int(total), "page": page, "per_page": per_page,
        "groups": groups, "min_margin_pct": min_margin,
    }


# ----------------------------------------------------------------------
# Nhập / gắn / sửa / gỡ
# ----------------------------------------------------------------------

def guess_service_type(category_path: list[str] | tuple[str, ...]) -> str:
    text = fold_text(" ".join(category_path))
    if any(k in text for k in ("proxy", "vpn", "ipv4", "ipv6", "socks")):
        return "proxy"
    if any(k in text for k in ("key", "license", "canva", "capcut", "steam", "kaspersky", "netflix")):
        return "token"
    return "account"


async def _catalog_item(provider_id: int, external_id: str, db: AsyncSession) -> SupplierCatalogItem:
    item = await db.scalar(select(SupplierCatalogItem).where(
        SupplierCatalogItem.provider_id == provider_id, SupplierCatalogItem.external_id == external_id,
    ))
    if item is None:
        raise api_error(
            ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND,
            detail=f"SKU {external_id} không có trong catalog đã đồng bộ — bấm Đồng bộ ngay",
        )
    return item


def _upstream_from_item(item: SupplierCatalogItem):
    from src.adapters.supplier import UpstreamListing

    return UpstreamListing(
        external_id=item.external_id, name=item.name, cost_price=item.cost_price,
        amount=item.amount, min_qty=item.min_qty, max_qty=item.max_qty,
        format_hint=item.format_hint, category_path=tuple(item.category_path or ()),
    )


async def import_items(
    provider: Provider, scope: SourceScope, items: list[dict], db: AsyncSession, *,
    owner_seller_id: int | None = None,
) -> list[dict]:
    """Nhập SKU thành sản phẩm. Mỗi item = một PHÂN LOẠI (gói) nối tới một SKU.

    Gộp nhiều SKU vào một sản phẩm bằng một trong hai cách:
    - `product_id`: thêm phân loại vào sản phẩm có sẵn (cùng seller);
    - `group_key`: các item cùng key → một sản phẩm mới; item đầu tiên của
      nhóm cho tên/danh mục/mô tả sản phẩm.
    Không có cả hai → mỗi item một sản phẩm riêng (như trước).

    item: external_id, category_id, title, variant_name, price, status
          ("draft"|"active"), description?, warranty_text?, service_type?,
          product_id?, group_key?
    """
    from src.products.service import create_product, create_variant

    seller_id = _owner_seller_id(provider, scope, owner_seller_id)
    if provider.review_status != "approved":
        raise api_error(ErrorCode.PROVIDER_NOT_APPROVED, status.HTTP_400_BAD_REQUEST)
    min_margin = _min_margin_pct(provider)
    rule = price_rule(provider)
    created: list[dict] = []
    new_products: dict[str, Product] = {}   # group_key → product vừa tạo
    for spec in items:
        item = await _catalog_item(provider.id, str(spec["external_id"]), db)
        rule_price = suggest_price(item.cost_price, rule.markup_pct, rule.round_to)
        price = int(spec.get("price") or rule_price)
        product: Product | None = None
        if spec.get("product_id"):
            product = await db.get(Product, int(spec["product_id"]))
            if product is None or product.seller_id != seller_id:
                raise api_error(ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
            if product.provider_id not in (None, provider.id):
                raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                                detail="Sản phẩm đang dùng nguồn khác")
            product.provider_id = provider.id
            product.pricing_strategy = "fixed"
        elif spec.get("group_key") and spec["group_key"] in new_products:
            product = new_products[spec["group_key"]]
        if product is None:
            category = await db.get(Category, int(spec["category_id"]))
            if category is None:
                raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                                detail=f"Danh mục #{spec['category_id']} không tồn tại")
            title = (spec.get("title") or item.name).strip()[:255]
            product = await create_product(seller_id, {
                "category_id": category.id, "title": title,
                "description": spec.get("description") or (
                    f"Giao ngay sau thanh toán.\n\nĐịnh dạng: {item.format_hint}" if item.format_hint else None
                ),
                "warranty_text": spec.get("warranty_text"),
                "escrow_days": int(spec.get("escrow_days") or 1),
                "status": ProductStatus(spec.get("status") or "draft"),
                "service_type": spec.get("service_type") or guess_service_type(item.category_path or []),
                "provider_id": provider.id, "pricing_strategy": "fixed",
            }, db)
            if spec.get("group_key"):
                new_products[spec["group_key"]] = product
        variant = await create_variant(product.id, seller_id, {
            "name": (spec.get("variant_name") or item.name or "1 tài khoản").strip()[:255],
            "price": price, "delivery_mode": DeliveryMode.instant.value,
        }, db)
        listing = await attach_listing(
            db, provider_id=provider.id, variant_id=variant.id, external_product_id=item.external_id,
            upstream=_upstream_from_item(item), external_name=item.name,
        )
        # Giá khác luật lúc nhập = seller cố ý đặt giá riêng.
        listing.price_manual = price != rule_price
        await db.commit()
        created.append({
            "product_id": product.id, "product_title": product.title, "public_key": product.public_key,
            "variant_id": variant.id, "variant_name": variant.name, "price": price, "listing_id": listing.id,
            "margin_ok": margin_ok(price, item.cost_price, min_margin),
        })
    return created


async def _scoped_variant(variant_id: int, scope: SourceScope, db: AsyncSession) -> tuple[ProductVariant, Product]:
    variant = await db.get(ProductVariant, variant_id)
    product = await db.get(Product, variant.product_id) if variant else None
    if variant is None or product is None or (not scope.is_admin and product.seller_id != scope.seller_id):
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return variant, product


async def attach_existing_variant(
    provider: Provider, scope: SourceScope, variant_id: int, external_id: str, db: AsyncSession,
) -> SupplierListing:
    """Gắn SKU vào gói có sẵn: sản phẩm chuyển sang provider này + fixed. Kho
    Resource cũ (nếu có) vẫn cộng vào tồn bán được."""
    variant, product = await _scoped_variant(variant_id, scope, db)
    if provider.seller_id is not None and provider.seller_id != product.seller_id:
        raise api_error(ErrorCode.PROVIDER_NOT_OWNED, status.HTTP_400_BAD_REQUEST)
    item = await _catalog_item(provider.id, external_id, db)
    product.provider_id = provider.id
    product.pricing_strategy = "fixed"
    listing = await attach_listing(
        db, provider_id=provider.id, variant_id=variant.id, external_product_id=item.external_id,
        upstream=_upstream_from_item(item), external_name=item.name,
    )
    await db.commit()
    return listing


async def _scoped_listing(listing_id: int, scope: SourceScope, db: AsyncSession) -> tuple[SupplierListing, ProductVariant, Product]:
    listing = await db.get(SupplierListing, listing_id)
    if listing is None:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    variant, product = await _scoped_variant(listing.variant_id, scope, db)
    return listing, variant, product


async def update_listing(
    listing_id: int, scope: SourceScope, db: AsyncSession, *,
    price: int | None = None, variant_name: str | None = None, external_id: str | None = None,
    is_active: bool | None = None, product_id: int | None = None, price_manual: bool | None = None,
) -> dict:
    """`price` → giá đặt tay (luật giá không ghi đè nữa). `price_manual=False`
    → trả phân loại về luật giá: đặt ngay giá theo luật."""
    listing, variant, product = await _scoped_listing(listing_id, scope, db)
    provider = await db.get(Provider, listing.provider_id)
    if product_id is not None and product_id != product.id:
        # Chuyển phân loại sang sản phẩm khác của cùng seller, cùng nguồn.
        target = await db.get(Product, int(product_id))
        if target is None or target.seller_id != product.seller_id:
            raise api_error(ErrorCode.PRODUCT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
        if target.provider_id not in (None, listing.provider_id):
            raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                            detail="Sản phẩm đích đang dùng nguồn khác")
        target.provider_id = listing.provider_id
        target.pricing_strategy = "fixed"
        variant.product_id = target.id
        product = target
    if price is not None:
        if price < 0:
            raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST)
        if int(price) != variant.price:
            variant.price = int(price)
            listing.price_manual = True
    if variant_name is not None and variant_name.strip():
        variant.name = variant_name.strip()[:255]
    if is_active is not None:
        variant.is_active = bool(is_active)
        if is_active:
            # Seller bật lại sau khi cầu dao tắt gói → cho cơ hội mới.
            listing.fail_streak = 0
            listing.auto_paused_at = None
    if external_id is not None and external_id != listing.external_product_id:
        item = await _catalog_item(listing.provider_id, external_id, db)
        listing.external_product_id = item.external_id
        listing.external_name = item.name
        apply_upstream(listing, _upstream_from_item(item))
    if price_manual is False:
        rule = price_rule(provider)
        listing.price_manual = False
        if listing.cost_price > 0:
            variant.price = suggest_price(listing.cost_price, rule.markup_pct, rule.round_to)
    elif price_manual is True:
        listing.price_manual = True
    await db.commit()
    return _listing_row(listing, variant, product, _min_margin_pct(provider), price_rule(provider))


async def detach_listing(listing_id: int, scope: SourceScope, db: AsyncSession) -> None:
    """Gỡ mapping: gói ở lại nhưng hết tồn (trừ khi có Resource kho riêng)."""
    listing, _variant, _product = await _scoped_listing(listing_id, scope, db)
    await db.delete(listing)
    await db.commit()


def _listing_row(
    listing: SupplierListing, variant: ProductVariant, product: Product, min_margin: float, rule=None,
) -> dict:
    cost = listing.cost_price
    margin_pct = round((variant.price - cost) / cost * 100, 1) if cost > 0 else None
    path = (listing.extra or {}).get("category_path", [])
    return {
        "listing_id": listing.id, "provider_id": listing.provider_id,
        "product_id": product.id, "product_title": product.title, "product_status": product.status.value,
        "public_key": product.public_key, "seller_id": product.seller_id,
        "variant_id": variant.id, "variant_public_key": variant.public_key,
        "variant_name": variant.name, "variant_active": variant.is_active, "price": variant.price,
        "external_id": listing.external_product_id, "external_name": listing.external_name,
        "cost_price": cost, "margin_pct": margin_pct,
        "margin_ok": margin_ok(variant.price, cost, min_margin),
        "upstream_amount": listing.upstream_amount, "sellable": listing.sellable_units(),
        "upstream_min": listing.upstream_min, "upstream_max": listing.upstream_max,
        "format_hint": listing.format_hint, "synced_at": listing.synced_at, "sync_error": listing.sync_error,
        "fail_streak": listing.fail_streak or 0, "last_fail_at": listing.last_fail_at,
        "last_fail_reason": listing.last_fail_reason, "auto_paused_at": listing.auto_paused_at,
        "category_path": path,
        "group_name": path[0] if path else "",
        "price_manual": bool(listing.price_manual),
        "rule_price": suggest_price(cost, rule.markup_pct, rule.round_to) if rule is not None and cost > 0 else None,
    }


async def list_listings(provider: Provider, scope: SourceScope, db: AsyncSession) -> list[dict]:
    stmt = (
        select(SupplierListing, ProductVariant, Product)
        .join(ProductVariant, ProductVariant.id == SupplierListing.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(SupplierListing.provider_id == provider.id)
        .order_by(Product.id.desc(), ProductVariant.sort_order, ProductVariant.id)  # nhóm theo sản phẩm
    )
    if not scope.is_admin:
        stmt = stmt.where(Product.seller_id == scope.seller_id)
    min_margin = _min_margin_pct(provider)
    rule = price_rule(provider)
    return [_listing_row(lst, v, p, min_margin, rule) for lst, v, p in (await db.execute(stmt)).all()]


async def reprice_listings(
    provider: Provider, scope: SourceScope, db: AsyncSession, *,
    margin_pct: float | None = None, round_to: int | None = None, listing_ids: list[int] | None = None,
    only_below_min: bool = False, dry_run: bool = False, include_manual: bool = False,
) -> dict:
    """Áp giá bán = vốn × (1+margin) cho nhiều phân loại một lượt. Không
    truyền margin/round_to → dùng luật giá của nguồn.

    - `only_below_min`: chỉ sửa phân loại đang dưới ngưỡng lãi (bị chặn bán).
    - Phân loại "đặt tay" được giữ nguyên (trả về ở `skipped_manual`) trừ khi
      `include_manual` hoặc được chỉ định đích danh qua `listing_ids`.
    - `dry_run`: chỉ trả về danh sách thay đổi để UI hiện xem trước."""
    rule = price_rule(provider)
    pct = rule.markup_pct if margin_pct is None else margin_pct
    step = rule.round_to if round_to is None else round_to
    rows = await list_listings(provider, scope, db)
    min_margin = _min_margin_pct(provider)
    changed, skipped_manual = [], []
    unchanged = 0
    for row in rows:
        if listing_ids is not None and row["listing_id"] not in listing_ids:
            continue
        if only_below_min and row["margin_ok"]:
            continue
        if row["cost_price"] <= 0 or row["sync_error"] == "delisted":
            continue
        if row["price_manual"] and not include_manual and listing_ids is None:
            skipped_manual.append({"listing_id": row["listing_id"], "product_title": row["product_title"],
                                   "variant_name": row["variant_name"], "price": row["price"],
                                   "margin_ok": row["margin_ok"]})
            continue
        new_price = suggest_price(row["cost_price"], pct, step)
        if new_price == row["price"]:
            unchanged += 1
            continue
        changed.append({"listing_id": row["listing_id"], "variant_id": row["variant_id"],
                        "product_title": row["product_title"], "variant_name": row["variant_name"],
                        "cost_price": row["cost_price"], "old_price": row["price"], "new_price": new_price})
        if dry_run:
            continue
        variant = await db.get(ProductVariant, row["variant_id"])
        variant.price = new_price
        if listing_ids is not None:
            listing = await db.get(SupplierListing, row["listing_id"])
            listing.price_manual = False
    if not dry_run:
        await db.commit()
    return {"changed": changed, "unchanged": unchanged, "skipped_manual": skipped_manual,
            "margin_pct": pct, "round_to": step, "min_margin_pct": min_margin, "dry_run": dry_run}


async def sync_now(provider: Provider, db: AsyncSession) -> dict:
    report = await sync_provider_listings(provider, db)
    await db.commit()
    return {
        "provider_id": report.provider_id, "updated": report.updated, "delisted": report.delisted,
        "low_margin": report.low_margin, "repriced": report.repriced,
        "catalog_items": report.catalog_items, "error": report.error,
    }


# ----------------------------------------------------------------------
# Wizard "Thêm nguồn" (admin): kiểm tra config → tạo provider → giao seller
# ----------------------------------------------------------------------

async def test_source_config(adapter_type: str, config: dict, db: AsyncSession) -> dict:
    """Chạy check_health với config CHƯA lưu — admin thấy số dư trước khi bấm
    Tiếp tục. Không tạo provider, không tốn tiền."""
    spec = get_spec(adapter_type)
    if spec is None or adapter_type not in SOURCE_KINDS:
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                        detail="Loại nguồn không hỗ trợ")
    if spec.validate_config is not None:
        await spec.validate_config(config)
    from src.security.crypto import encrypt_config

    # Adapter đọc secret ở dạng đã mã hoá (như khi lấy từ DB) → mã hoá tạm.
    adapter = spec.cls(encrypt_config(dict(config)), db=db, provider_id=None, seller_owned=False)
    health = await adapter.check_health()
    ok = health.get("status") in ("healthy", "warning")
    catalog = None
    if ok and spec.external_stock:
        # Số mặt hàng để admin thấy ngay nguồn có gì (một request đọc catalog).
        try:
            items = await adapter.fetch_catalog()
            catalog = {"total": len(items), "in_stock": sum(1 for it in items if it.amount > 0)}
        except Exception:  # noqa: BLE001 — chỉ là thông tin thêm
            catalog = None
    return {"health": health, "ok": ok, "catalog": catalog}


async def list_seller_candidates(db: AsyncSession) -> list[dict]:
    """Seller để giao nguồn: nội bộ xếp trước."""
    rows = (await db.execute(
        select(Account).where(Account.roles.any("seller"), Account.is_active.is_(True))
        .order_by(Account.is_internal.desc(), Account.id)
    )).scalars().all()
    ids = [a.id for a in rows]
    counts = dict((await db.execute(
        select(Provider.seller_id, func.count(Provider.id))
        .where(Provider.seller_id.in_(ids)).group_by(Provider.seller_id)
    )).all()) if ids else {}
    from src.sellers.service import approved_business_names
    names = await approved_business_names(ids, db)
    return [{
        "id": a.id, "email": a.email, "is_internal": bool(a.is_internal),
        "business_name": names.get(a.id), "source_count": int(counts.get(a.id, 0)),
    } for a in rows]


async def create_internal_seller(email: str, business_name: str, db: AsyncSession, *, actor_id: int | None) -> Account:
    """Tài khoản seller nội bộ mới: role seller, cờ is_internal, tên cửa hàng
    đã duyệt, mật khẩu ngẫu nhiên + email đặt lại mật khẩu."""
    import secrets
    from src.auth.service import register_account, request_password_reset
    from src.exceptions import DuplicateEmail
    from src.models.account import ApplicationStatus, SellerApplication

    try:
        account = await register_account(email.strip().lower(), secrets.token_urlsafe(24), db)
    except DuplicateEmail:
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                        detail="Email đã có tài khoản — chọn từ danh sách thay vì tạo mới")
    account.roles = ["buyer", "seller"]
    account.is_internal = True
    db.add(SellerApplication(
        account_id=account.id, business_name=business_name.strip()[:255],
        description="Seller nội bộ (sàn vận hành)", status=ApplicationStatus.approved,
    ))
    await db.flush()
    await request_password_reset(account.email, "vi", db)
    return account


async def create_source(data: dict, db: AsyncSession, *, actor_id: int | None) -> dict:
    """Một bước cho cả ba việc trước đây phải làm ở ba màn: tạo provider
    (approved, active), giao cho seller (có sẵn hoặc tạo mới, tự bật cờ nội
    bộ), rồi đồng bộ catalog nếu là nguồn catalog.

    data: adapter_type, name, config, seller_id | new_seller{email, business_name}
    """
    from src.providers.service import create_provider

    adapter_type = data["adapter_type"]
    if adapter_type not in SOURCE_KINDS:
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                        detail="Loại nguồn không hỗ trợ")
    seller: Account | None = None
    if data.get("new_seller"):
        ns = data["new_seller"]
        seller = await create_internal_seller(ns["email"], ns["business_name"], db, actor_id=actor_id)
    elif data.get("seller_id"):
        seller = await db.get(Account, int(data["seller_id"]))
        if seller is None or "seller" not in seller.roles:
            raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                            detail="seller_id không phải tài khoản seller")
        if not seller.is_internal:
            seller.is_internal = True
    config = dict(data.get("config") or {})
    if source_kind(adapter_type) == "catalog":
        config = {**CATALOG_DEFAULTS, **config}
    provider = await create_provider({
        "name": data["name"].strip()[:255], "adapter_type": adapter_type,
        "config": config, "is_active": True, "priority": 1,
    }, db, actor_id=actor_id)
    provider.review_status = "approved"
    provider.seller_id = seller.id if seller else None
    await db.commit()
    report = None
    if source_kind(adapter_type) == "catalog":
        report = await sync_provider_listings(provider, db)
        await db.commit()
    return {
        "provider_id": provider.id, "name": provider.name, "adapter_type": adapter_type,
        "kind": source_kind(adapter_type),
        "seller_id": seller.id if seller else None, "seller_email": seller.email if seller else None,
        "catalog_items": report.catalog_items if report else 0,
        "sync_error": report.error if report else None,
    }


# ----------------------------------------------------------------------
# Số liệu phụ cho bảng nguồn
# ----------------------------------------------------------------------

def _balance_of(provider: Provider) -> int | None:
    health = (provider.last_test_result or {}).get("health") or {}
    value = health.get("balance_vnd")
    return int(value) if isinstance(value, (int, float)) else None


async def _business_names(account_ids: list[int], db: AsyncSession) -> dict[int, str]:
    from src.sellers.service import approved_business_names

    return await approved_business_names(account_ids, db) if account_ids else {}


# ----------------------------------------------------------------------
# Đơn mua từ nguồn (tab "Đơn mua")
# ----------------------------------------------------------------------

PURCHASE_WINDOWS = (1, 7, 30)


def _empty_stats() -> dict:
    return {"orders": 0, "ok": 0, "failed": 0, "pending": 0, "units": 0,
            "paid": 0, "cost": 0, "profit": 0, "refunded": 0}


async def _purchase_rows(provider_ids: list[int], scope: SourceScope, db: AsyncSession, *, days: int) -> list[dict]:
    """Mọi đơn của các nguồn trong `days` ngày gần nhất, đã phân loại kết
    quả. Nguồn của đơn = dòng supplier_purchases (đơn từ nay về sau) hoặc
    sản phẩm đang gắn nguồn (đơn cũ, chưa có dòng mua)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    stmt = (
        select(Order, SupplierPurchase, ProductVariant.name, Product.title, Product.provider_id,
               SupplierListing.cost_price)
        .outerjoin(SupplierPurchase, SupplierPurchase.order_id == Order.id)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .outerjoin(Product, Product.id == Order.product_id)
        .outerjoin(SupplierListing, SupplierListing.variant_id == Order.variant_id)
        .where(
            Order.created_at >= since,
            Order.is_seeded.is_(False),
            or_(
                SupplierPurchase.provider_id.in_(provider_ids),
                and_(SupplierPurchase.id.is_(None), Product.provider_id.in_(provider_ids)),
            ),
        )
        .order_by(Order.created_at.desc(), Order.id.desc())
    )
    if not scope.is_admin:
        stmt = stmt.where(Order.seller_id == scope.seller_id)
    out = []
    for order, purchase, variant_name, product_title, product_provider_id, listing_cost in (await db.execute(stmt)).all():
        if purchase is not None:
            result = "ok" if purchase.ok else "failed"
        elif order.status in (OrderStatus.pending, OrderStatus.processing):
            result = "pending"
        elif order.status == OrderStatus.cancelled:
            result = "failed"
        else:
            result = "ok"
        paid = max(order.total_amount - (order.refunded_amount or 0), 0) if result == "ok" else 0
        refunded = order.total_amount if result == "failed" else (order.refunded_amount or 0)
        cost_estimated = False
        cost = 0
        if result == "ok":
            if purchase is not None:
                cost = purchase.cost_total
            elif listing_cost:
                cost, cost_estimated = int(listing_cost) * order.quantity, True
        out.append({
            "provider_id": purchase.provider_id if purchase is not None else product_provider_id,
            "order_id": order.id, "order_code": order.order_code, "created_at": order.created_at,
            "product_title": product_title, "variant_name": variant_name, "quantity": order.quantity,
            "total_amount": order.total_amount, "paid": paid, "refunded": refunded,
            "cost": cost, "cost_estimated": cost_estimated, "profit": paid - cost if result == "ok" else 0,
            "result": result,
            "error": (purchase.error if purchase is not None and not purchase.ok else None)
            or (order.cancel_reason if result == "failed" else None),
            "trans_id": purchase.trans_id if purchase is not None else None,
        })
    return out


def _summarize(rows: list[dict]) -> dict:
    s = _empty_stats()
    for r in rows:
        s["orders"] += 1
        s[r["result"]] += 1
        s["refunded"] += r["refunded"]
        if r["result"] == "ok":
            s["units"] += r["quantity"]
            s["paid"] += r["paid"]
            s["cost"] += r["cost"]
            s["profit"] += r["profit"]
    return s


async def _purchase_stats(provider_ids: list[int], scope: SourceScope, db: AsyncSession, *, days: int) -> dict[int, dict]:
    rows = await _purchase_rows(provider_ids, scope, db, days=days)
    by_provider: dict[int, list[dict]] = {}
    for r in rows:
        by_provider.setdefault(r["provider_id"], []).append(r)
    return {pid: _summarize(rs) for pid, rs in by_provider.items()}


async def list_purchases(
    provider: Provider, scope: SourceScope, db: AsyncSession, *,
    days: int = 1, result: str = "all", q: str = "", page: int = 1, per_page: int = 50,
) -> dict:
    days = days if days in PURCHASE_WINDOWS else 1
    rows = await _purchase_rows([provider.id], scope, db, days=days)
    summary = _summarize(rows)
    counts = {"all": len(rows), "ok": summary["ok"], "failed": summary["failed"], "pending": summary["pending"]}
    if result in ("ok", "failed", "pending"):
        rows = [r for r in rows if r["result"] == result]
    needle = q.strip().lower()
    if needle:
        rows = [r for r in rows if needle in (r["order_code"] or "").lower() or needle in (r["trans_id"] or "").lower()]
    per_page = max(1, min(per_page, 200))
    page = max(1, page)
    items = rows[(page - 1) * per_page: page * per_page]
    for r in items:
        r.pop("provider_id", None)
    return {"summary": summary, "counts": counts, "days": days, "items": items,
            "total": len(rows), "page": page, "per_page": per_page}


# ----------------------------------------------------------------------
# Cài đặt nguồn (tab "Cài đặt")
# ----------------------------------------------------------------------

def _key_hint(provider: Provider) -> str | None:
    from src.security.crypto import decrypt_config

    try:
        key = decrypt_config(provider.config or {}).get("api_key")
    except Exception:  # noqa: BLE001 — key hỏng: chỉ không hiện gợi ý
        return None
    return key[-4:] if isinstance(key, str) and len(key) >= 8 else None


async def get_settings(provider: Provider, scope: SourceScope, db: AsyncSession) -> dict:
    cfg = provider.config or {}
    rule = price_rule(provider)
    seller = await db.get(Account, provider.seller_id) if provider.seller_id else None
    names = await _business_names([seller.id], db) if seller else {}
    out = {
        "id": provider.id, "name": provider.name, "adapter_type": provider.adapter_type,
        "kind": source_kind(provider.adapter_type), "is_active": provider.is_active,
        "markup_pct": rule.markup_pct, "round_to": rule.round_to, "follow_cost": rule.follow_cost,
        "min_margin_pct": _min_margin_pct(provider),
        "auto_pause_after_failures": _int_or(cfg.get("auto_pause_after_failures"), 3),
        "low_balance_vnd": _int_or(cfg.get("low_balance_vnd"), 200_000),
        "balance_vnd": _balance_of(provider),
        "last_test_result": provider.last_test_result, "last_tested_at": provider.last_tested_at,
        "seller": {"id": seller.id, "email": seller.email, "business_name": names.get(seller.id),
                   "is_internal": bool(seller.is_internal)} if seller else None,
        "can_manage_connection": scope.is_admin,
        "base_url": None, "api_key_hint": None,
    }
    if scope.is_admin:
        out["base_url"] = cfg.get("base_url")
        out["api_key_hint"] = _key_hint(provider)
    return out


def _int_or(value, default: int) -> int:
    try:
        return int(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


async def update_settings(
    provider: Provider, scope: SourceScope, data: dict, db: AsyncSession, *, actor_id: int | None,
) -> dict:
    """data: chỉ những khoá client gửi. Seller nội bộ sửa được luật giá +
    ngưỡng; kết nối / tên / bật-tắt / seller sở hữu là việc của admin."""
    from src.providers.service import update_provider

    admin_keys = [k for k in ADMIN_SETTING_KEYS if k in data]
    if admin_keys and not scope.is_admin:
        raise api_error(ErrorCode.NOT_OWNER, status.HTTP_403_FORBIDDEN,
                        detail="Chỉ quản trị viên được đổi kết nối, tên hoặc cửa hàng của nguồn")
    updates: dict = {}
    config = dict(provider.config or {})
    config_changed = False
    for key in SELLER_SETTING_KEYS:
        if key in data and data[key] is not None:
            config[key] = data[key]
            config_changed = True
    if data.get("base_url"):
        config["base_url"] = data["base_url"].strip()
        config_changed = True
    if data.get("api_key"):
        config["api_key"] = data["api_key"].strip()
        config_changed = True
    if config_changed:
        updates["config"] = config
    if data.get("name"):
        updates["name"] = data["name"].strip()[:255]
    if "is_active" in data and data["is_active"] is not None:
        updates["is_active"] = bool(data["is_active"])
    if data.get("seller_id"):
        seller = await db.get(Account, int(data["seller_id"]))
        if seller is None or "seller" not in (seller.roles or []):
            raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST,
                            detail="seller_id không phải tài khoản seller")
        if not seller.is_internal:
            seller.is_internal = True
        updates["seller_id"] = seller.id
    if updates:
        provider = await update_provider(provider.id, updates, db, actor_id=actor_id)
    return await get_settings(provider, scope, db)


async def test_saved_source(provider: Provider, db: AsyncSession) -> dict:
    """Nút "Kiểm tra kết nối" ở tab Cài đặt: đọc số dư bằng config đã lưu."""
    from src.adapters.factory import get_adapter_for_test

    adapter = await get_adapter_for_test(provider.id, db)
    health = await adapter.check_health()
    provider.last_test_result = {"health": health, "provision_test": None, "source": "settings"}
    provider.last_tested_at = datetime.now(timezone.utc)
    await db.commit()
    return {"health": health, "ok": health.get("status") in ("healthy", "warning"),
            "tested_at": provider.last_tested_at}
