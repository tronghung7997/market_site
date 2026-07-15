from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductStatus


async def _seller_ids_with_active_products(db: AsyncSession) -> list[int]:
    result = await db.execute(
        select(Product.seller_id).where(Product.status == ProductStatus.active).distinct()
    )
    return [row[0] for row in result.all()]


async def _build_seller_summaries(seller_ids: list[int], db: AsyncSession) -> list[dict]:
    if not seller_ids:
        return []

    accounts_result = await db.execute(select(Account.id, Account.email).where(Account.id.in_(seller_ids)))
    emails = {row.id: row.email for row in accounts_result.all()}

    completed_result = await db.execute(
        select(Order.seller_id, func.count(Order.id))
        .where(Order.seller_id.in_(seller_ids), Order.status == OrderStatus.completed)
        .group_by(Order.seller_id)
    )
    completed_counts = {seller_id: count for seller_id, count in completed_result.all()}

    rating_result = await db.execute(
        select(
            Product.seller_id,
            func.sum(Product.rating_avg * Product.rating_count),
            func.sum(Product.rating_count),
        )
        .where(Product.seller_id.in_(seller_ids), Product.rating_count > 0)
        .group_by(Product.seller_id)
    )
    ratings: dict[int, float | None] = {}
    review_counts: dict[int, int] = {}
    for seller_id, rating_sum, rating_count in rating_result.all():
        review_counts[seller_id] = rating_count or 0
        ratings[seller_id] = round(rating_sum / rating_count, 2) if rating_count else None

    app_result = await db.execute(
        select(SellerApplication.account_id, SellerApplication.business_name)
        .where(
            SellerApplication.account_id.in_(seller_ids),
            SellerApplication.status == ApplicationStatus.approved,
        )
        .order_by(SellerApplication.created_at.desc())
    )
    business_names: dict[int, str] = {}
    for account_id, business_name in app_result.all():
        business_names.setdefault(account_id, business_name)

    return [
        {
            "account_id": seller_id,
            "email": emails.get(seller_id, ""),
            "business_name": business_names.get(seller_id),
            "completed_order_count": completed_counts.get(seller_id, 0),
            "rating_avg": ratings.get(seller_id),
            "review_count": review_counts.get(seller_id, 0),
        }
        for seller_id in seller_ids
        if seller_id in emails
    ]


async def get_top_sellers(db: AsyncSession, limit: int = 6) -> list[dict]:
    seller_ids = await _seller_ids_with_active_products(db)
    summaries = await _build_seller_summaries(seller_ids, db)
    summaries.sort(key=lambda s: (s["completed_order_count"], s["rating_avg"] or 0), reverse=True)
    return summaries[:limit]


async def get_seller_profile(seller_id: int, db: AsyncSession) -> dict | None:
    account = await db.get(Account, seller_id)
    if not account or "seller" not in account.roles:
        return None
    summaries = await _build_seller_summaries([seller_id], db)
    if not summaries:
        return None

    bio_result = await db.execute(
        select(SellerApplication.description)
        .where(SellerApplication.account_id == seller_id, SellerApplication.status == ApplicationStatus.approved)
        .order_by(SellerApplication.created_at.desc())
        .limit(1)
    )
    bio = bio_result.scalar_one_or_none()

    return {**summaries[0], "bio": bio, "member_since": account.created_at}
