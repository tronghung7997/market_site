from datetime import datetime, timedelta, timezone

from sqlalchemy import Float, cast, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.i18n.search_text import SearchTerms, normalize_query, search_terms
from src.i18n.slug import canonical_path, parse_public_ref, slugify_text
from src.media.service import public_image
from src.runtime_config.cache import KeyedProcessCache
from src.sellers.activity import active_band, response_band
from src.sellers.tier_config import get_tier_rules
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


async def approved_shop_images(account_ids: list[int], db: AsyncSession) -> dict[int, tuple[dict | None, dict | None]]:
    """(logo, banner) PublicImages of each seller's latest approved application."""
    if not account_ids:
        return {}
    rows = (await db.execute(
        select(SellerApplication.account_id, SellerApplication.logo, SellerApplication.banner)
        .where(
            SellerApplication.account_id.in_(account_ids),
            SellerApplication.status == ApplicationStatus.approved,
        )
        .order_by(SellerApplication.created_at.desc())
    )).all()
    images: dict[int, tuple[dict | None, dict | None]] = {}
    for account_id, logo, banner in rows:
        images.setdefault(account_id, (public_image(logo), public_image(banner)))
    return images


async def seller_refs_by_id(account_ids: list[int] | set[int], db: AsyncSession) -> dict[int, dict]:
    """``{account_id: {seller_key, seller_handle, seller_path, seller_name}}``
    for embedding in public product / chat payloads instead of the raw
    ``seller_id``. ``seller_name`` is the approved business name, else the
    email local part (the same label the product detail page shows)."""
    ids = list({i for i in account_ids if i})
    if not ids:
        return {}
    rows = (await db.execute(
        select(Account.id, Account.public_key, Account.email).where(Account.id.in_(ids))
    )).all()
    names = await approved_business_names(ids, db)
    out: dict[int, dict] = {}
    for account_id, key, email in rows:
        business_name = names.get(account_id)
        ref = seller_public_ref(key, business_name)
        out[account_id] = {
            "seller_key": ref["public_key"],
            "seller_handle": ref["handle"],
            "seller_path": ref["canonical_path"],
            "seller_name": business_name or (email.split("@", 1)[0] if email else None),
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


def seller_stats_subqueries():
    """``(sales, rating)`` subqueries keyed by ``seller_id`` — the shop's
    completed orders, and its review-weighted average over every product.
    The same two numbers the shop page shows (``_build_seller_summaries``),
    in a joinable form so the catalog can sort by them."""
    sales = (
        select(Order.seller_id.label("seller_id"), func.count(Order.id).label("sales"))
        .where(Order.status == OrderStatus.completed)
        .group_by(Order.seller_id)
        .subquery("shop_sales")
    )
    reviews = func.sum(Product.rating_count)
    rating = (
        select(
            Product.seller_id.label("seller_id"),
            (func.sum(cast(Product.rating_avg, Float) * Product.rating_count) / func.nullif(reviews, 0)).label("rating"),
            reviews.label("reviews"),
        )
        .where(Product.rating_count > 0)
        .group_by(Product.seller_id)
        .subquery("shop_rating")
    )
    return sales, rating


async def seller_stats_by_id(account_ids: set[int] | list[int], db: AsyncSession) -> dict[int, dict]:
    """``{account_id: {shop_sales, shop_rating_avg, shop_review_count}}`` for
    the shops on one catalog page (two grouped queries, whatever the page size)."""
    ids = [i for i in set(account_ids) if i is not None]
    if not ids:
        return {}
    sales, rating = seller_stats_subqueries()
    rows = (await db.execute(
        select(Account.id, sales.c.sales, rating.c.rating, rating.c.reviews)
        .outerjoin(sales, sales.c.seller_id == Account.id)
        .outerjoin(rating, rating.c.seller_id == Account.id)
        .where(Account.id.in_(ids))
    )).all()
    return {
        account_id: {
            "shop_sales": int(n or 0),
            "shop_rating_avg": round(float(avg), 2) if avg is not None else None,
            "shop_review_count": int(reviews or 0),
        }
        for account_id, n, avg, reviews in rows
    }


def seller_name_matches(terms: SearchTerms, seller_id_column):
    """EXISTS clause: the product's shop has an approved business name that
    contains the whole query (same trigram corpus as ``search_sellers``).
    Phrase only: a product query's words must not pull in every product of a
    shop whose name shares one of them."""
    corpus = func.immutable_unaccent(func.lower(SellerApplication.business_name))
    return exists().where(
        SellerApplication.account_id == seller_id_column,
        SellerApplication.status == ApplicationStatus.approved,
        terms.match_phrase(corpus),
    )


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
    shop_images = await approved_shop_images(seller_ids, db)
    tier_rules = await get_tier_rules(db)

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
            "tier_badge": getattr(tier_rules.get(tiers.get(seller_id, "new")), "badge", None),
            "logo": shop_images.get(seller_id, (None, None))[0],
            "banner": shop_images.get(seller_id, (None, None))[1],
        }
        for seller_id in seller_ids
        if seller_id in display_names
    ]


