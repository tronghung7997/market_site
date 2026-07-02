from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import NotOwner
from src.models.account import Account
from src.models.category import Category
from src.models.product import DeliveryMode, Product, ProductStatus, ProductVariant
from src.models.order import Order, OrderStatus
from src.models.provider import Provider
from src.models.resource import Resource, ResourceStatus


async def create_product(seller_id: int, data: dict, db: AsyncSession) -> Product:
    product = Product(seller_id=seller_id, **data)
    db.add(product)
    await db.commit()
    await db.refresh(product)
    return product


async def update_product(product_id: int, seller_id: int, data: dict, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.seller_id != seller_id:
        raise NotOwner()
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
        raise HTTPException(status_code=404, detail="Product not found")
    for key, value in data.items():
        if value is not None:
            setattr(product, key, value)
    await db.commit()
    await db.refresh(product)
    return product


async def delete_product(product_id: int, seller_id: int, db: AsyncSession) -> None:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.seller_id != seller_id:
        raise NotOwner()
    product.status = ProductStatus.paused
    await db.commit()


async def suspend_product(product_id: int, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    product.status = ProductStatus.suspended
    await db.commit()
    await db.refresh(product)
    return product


async def create_variant(product_id: int, seller_id: int, data: dict, db: AsyncSession) -> ProductVariant:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
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
        raise HTTPException(status_code=404, detail="Variant not found")
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()
    for key, value in data.items():
        if value is not None:
            setattr(variant, key, value)
    await db.commit()
    await db.refresh(variant)
    return variant


async def delete_variant(variant_id: int, seller_id: int, db: AsyncSession) -> None:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Variant not found")
    product = await db.get(Product, variant.product_id)
    if product.seller_id != seller_id:
        raise NotOwner()
    await db.delete(variant)
    await db.commit()


async def list_products(db: AsyncSession, category_id: int | None = None) -> list[Product]:
    query = select(Product).where(Product.status == ProductStatus.active)
    if category_id:
        query = query.where(Product.category_id == category_id)
    query = query.order_by(Product.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def list_seller_products(seller_id: int, db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(Product).where(Product.seller_id == seller_id).order_by(Product.created_at.desc())
    )
    products = list(result.scalars().all())
    out = []
    for p in products:
        category = await db.get(Category, p.category_id)
        total_stock = 0
        variants_result = await db.execute(
            select(ProductVariant).where(ProductVariant.product_id == p.id, ProductVariant.is_active)
        )
        variants = list(variants_result.scalars().all())
        for v in variants:
            if v.delivery_mode == DeliveryMode.instant:
                count = await db.scalar(
                    select(func.count(Resource.id)).where(
                        Resource.variant_id == v.id, Resource.status == ResourceStatus.available
                    )
                )
                total_stock += count or 0
        out.append({
            **_product_dict(p),
            "category_name": category.name if category else None,
            "variant_count": len(variants),
            "total_stock": total_stock,
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


async def get_product_detail(product_id: int, db: AsyncSession) -> dict:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    seller = await db.get(Account, product.seller_id)
    category = await db.get(Category, product.category_id)

    variants_result = await db.execute(
        select(ProductVariant).where(ProductVariant.product_id == product_id, ProductVariant.is_active).order_by(ProductVariant.sort_order)
    )
    variants = list(variants_result.scalars().all())

    variant_dicts = []
    for v in variants:
        stock = 0
        if v.delivery_mode == DeliveryMode.instant:
            count = await db.scalar(
                select(func.count(Resource.id)).where(Resource.variant_id == v.id, Resource.status == ResourceStatus.available)
            )
            stock = count or 0
        variant_dicts.append({
            "id": v.id, "product_id": v.product_id, "name": v.name, "price": v.price,
            "delivery_mode": v.delivery_mode.value, "sla_hours": v.sla_hours,
            "duration_days": v.duration_days,
            "sort_order": v.sort_order, "is_active": v.is_active, "stock_count": stock,
        })

    return {
        **_product_dict(product),
        "variants": variant_dicts,
        "seller_email": seller.email if seller else None,
        "category_name": category.name if category else None,
    }


async def update_product_operations(product_id: int, data: dict, db: AsyncSession) -> Product:
    product = await db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    for key, value in data.items():
        setattr(product, key, value)
    await db.commit()
    await db.refresh(product)
    return product


async def list_all_products_admin(db: AsyncSession) -> list[dict]:
    """Return every product with seller email, provider name, order count, revenue."""
    result = await db.execute(select(Product).order_by(Product.created_at.desc()))
    products = list(result.scalars().all())

    out = []
    for p in products:
        seller = await db.get(Account, p.seller_id)
        provider = await db.get(Provider, p.provider_id) if p.provider_id else None

        order_count = await db.scalar(
            select(func.count(Order.id)).where(Order.product_id == p.id)
        ) or 0
        revenue = await db.scalar(
            select(func.sum(Order.total_amount)).where(
                Order.product_id == p.id,
                Order.status.in_([OrderStatus.delivered, OrderStatus.completed]),
            )
        ) or 0

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
        })
    return out


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
