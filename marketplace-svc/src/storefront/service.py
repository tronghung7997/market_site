"""Storefront aggregates that no single feature owns.

Read-only and cached per process for a minute: the home page asks on every
render and the numbers only need to be roughly current.
"""
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductStatus
from src.models.review import Review
from src.runtime_config.cache import ProcessConfigCache

STATS_TTL_SECONDS = 60.0

_stats_cache: ProcessConfigCache[dict] = ProcessConfigCache("storefront_marketplace_stats", ttl_seconds=STATS_TTL_SECONDS)


async def get_marketplace_stats(db: AsyncSession) -> dict:
    cached = _stats_cache.get()
    if cached is not None:
        return cached
    products_on_sale, sellers_on_sale = (await db.execute(
        select(func.count(Product.id), func.count(func.distinct(Product.seller_id)))
        .where(Product.status == ProductStatus.active)
    )).one()
    # Trust-seed orders never happened; they must not inflate a public figure.
    completed_orders = await db.scalar(
        select(func.count(Order.id)).where(Order.status == OrderStatus.completed, Order.is_seeded.is_(False))
    )
    review_count, rating_avg = (await db.execute(
        select(func.count(Review.id), func.avg(Review.rating)).where(Review.is_hidden == False)  # noqa: E712
    )).one()
    stats = {
        "products_on_sale": int(products_on_sale or 0),
        "sellers_on_sale": int(sellers_on_sale or 0),
        "completed_orders": int(completed_orders or 0),
        "review_count": int(review_count or 0),
        "rating_avg": round(float(rating_avg), 2) if rating_avg is not None else None,
    }
    _stats_cache.set(stats)
    return stats