async def get_top_sellers(db: AsyncSession, limit: int = 6, *, locale: str = "vi") -> list[dict]:
    """Best shops by completed orders, each with its reply speed and the
    category it sells most in — what a buyer compares before opening a shop."""
    from src.i18n.catalog import resolve_category_fields
    from src.models.category import Category

    seller_ids = await _seller_ids_with_active_products(db)
    summaries = await _build_seller_summaries(seller_ids, db)
    summaries.sort(key=lambda s: (s["completed_order_count"], s["rating_avg"] or 0), reverse=True)
    top = summaries[:limit]
    ids_by_key = dict((await db.execute(
        select(Account.public_key, Account.id).where(Account.public_key.in_([s["public_key"] for s in top]))
    )).all())
    rows = (await db.execute(
        select(Product.seller_id, Product.category_id, func.count(Product.id).label("n"))
        .where(Product.seller_id.in_(list(ids_by_key.values())), Product.status == ProductStatus.active)
        .group_by(Product.seller_id, Product.category_id)
        .order_by(func.count(Product.id).desc(), Product.category_id)
    )).all()
    main_category_id: dict[int, int] = {}
    for seller_id, category_id, _ in rows:
        main_category_id.setdefault(seller_id, category_id)
    categories = {
        c.id: c for c in (await db.execute(
            select(Category).where(Category.id.in_(set(main_category_id.values())))
        )).scalars()
    } if main_category_id else {}
    presences = await seller_presences(list(ids_by_key.values()), db)
    for summary in top:
        seller_id = ids_by_key.get(summary["public_key"])
        if seller_id is None:
            continue
        summary["response_time"] = presences[seller_id]["response_time"]
        category = categories.get(main_category_id.get(seller_id))
        summary["main_category"] = (
            {"name": resolve_category_fields(category, locale)["name"], "slug": category.slug}
            if category else None
        )
    return top


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

    from src.sellers.trust import public_trust

    presence = await seller_presence(seller_id, db)
    trust = await public_trust(seller_id, db)
    return {**summaries[0], "bio": bio, "member_since": account.created_at, **presence, **trust}


_presence_cache: KeyedProcessCache[int, dict] = KeyedProcessCache("seller_presence", ttl_seconds=600, max_entries=4096)


async def seller_presence(seller_id: int, db: AsyncSession) -> dict:
    """Reply-speed band over the last 30 days and last-active band, cached per
    process for ten minutes (public pages ask on every render)."""
    return (await seller_presences([seller_id], db))[seller_id]


async def seller_presences(seller_ids: list[int], db: AsyncSession) -> dict[int, dict]:
    """`seller_presence` for many sellers: cache hits first, then two queries
    for all the misses together (not two per seller)."""
    from src.auth.sessions import last_seen_by_account
    from src.chat.service import seller_reply_threads_by_seller

    presences: dict[int, dict] = {}
    missing: list[int] = []
    for seller_id in dict.fromkeys(seller_ids):
        cached = _presence_cache.get(seller_id)
        if cached is not None:
            presences[seller_id] = cached
        else:
            missing.append(seller_id)
    if missing:
        now = datetime.now(timezone.utc)
        threads = await seller_reply_threads_by_seller(missing, now - timedelta(days=30), db)
        seen = await last_seen_by_account(missing, db)
        for seller_id in missing:
            presence = {
                "response_time": response_band(threads.get(seller_id, []), now),
                "active_within": active_band(seen.get(seller_id), now),
            }
            _presence_cache.set(seller_id, presence)
            presences[seller_id] = presence
    return presences


async def search_sellers(db: AsyncSession, query: str, *, limit: int = 4) -> list[dict]:
    """Ranked public seller cards whose approved business name matches.

    Only shops that are active, hold the seller role and currently list at
    least one active product are visible — the same set ``/sellers/top``
    draws from, so search never reveals dormant or unapproved accounts.
    Emails are never searched. Uses the trigram index on
    ``immutable_unaccent(lower(business_name))``.
    """
    query = normalize_query(query)
    if not query:
        return []
    terms = search_terms(query)
    corpus = func.immutable_unaccent(func.lower(SellerApplication.business_name))
    has_active_product = exists().where(
        Product.seller_id == Account.id, Product.status == ProductStatus.active,
    )
    stmt = (
        select(SellerApplication.account_id, SellerApplication.created_at)
        .join(Account, Account.id == SellerApplication.account_id)
        .where(
            SellerApplication.status == ApplicationStatus.approved,
            Account.is_active == True,  # noqa: E712
            Account.roles.any("seller"),
            has_active_product,
            terms.match(corpus),
        )
        .order_by(
            terms.rank(corpus).asc(),
            terms.similarity(corpus).desc(),
            SellerApplication.created_at.desc(),
        )
        .limit(limit * 3)
    )
    ordered_ids: list[int] = []
    for account_id, _ in (await db.execute(stmt)).all():
        if account_id not in ordered_ids:
            ordered_ids.append(account_id)
        if len(ordered_ids) >= limit:
            break
    return await _build_seller_summaries(ordered_ids, db)
