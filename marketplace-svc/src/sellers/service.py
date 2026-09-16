from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.i18n.slug import canonical_path, parse_public_ref, slugify_text
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductStatus

SELLER_PATH_PREFIX = "/sellers"
SELLER_HANDLE_MAX_LENGTH = 60


def seller_handle(business_name: str | None) -> str | None:
    """URL handle from the approved business name; None when the shop has no
    name yet (the URL is then the bare key — never the email local part)."""
    if not business_name or not business_name.strip():
        return None
    return slugify_text(business_name, max_length=SELLER_HANDLE_MAX_LENGTH)


def seller_public_ref(public_key: str, business_name: str | None) -> dict:
    """``{public_key, handle, canonical_path}`` — the storefront identity of a seller."""
    handle = seller_handle(business_name)
    return {
        "public_key": public_key,
        "handle": handle,
        "canonical_path": canonical_path(SELLER_PATH_PREFIX, handle, public_key),
    }


async def approved_business_names(account_ids: list[int], db: AsyncSession) -> dict[int, str]:
    """Latest approved business name per seller account."""
    if not account_ids:
        return {}
    rows = (await db.execute(
        select(SellerApplication.account_id, SellerApplication.business_name)
        .where(
            SellerApplication.account_id.in_(account_ids),
            SellerApplication.status == ApplicationStatus.approved,
        )
        .order_by(SellerApplication.created_at.desc())
    )).all()
    names: dict[int, str] = {}
    for account_id, business_name in rows:
        names.setdefault(account_id, business_name)
    return names


async def seller_refs_by_id(account_ids: list[int] | set[int], db: AsyncSession) -> dict[int, dict]:
    """``{account_id: {seller_key, seller_handle, seller_path}}`` for embedding
    in public product / chat payloads instead of the raw ``seller_id``."""
    ids = list({i for i in account_ids if i})
    if not ids:
        return {}
    keys = dict((await db.execute(
        select(Account.id, Account.public_key).where(Account.id.in_(ids))
    )).all())
    names = await approved_business_names(ids, db)
    out: dict[int, dict] = {}
    for account_id, key in keys.items():
        ref = seller_public_ref(key, names.get(account_id))
        out[account_id] = {
            "seller_key": ref["public_key"],
            "seller_handle": ref["handle"],
            "seller_path": ref["canonical_path"],
        }
    return out


async def resolve_seller_ref(raw: str, db: AsyncSession) -> Account | None:
    """Seller account for a route param: ``{handle}-{key}``, bare key, or a
    legacy integer id. None when unparseable, unknown, or not a seller."""
    parsed = parse_public_ref(raw)
    if parsed is None:
        return None
    kind, value = parsed
    if kind == "id":
        account = await db.get(Account, value)
    else:
        account = await db.scalar(select(Account).where(Account.public_key == value))
    if not account or "seller" not in (account.roles or []):
        return None
    return account


async def _seller_ids_with_active_products(db: AsyncSession) -> list[int]:
    result = await db.execute(
        select(Product.seller_id).where(Product.status == ProductStatus.active).distinct()
    )
    return [row[0] for row in result.all()]


async def _build_seller_summaries(seller_ids: list[int], db: AsyncSession) -> list[dict]:
    if not seller_ids:
        return []

    accounts_result = await db.execute(
        select(Account.id, Account.email, Account.seller_tier, Account.public_key).where(Account.id.in_(seller_ids))
    )
    accounts_rows = accounts_result.all()
    display_names = {row.id: row.email.split("@", 1)[0] for row in accounts_rows}
    tiers = {row.id: row.seller_tier.value for row in accounts_rows}
    public_keys = {row.id: row.public_key for row in accounts_rows}

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

    business_names = await approved_business_names(seller_ids, db)

    # No account_id on the wire: the public key is the seller's only public handle.
    return [
        {
            **seller_public_ref(public_keys[seller_id], business_names.get(seller_id)),
            "display_name": business_names.get(seller_id) or display_names.get(seller_id, "seller"),
            "business_name": business_names.get(seller_id),
            "completed_order_count": completed_counts.get(seller_id, 0),
            "rating_avg": ratings.get(seller_id),
            "review_count": review_counts.get(seller_id, 0),
            "seller_tier": tiers.get(seller_id, "new"),
        }
        for seller_id in seller_ids
        if seller_id in display_names
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
