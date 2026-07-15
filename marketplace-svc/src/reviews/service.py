from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.review import Review


async def create_review(
    order_id: int, buyer_id: int, rating: int, comment: str | None, db: AsyncSession
) -> Review:
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.buyer_id != buyer_id:
        raise HTTPException(status_code=403, detail="Đây không phải đơn hàng của bạn")
    if order.status != OrderStatus.completed:
        raise HTTPException(status_code=400, detail="Đơn hàng chưa hoàn tất")

    existing = await db.execute(select(Review).where(Review.order_id == order_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Bạn đã đánh giá đơn hàng này rồi")

    # Resolve product_id from order's variant
    variant = await db.get(ProductVariant, order.variant_id)
    if not variant:
        raise HTTPException(status_code=400, detail="Không tìm thấy gói sản phẩm")

    review = Review(
        order_id=order_id,
        buyer_id=buyer_id,
        product_id=variant.product_id,
        rating=rating,
        comment=comment,
    )
    db.add(review)
    await db.flush()

    # Update product rating_avg and rating_count
    result = await db.execute(
        select(func.avg(Review.rating), func.count(Review.id)).where(
            Review.product_id == variant.product_id
        )
    )
    avg_rating, count = result.one()
    product = await db.get(Product, variant.product_id)
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
