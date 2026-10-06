from datetime import datetime, timedelta, timezone

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.i18n.search_text import normalize_query, search_terms
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


def _seller_ref_filter(raw: str):
    """WHERE clause on ``accounts`` for a route param: ``{handle}-{key}``,
    bare key, or a legacy integer id. None when the ref is unparseable."""
    parsed = parse_public_ref(raw)
    if parsed is None:
        return None
    kind, value = parsed
    return Account.id == value if kind == "id" else Account.public_key == value


async def resolve_seller_id(raw: str, db: AsyncSession) -> int | None:
    """Seller account id for a route param: ``{handle}-{key}``, bare key, or a
    legacy integer id. None when unparseable, unknown, or not a seller."""
    clause = _seller_ref_filter(raw)
    if clause is None:
        return None
    return await db.scalar(select(Account.id).where(clause, Account.roles.any("seller")))


def _summary_statement(account_ids, *, profile: bool = False):
    """One row per seller in ``account_ids`` (a one-column select of account
    ids) with everything a public seller card needs: completed orders, product
    rating totals and the latest approved application (name, logo, banner;
    bio, roles and join date for the profile). Each part is the same grouped
    query as a separate lookup would be, bounded by the same id set, so the
    statement count does not grow with the number of sellers."""
    ids = account_ids.cte("seller_ids")
    completed = (
        select(Order.seller_id, func.count(Order.id).label("n"))
        .where(Order.seller_id.in_(select(ids.c.id)), Order.status == OrderStatus.completed)
        .group_by(Order.seller_id)
        .subquery("seller_completed")
    )
    rating = (
        select(
            Product.seller_id,
            func.sum(Product.rating_avg * Product.rating_count).label("rating_sum"),
            func.sum(Product.rating_count).label("rating_count"),
        )
        .where(Product.seller_id.in_(select(ids.c.id)), Product.rating_count > 0)
        .group_by(Product.seller_id)
        .subquery("seller_rating")
    )
    application_columns = [
        SellerApplication.account_id, SellerApplication.business_name, SellerApplication.logo, SellerApplication.banner,
    ]
    if profile:
        application_columns.append(SellerApplication.description)
    # Latest approved application per seller.
    application = (
        select(*application_columns)
        .where(
            SellerApplication.account_id.in_(select(ids.c.id)),
            SellerApplication.status == ApplicationStatus.approved,
        )
        .distinct(SellerApplication.account_id)
        .order_by(SellerApplication.account_id, SellerApplication.created_at.desc())
        .subquery("seller_application")
    )
    columns = [
        Account.id, Account.email, Account.seller_tier, Account.public_key,
        completed.c.n.label("completed_order_count"),
        rating.c.rating_sum, rating.c.rating_count,
        application.c.business_name, application.c.logo, application.c.banner,
    ]
    if profile:
        columns += [Account.roles, Account.created_at, application.c.description]
    return (
        select(*columns)
        .select_from(Account)
        .outerjoin(completed, completed.c.seller_id == Account.id)
        .outerjoin(rating, rating.c.seller_id == Account.id)
        .outerjoin(application, application.c.account_id == Account.id)
        .where(Account.id.in_(select(ids.c.id)))
        .order_by(Account.id)
    )


def _summary_from_row(row, tier_rules: dict) -> dict:
    business_name = row.business_name
    tier = row.seller_tier.value
    rating_count = row.rating_count or 0
    # No account_id on the wire: the public key is the seller's only public handle.
    return {
        **seller_public_ref(row.public_key, business_name),
        "display_name": business_name or row.email.split("@", 1)[0],
        "business_name": business_name,
        "completed_order_count": row.completed_order_count or 0,
        "rating_avg": round(row.rating_sum / rating_count, 2) if rating_count else None,
        "review_count": rating_count,
        "seller_tier": tier,
        "tier_badge": getattr(tier_rules.get(tier), "badge", None),
        "logo": public_image(row.logo),
        "banner": public_image(row.banner),
    }


async def _seller_summaries_by_id(account_ids, db: AsyncSession) -> dict[int, dict]:
    rows = (await db.execute(_summary_statement(account_ids))).all()
    if not rows:
        return {}
    tier_rules = await get_tier_rules(db)
    return {row.id: _summary_from_row(row, tier_rules) for row in rows}


async def _build_seller_summaries(seller_ids: list[int], db: AsyncSession) -> list[dict]:
    """Public cards for ``seller_ids`` in that order (unknown ids are skipped)."""
    if not seller_ids:
        return []
    summaries = await _seller_summaries_by_id(select(Account.id).where(Account.id.in_(seller_ids)), db)
    return [summaries[seller_id] for seller_id in seller_ids if seller_id in summaries]


async def get_top_sellers(db: AsyncSession, limit: int = 6, *, locale: str = "vi") -> list[dict]:
    """Best shops by completed orders, each with its reply speed and the
    category it sells most in — what a buyer compares before opening a shop."""
    from src.i18n.catalog import resolve_category_fields
    from src.models.category import Category

    selling = select(Product.seller_id.label("id")).where(Product.status == ProductStatus.active).distinct()
    summaries = await _seller_summaries_by_id(selling, db)
    ranked = sorted(
        summaries.items(), key=lambda item: (item[1]["completed_order_count"], item[1]["rating_avg"] or 0),
        reverse=True,
    )[:limit]
    top_ids = [seller_id for seller_id, _ in ranked]
    if not top_ids:
        return []
    # The category each shop lists most active products in (ties: lowest id).
    counts = (
        select(Product.seller_id, Product.category_id, func.count(Product.id).label("n"))
        .where(Product.seller_id.in_(top_ids), Product.status == ProductStatus.active)
        .group_by(Product.seller_id, Product.category_id)
        .subquery()
    )
    main_category = {
        seller_id: category
        for seller_id, category in (await db.execute(
            select(counts.c.seller_id, Category)
            .join(Category, Category.id == counts.c.category_id)
            .distinct(counts.c.seller_id)
            .order_by(counts.c.seller_id, counts.c.n.desc(), counts.c.category_id)
        )).all()
    }
    presences = await seller_presences(top_ids, db)
    top = []
    for seller_id, summary in ranked:
        category = main_category.get(seller_id)
        summary["response_time"] = presences[seller_id]["response_time"]
        summary["main_category"] = (
            {"name": resolve_category_fields(category, locale)["name"], "slug": category.slug}
            if category else None
        )
        top.append(summary)
    return top


async def get_seller_profile(seller_ref: str, db: AsyncSession) -> dict | None:
    """Public shop profile for a route param (``{handle}-{key}``, bare key or
    legacy id); None when it names no seller. The card, bio and join date
    come from one statement; reply speed and trust bands are process-cached."""
    from src.sellers.trust import public_trust

    clause = _seller_ref_filter(seller_ref)
    if clause is None:
        return None
    row = (await db.execute(_summary_statement(select(Account.id).where(clause), profile=True))).first()
    if row is None or "seller" not in (row.roles or []):
        return None
    summary = _summary_from_row(row, await get_tier_rules(db))
    presence = await seller_presence(row.id, db)
    trust = await public_trust(row.id, db)
    return {**summary, "bio": row.description, "member_since": row.created_at, **presence, **trust}


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
