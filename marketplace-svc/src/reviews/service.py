from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.exceptions import ErrorCode, api_error
from src.logging import current_request_id

from src.models.account import Account
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

    await refresh_product_rating(product_id, db)

    await db.commit()
    await db.refresh(review)
    return review


async def refresh_product_rating(product_id: int, db: AsyncSession) -> None:
    """Recompute rating_avg / rating_count from visible reviews only."""
    avg_rating, count = (await db.execute(
        select(func.avg(Review.rating), func.count(Review.id)).where(
            Review.product_id == product_id, Review.is_hidden == False,  # noqa: E712
        )
    )).one()
    product = await db.get(Product, product_id)
    if product:
        product.rating_avg = float(avg_rating) if avg_rating else None
        product.rating_count = count or 0


async def get_product_reviews(product_id: int, db: AsyncSession) -> list[dict]:
    """Newest first; each row carries the purchased variant name so the
    storefront can show *which* package the buyer is rating."""
    result = await db.execute(
        select(Review, ProductVariant.name)
        .join(Order, Order.id == Review.order_id)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .where(Review.product_id == product_id, Review.is_hidden == False)  # noqa: E712
        .order_by(Review.created_at.desc())
    )
    return [_review_dict(review, variant_name) for review, variant_name in result.all()]


def _review_dict(review: Review, variant_name: str | None) -> dict:
    return {
        "id": review.id,
        "order_id": review.order_id,
        "buyer_id": review.buyer_id,
        "product_id": review.product_id,
        "rating": review.rating,
        "comment": review.comment,
        "created_at": review.created_at,
        "variant_name": variant_name,
        "seller_reply": review.seller_reply,
        "seller_replied_at": review.seller_replied_at,
        "is_hidden": review.is_hidden,
    }


# --- seller: list + reply -----------------------------------------------------

async def list_seller_reviews(
    seller_id: int, db: AsyncSession, *, product_id: int | None, unreplied_only: bool, page: int, per_page: int,
) -> dict:
    """Reviews on the seller's own products, newest first. Hidden reviews are
    included (flagged) so the seller knows a reply is no longer public."""
    filters = [Product.seller_id == seller_id]
    if product_id:
        filters.append(Review.product_id == product_id)
    base = select(Review).join(Product, Product.id == Review.product_id).where(*filters)
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    unreplied = int(await db.scalar(
        select(func.count()).select_from(
            base.where(Review.seller_reply.is_(None), Review.is_hidden == False).subquery()  # noqa: E712
        )
    ) or 0)
    query = (
        select(Review, ProductVariant.name, Product.title)
        .join(Product, Product.id == Review.product_id)
        .join(Order, Order.id == Review.order_id)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .where(*filters)
    )
    if unreplied_only:
        query = query.where(Review.seller_reply.is_(None), Review.is_hidden == False)  # noqa: E712
    rows = (await db.execute(
        query.order_by(Review.created_at.desc(), Review.id.desc()).offset((page - 1) * per_page).limit(per_page)
    )).all()
    return {
        "items": [{**_review_dict(review, variant_name), "product_title": title} for review, variant_name, title in rows],
        "total": total, "unreplied": unreplied, "page": page, "per_page": per_page,
    }


async def _seller_owned_review(review_id: int, seller_id: int, db: AsyncSession) -> Review:
    review = await db.get(Review, review_id)
    product = await db.get(Product, review.product_id) if review else None
    if not review or not product or product.seller_id != seller_id:
        raise api_error(ErrorCode.REVIEW_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return review


async def reply_to_review(review_id: int, seller_id: int, body: str, db: AsyncSession) -> Review:
    """Set or overwrite the seller's public reply."""
    review = await _seller_owned_review(review_id, seller_id, db)
    review.seller_reply = body.strip()
    review.seller_replied_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(review)
    return review


async def delete_review_reply(review_id: int, seller_id: int, db: AsyncSession) -> Review:
    review = await _seller_owned_review(review_id, seller_id, db)
    review.seller_reply = None
    review.seller_replied_at = None
    await db.commit()
    await db.refresh(review)
    return review


# --- admin: list + hide -------------------------------------------------------

def _admin_query(*filters):
    return (
        select(Review, ProductVariant.name, Product.title, Product.seller_id, Account.email)
        .join(Product, Product.id == Review.product_id)
        .join(Order, Order.id == Review.order_id)
        .join(Account, Account.id == Review.buyer_id)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .where(*filters)
    )


def _admin_row(review: Review, variant_name: str | None, title: str, seller_id: int, email: str) -> dict:
    return {
        **_review_dict(review, variant_name), "product_title": title, "seller_id": seller_id,
        "buyer_email": email, "hidden_reason": review.hidden_reason, "hidden_at": review.hidden_at,
        "hidden_by_id": review.hidden_by_id,
    }


async def list_admin_reviews(
    db: AsyncSession, *, product_id: int | None, hidden: bool | None, page: int, per_page: int,
) -> dict:
    filters = []
    if product_id:
        filters.append(Review.product_id == product_id)
    if hidden is not None:
        filters.append(Review.is_hidden == hidden)
    total = int(await db.scalar(select(func.count()).select_from(Review).where(*filters)) or 0)
    rows = (await db.execute(
        _admin_query(*filters).order_by(Review.created_at.desc(), Review.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )).all()
    return {"items": [_admin_row(*row) for row in rows], "total": total, "page": page, "per_page": per_page}


async def get_admin_review(review_id: int, db: AsyncSession) -> dict:
    row = (await db.execute(_admin_query(Review.id == review_id))).first()
    if not row:
        raise api_error(ErrorCode.REVIEW_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return _admin_row(*row)


async def set_review_visibility(
    review_id: int, admin_id: int, hidden: bool, reason: str | None, db: AsyncSession,
) -> Review:
    """Hide (or restore) a review. The row stays so the buyer's order still
    counts as reviewed; only the storefront and the rating change."""
    review = await db.get(Review, review_id)
    if not review:
        raise api_error(ErrorCode.REVIEW_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    review.is_hidden = hidden
    review.hidden_reason = (reason or "").strip() or None if hidden else None
    review.hidden_by_id = admin_id if hidden else None
    review.hidden_at = datetime.now(timezone.utc) if hidden else None
    await refresh_product_rating(review.product_id, db)
    await log_event(
        db, "info", f"Review {review_id} {'hidden' if hidden else 'restored'} by admin",
        request_id=current_request_id(),
        metadata={
            "event": "review.moderate", "actor_id": admin_id, "subject_type": "review", "subject_id": review_id,
            "outcome": "hidden" if hidden else "visible", "reason": review.hidden_reason, "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(review)
    return review
