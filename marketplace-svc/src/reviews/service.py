from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error

from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.review import Review


async def create_review(
    order_id: int, buyer_id: int, rating: int, comment: str | None, db: AsyncSession
) -> Review:
    order = await db.get(Order, order_id)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != buyer_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    if order.status != OrderStatus.completed:
        raise api_error(ErrorCode.ORDER_NOT_COMPLETED, status.HTTP_400_BAD_REQUEST)

    existing = await db.execute(select(Review).where(Review.order_id == order_id))
    if existing.scalar_one_or_none():
        raise api_error(ErrorCode.REVIEW_ALREADY_EXISTS, status.HTTP_400_BAD_REQUEST)

    # Stock/manual orders retain a variant; adapter orders retain product_id.
    # Both are commercial product purchases and are reviewable after settlement.
    product_id = order.product_id
    if product_id is None and order.variant_id is not None:
        variant = await db.get(ProductVariant, order.variant_id)
        product_id = variant.product_id if variant else None
    if product_id is None:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_400_BAD_REQUEST)

    review = Review(
        order_id=order_id,
        buyer_id=buyer_id,
        product_id=product_id,
        rating=rating,
        comment=comment,
    )
    db.add(review)
    await db.flush()

    # Update product rating_avg and rating_count
    result = await db.execute(
        select(func.avg(Review.rating), func.count(Review.id)).where(
            Review.product_id == product_id
        )
    )
    avg_rating, count = result.one()
    product = await db.get(Product, product_id)
    if product:
        product.rating_avg = float(avg_rating) if avg_rating else None
        product.rating_count = count or 0

    await db.commit()
    await db.refresh(review)
    return review


async def get_product_reviews(product_id: int, db: AsyncSession) -> list[Review]:
    result = await db.execute(
        select(Review).where(Review.product_id == product_id).order_by(Review.created_at.desc())
    )
    return list(result.scalars().all())
