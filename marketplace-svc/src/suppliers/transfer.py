"""Chuyển một NGUỒN HÀNG sang cửa hàng khác — kèm các sản phẩm dựng từ nguồn.

Đổi `providers.seller_id` một mình để lại sản phẩm ở shop cũ (nửa vời). Ở đây
một thao tác: nguồn + sản phẩm của nguồn cùng sang shop mới.

Sản phẩm "của nguồn" = `Product.provider_id == nguồn` HOẶC có gói gắn SKU của
nguồn qua `supplier_listings`. Một sản phẩm KHÔNG chuyển (báo lý do) khi chuyển
nó sẽ kéo theo hàng không thuộc nguồn: gói gắn nguồn khác, gói không gắn nguồn
mà có kho riêng, sản phẩm đang thuộc shop thứ ba, hoặc kho chưa bán trùng dòng
shop mới đã có (unique theo shop).

Đi theo sản phẩm (cột seller_id phi chuẩn hoá):
- `products.seller_id`;
- `resources.seller_id` của dòng CHƯA thuộc đơn nào (dòng đã giao giữ shop cũ,
  như `resources.service._verify_resource_ownership`);
- `stock_batches.seller_id` của lô không có dòng nào thuộc đơn.
Gói, listing, giá đi theo sản phẩm qua khoá ngoại. Đơn hàng / ví / sổ cái
KHÔNG bao giờ đổi — đơn cũ vẫn thuộc shop cũ.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import status
from sqlalchemy import exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.exceptions import ErrorCode, api_error
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.provider import Provider
from src.models.resource import Resource
from src.models.stock_batch import StockBatch
from src.models.supplier_listing import SupplierListing

OPEN_ORDER_STATUSES = (OrderStatus.pending, OrderStatus.processing, OrderStatus.delivered, OrderStatus.disputed)

BLOCK_OTHER_SOURCE = "other_source"      # gói gắn nguồn khác / sản phẩm gắn nguồn khác
BLOCK_OWN_STOCK = "own_stock"            # gói không gắn nguồn mà có kho riêng
BLOCK_OTHER_SHOP = "other_shop"          # sản phẩm không thuộc shop đang giữ nguồn
BLOCK_DUPLICATE_STOCK = "duplicate_stock"  # kho chưa bán trùng dòng shop mới đã có


@dataclass
class _Plan:
    old_seller_id: int | None
    movable: list[dict] = field(default_factory=list)
    blocked: list[dict] = field(default_factory=list)
    open_orders: int = 0


def _bad_request(detail: str):
    return api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST, detail=detail)


async def validate_target_seller(new_seller_id: int, db: AsyncSession) -> Account:
    seller = await db.get(Account, int(new_seller_id))
    if seller is None or "seller" not in (seller.roles or []):
        raise _bad_request("Tài khoản được chọn không phải cửa hàng (seller)")
    if not seller.is_active:
        raise _bad_request("Cửa hàng được chọn đang bị khoá")
    if seller.is_seeded:
        raise _bad_request("Cửa hàng được chọn là tài khoản test/seed")
    return seller


async def _plan(provider: Provider, new_seller_id: int, db: AsyncSession) -> _Plan:
    plan = _Plan(old_seller_id=provider.seller_id)
    listed_product_ids = select(ProductVariant.product_id).join(
        SupplierListing, SupplierListing.variant_id == ProductVariant.id,
    ).where(SupplierListing.provider_id == provider.id)
    products = (await db.execute(
        select(Product).where(or_(Product.provider_id == provider.id, Product.id.in_(listed_product_ids)))
        .order_by(Product.id)
    )).scalars().all()
    if not products:
        return plan
    product_ids = [p.id for p in products]
    variant_rows = (await db.execute(
        select(ProductVariant.id, ProductVariant.product_id, SupplierListing.provider_id)
        .outerjoin(SupplierListing, SupplierListing.variant_id == ProductVariant.id)
        .where(ProductVariant.product_id.in_(product_ids))
    )).all()
    stocked = set((await db.execute(
        select(Resource.variant_id).join(ProductVariant, ProductVariant.id == Resource.variant_id)
        .where(ProductVariant.product_id.in_(product_ids), Resource.order_id.is_(None))
        .distinct()
    )).scalars())
    held = aliased(Resource)
    # Kho chưa bán của sản phẩm trùng dòng shop mới đã giữ → unique index chặn.
    clashing = set((await db.execute(
        select(ProductVariant.product_id).join(Resource, Resource.variant_id == ProductVariant.id)
        .where(ProductVariant.product_id.in_(product_ids), Resource.order_id.is_(None))
        .where(Resource.data_hash.in_(
            select(held.data_hash).where(held.seller_id == new_seller_id)
        ))
        .distinct()
    )).scalars())
    variants_by_product: dict[int, list[tuple[int, int | None]]] = {}
    for vid, pid, listing_provider in variant_rows:
        variants_by_product.setdefault(pid, []).append((vid, listing_provider))

    for product in products:
        variants = variants_by_product.get(product.id, [])
        row = {
            "id": product.id, "public_key": product.public_key, "slug": product.slug,
            "name": product.title, "status": product.status.value if product.status else None,
            # Nguồn API (gateway) bán theo gói trong pricing_params, không có phân loại.
            "variant_count": len(variants) or len((product.pricing_params or {}).get("packages") or []),
        }
        if product.seller_id == new_seller_id:
            continue  # đã ở shop mới — không có gì để chuyển
        reason = None
        if plan.old_seller_id is not None and product.seller_id != plan.old_seller_id:
            reason = BLOCK_OTHER_SHOP
        elif product.provider_id not in (None, provider.id):
            reason = BLOCK_OTHER_SOURCE
        elif any(lp not in (None, provider.id) for _, lp in variants):
            reason = BLOCK_OTHER_SOURCE
        elif any(lp is None and vid in stocked for vid, lp in variants):
            # Gói không gắn SKU nguồn mà có kho riêng là hàng của shop, không phải của nguồn.
            reason = BLOCK_OWN_STOCK
        elif product.id in clashing:
            reason = BLOCK_DUPLICATE_STOCK
        if reason:
            plan.blocked.append({**row, "reason": reason})
        else:
            plan.movable.append(row)

    if plan.old_seller_id is not None:
        moving_ids = [r["id"] for r in plan.movable]
        plan.open_orders = int(await db.scalar(
            select(func.count(Order.id)).where(
                Order.seller_id == plan.old_seller_id, Order.status.in_(OPEN_ORDER_STATUSES),
                or_(Order.provider_id == provider.id, Order.product_id.in_(moving_ids or [-1])),
            )
        ) or 0)
    return plan


async def _seller_brief(seller_id: int | None, db: AsyncSession) -> dict | None:
    if seller_id is None:
        return None
    from src.sellers.service import approved_business_names

    account = await db.get(Account, seller_id)
    if account is None:
        return None
    names = await approved_business_names([seller_id], db)
    return {"id": account.id, "email": account.email, "business_name": names.get(seller_id)}


async def preview_transfer(provider: Provider, new_seller_id: int, db: AsyncSession) -> dict:
    seller = await validate_target_seller(new_seller_id, db)
    plan = await _plan(provider, seller.id, db)
    return {
        "provider_id": provider.id,
        "same_seller": provider.seller_id == seller.id,
        "from_seller": await _seller_brief(plan.old_seller_id, db),
        "to_seller": await _seller_brief(seller.id, db),
        "products": plan.movable,
        "blocked": plan.blocked,
        "product_count": len(plan.movable),
        "variant_count": sum(r["variant_count"] for r in plan.movable),
        "open_orders": plan.open_orders,
    }


async def transfer_source(
    provider: Provider, new_seller_id: int, db: AsyncSession, *, actor_id: int | None,
) -> dict:
    """Một transaction: nguồn + sản phẩm chuyển được sang shop mới. Shop mới
    trùng shop hiện tại → 400 (không có gì để làm)."""
    from src.audit.service import log_event
    from src.logging import current_request_id

    seller = await validate_target_seller(new_seller_id, db)
    if provider.seller_id == seller.id:
        raise _bad_request("Nguồn đã thuộc cửa hàng này — chọn cửa hàng khác")
    # Khoá nguồn: hai admin bấm cùng lúc không chuyển chồng chéo.
    await db.execute(select(Provider.id).where(Provider.id == provider.id).with_for_update())
    plan = await _plan(provider, seller.id, db)
    moving_ids = [r["id"] for r in plan.movable]
    moved_resources = moved_batches = 0
    if moving_ids:
        variant_ids = select(ProductVariant.id).where(ProductVariant.product_id.in_(moving_ids))
        await db.execute(update(Product).where(Product.id.in_(moving_ids)).values(seller_id=seller.id))
        moved_resources = (await db.execute(
            update(Resource).where(Resource.variant_id.in_(variant_ids), Resource.order_id.is_(None))
            .values(seller_id=seller.id)
        )).rowcount or 0
        sold_in_batch = exists().where(Resource.batch_id == StockBatch.id, Resource.order_id.is_not(None))
        moved_batches = (await db.execute(
            update(StockBatch).where(StockBatch.variant_id.in_(variant_ids), ~sold_in_batch)
            .values(seller_id=seller.id)
            .execution_options(synchronize_session=False)
        )).rowcount or 0

    if not seller.is_internal:
        # Như update_provider: giao nguồn = bật cờ nội bộ cho tài khoản (có audit).
        seller.is_internal = True
        await log_event(
            db, "warning", f"Account {seller.id} marked internal by provider assignment",
            request_id=current_request_id(),
            metadata={"event": "account_internal_flag_set", "account_id": seller.id,
                      "provider_id": provider.id, "actor_id": actor_id, "source": "source_transfer"},
        )
    provider.seller_id = seller.id
    provider.review_status = "approved"
    await log_event(
        db, "info", f"Provider {provider.id} transferred to seller {seller.id}",
        request_id=current_request_id(),
        metadata={
            "event": "source_transferred", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "provider", "subject_id": provider.id, "outcome": "success", "source": "admin",
            "provider_id": provider.id, "from_seller_id": plan.old_seller_id, "to_seller_id": seller.id,
            "product_ids": moving_ids, "blocked_product_ids": [r["id"] for r in plan.blocked],
            "resources_moved": moved_resources, "batches_moved": moved_batches,
            "open_orders_kept": plan.open_orders,
        },
    )
    await db.commit()
    return {
        "provider_id": provider.id,
        "from_seller": await _seller_brief(plan.old_seller_id, db),
        "to_seller": await _seller_brief(seller.id, db),
        "products": plan.movable,
        "blocked": plan.blocked,
        "product_count": len(plan.movable),
        "variant_count": sum(r["variant_count"] for r in plan.movable),
        "open_orders": plan.open_orders,
    }
