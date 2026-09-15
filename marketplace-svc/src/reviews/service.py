from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error

from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.review import Review

# Buyers rate what they received, not the escrow outcome: a review opens the
# moment the goods are in hand (delivered) and stays open through completion.
# It closes 30 days after the protection window ends so old orders cannot be
# review-bombed long after the fact. Refunded/cancelled orders never open.
REVIEWABLE_STATUSES = {OrderStatus.delivered, OrderStatus.completed}
REVIEW_WINDOW_DAYS = 30


def review_deadline(order: Order) -> datetime | None:
    anchor = order.escrow_expires_at or order.created_at
    if anchor is None:
        return None
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    return anchor + timedelta(days=REVIEW_WINDOW_DAYS)


def review_window_open(order: Order, now: datetime | None = None) -> bool:
    deadline = review_deadline(order)
    return deadline is None or (now or datetime.now(timezone.utc)) <= deadline


def can_review_order(order: Order, now: datetime | None = None) -> bool:
    return order.status in REVIEWABLE_STATUSES and review_window_open(order, now)


async def create_review(
    order_id: int, buyer_id: int, rating: int, comment: str | None, db: AsyncSession
) -> Review:
    order = await db.get(Order, order_id)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != buyer_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    if order.status not in REVIEWABLE_STATUSES:
        raise api_error(ErrorCode.REVIEW_NOT_ELIGIBLE, status.HTTP_400_BAD_REQUEST)
    if not review_window_open(order):
        raise api_error(ErrorCode.REVIEW_WINDOW_CLOSED, status.HTTP_400_BAD_REQUEST)

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


async def get_product_reviews(product_id: int, db: AsyncSession) -> list[dict]:
    """Newest first; each row carries the purchased variant name so the
    storefront can show *which* package the buyer is rating."""
    result = await db.execute(
        select(Review, ProductVariant.name)
        .join(Order, Order.id == Review.order_id)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .where(Review.product_id == product_id)
        .order_by(Review.created_at.desc())
    )
    return [
        {
            "id": review.id,
            "order_id": review.order_id,
            "buyer_id": review.buyer_id,
            "product_id": review.product_id,
            "rating": review.rating,
            "comment": review.comment,
            "created_at": review.created_at,
            "variant_name": variant_name,
        }
        for review, variant_name in result.all()
    ]
