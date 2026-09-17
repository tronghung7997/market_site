"""Storefront search orchestration: typeahead + results page.

Owns nothing persistent. It composes the owning features' search interfaces
(``products.service.suggest_products`` / ``list_products``,
``categories.service.search_categories``, ``sellers.service.search_sellers``)
and adds the cross-cutting guarantees a public, unauthenticated endpoint
needs so the backend can never be "stuck" on a search:

- one normalised query string (``src.i18n.search_text.normalize_query``);
- a per-request ``statement_timeout`` so a pathological query is cancelled
  by PostgreSQL instead of holding a pool connection;
- a bounded process-local cache keyed by locale + query, so bursts of the
  same keystrokes (and hot queries across users) never reach the database;
- group-specific minimum lengths: one character is enough to match a
  category name, products and sellers need two so a single letter does not
  fan out into a random page of the catalog;
- the synonym snapshot (``search_synonyms``) is refreshed here so every
  corpus sees the same expansions;
- every results-page query (and every zero-hit suggestion) is appended to
  ``search_query_log`` in a detached task, so the request never waits on it.

Read-only on the request session: nothing here commits.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import case, delete, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from src.categories.service import search_categories
from src.database import SessionLocal
from src.i18n.catalog import DEFAULT_LOCALE
from src.i18n.search_text import fold, normalize_query, set_synonyms
from src.models.search import SearchQueryLog, SearchSynonym
from src.products.service import list_products, suggest_products
from src.runtime_config import KeyedProcessCache
from src.sellers.service import search_sellers

logger = structlog.get_logger()

STATEMENT_TIMEOUT_MS = 400
MIN_CHARS_PRODUCTS = 2
MIN_CHARS_SELLERS = 2

SUGGEST_PRODUCT_LIMIT = 6
SUGGEST_CATEGORY_LIMIT = 4
SUGGEST_SELLER_LIMIT = 3
PAGE_CATEGORY_LIMIT = 6
PAGE_SELLER_LIMIT = 4

_PG_QUERY_CANCELED = "57014"
SYNONYMS_TTL_SECONDS = 60.0
LOG_MIN_CHARS = 3

_suggest_cache: KeyedProcessCache[tuple, dict] = KeyedProcessCache(
    "search_suggest", ttl_seconds=20, max_entries=2000,
)
_page_cache: KeyedProcessCache[tuple, dict] = KeyedProcessCache(
    "search_page", ttl_seconds=10, max_entries=500,
)


class SearchTimeout(Exception):
    """PostgreSQL cancelled the search after ``STATEMENT_TIMEOUT_MS``."""


_synonyms_loaded_at = 0.0


async def refresh_synonyms(db: AsyncSession, *, force: bool = False) -> None:
    """Load ``search_synonyms`` into the process snapshot at most every
    ``SYNONYMS_TTL_SECONDS``; a failed load keeps the previous snapshot."""
    global _synonyms_loaded_at
    now = time.monotonic()
    if not force and now - _synonyms_loaded_at < SYNONYMS_TTL_SECONDS:
        return
    rows = (await db.execute(select(SearchSynonym.group_key, SearchSynonym.term))).all()
    groups: dict[str, list[str]] = defaultdict(list)
    for group_key, term in rows:
        folded = fold(normalize_query(term))
        if folded and folded not in groups[group_key]:
            groups[group_key].append(folded)
    mapping: dict[str, tuple[str, ...]] = {}
    for terms in groups.values():
        alternatives = tuple(terms)
        for term in terms:
            mapping[term] = alternatives
    set_synonyms(mapping)
    _synonyms_loaded_at = now


def reset_synonyms_snapshot() -> None:
    """Forget the loaded synonyms so the next search reloads them (tests)."""
    global _synonyms_loaded_at
    set_synonyms({})
    _synonyms_loaded_at = 0.0


async def _write_query_log(kind: str, query: str, locale: str, result_count: int) -> None:
    try:
        async with SessionLocal() as db:
            db.add(SearchQueryLog(query=query, locale=locale, kind=kind, result_count=result_count))
            await db.commit()
    except Exception:  # noqa: BLE001 — logging must never surface to the user
        logger.warning("search_query_log_failed", kind=kind)


def _log_query(kind: str, query: str, locale: str, result_count: int) -> None:
    if len(query) < LOG_MIN_CHARS:
        return
    asyncio.create_task(_write_query_log(kind, query, locale, result_count))


def _is_query_canceled(exc: BaseException) -> bool:
    node: BaseException | None = exc
    while node is not None:
        if getattr(node, "pgcode", None) == _PG_QUERY_CANCELED or getattr(node, "sqlstate", None) == _PG_QUERY_CANCELED:
            return True
        node = node.__cause__ or getattr(node, "orig", None)
    return False


async def _arm_timeout(db: AsyncSession) -> None:
    # SET LOCAL scopes the limit to this request's transaction; the pooled
    # connection returns to its default once the session closes.
    await db.execute(text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"))


def _empty_suggest(query: str) -> dict:
    return {"query": query, "products": [], "categories": [], "sellers": []}


async def suggest(db: AsyncSession, raw_query: str | None, *, locale: str = DEFAULT_LOCALE) -> dict:
    query = normalize_query(raw_query)
    if not query:
        return _empty_suggest("")
    key = (locale, query.casefold())
    cached = _suggest_cache.get(key)
    if cached is not None:
        return cached
    try:
        await refresh_synonyms(db)
        await _arm_timeout(db)
        categories = await search_categories(db, query, locale=locale, limit=SUGGEST_CATEGORY_LIMIT)
        products = (
            await suggest_products(db, query, locale=locale, limit=SUGGEST_PRODUCT_LIMIT)
            if len(query) >= MIN_CHARS_PRODUCTS else []
        )
        sellers = (
            await search_sellers(db, query, limit=SUGGEST_SELLER_LIMIT)
            if len(query) >= MIN_CHARS_SELLERS else []
        )
    except DBAPIError as exc:
        if _is_query_canceled(exc):
            raise SearchTimeout() from exc
        raise
    result = {"query": query, "products": products, "categories": categories, "sellers": sellers}
    _suggest_cache.set(key, result)
    if not products and not categories and not sellers:
        _log_query("suggest", query, locale, 0)
    return result


async def search(
    db: AsyncSession,
    raw_query: str | None,
    *,
    locale: str = DEFAULT_LOCALE,
    page: int = 1,
    per_page: int = 24,
    sort: str = "relevance",
    category_id: int | None = None,
    in_stock: bool = False,
    fulfillment: str | None = None,
    min_price: int | None = None,
    max_price: int | None = None,
) -> dict:
    query = normalize_query(raw_query)
    if not query:
        return {
            "query": "",
            "products": {"items": [], "total": 0, "page": page, "per_page": per_page},
            "categories": [],
            "sellers": [],
        }
    key = (locale, query.casefold(), page, per_page, sort, category_id, in_stock, fulfillment, min_price, max_price)
    cached = _page_cache.get(key)
    if cached is not None:
        if page == 1:
            _log_query("page", query, locale, int(cached["products"].get("total", 0)))
        return cached
    try:
        await refresh_synonyms(db)
        await _arm_timeout(db)
        products = await list_products(
            db,
            category_id=category_id,
            search=query,
            in_stock=in_stock,
            fulfillment=fulfillment,
            min_price=min_price,
            max_price=max_price,
            sort=sort,
            page=page,
            per_page=per_page,
            locale=locale,
        )
        first_page = page == 1
        categories = await search_categories(db, query, locale=locale, limit=PAGE_CATEGORY_LIMIT) if first_page else []
        sellers = (
            await search_sellers(db, query, limit=PAGE_SELLER_LIMIT)
            if first_page and len(query) >= MIN_CHARS_SELLERS else []
        )
    except DBAPIError as exc:
        if _is_query_canceled(exc):
            raise SearchTimeout() from exc
        raise
    result = {"query": query, "products": products, "categories": categories, "sellers": sellers}
    _page_cache.set(key, result)
    if first_page:
        _log_query("page", query, locale, int(products.get("total", 0)))
    return result


# --- admin: what people search for, and the synonym groups ------------------

QUERY_STATS_MAX_DAYS = 90


async def query_stats(db: AsyncSession, *, days: int = 30, limit: int = 50, zero_only: bool = False) -> dict:
    """Distinct results-page queries over the window, most searched first."""
    days = max(1, min(days, QUERY_STATS_MAX_DAYS))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    folded = func.lower(SearchQueryLog.query)
    zero = func.sum(case((SearchQueryLog.result_count == 0, 1), else_=0))
    stmt = (
        select(
            func.min(SearchQueryLog.query).label("query"),
            func.count().label("searches"),
            zero.label("zero_results"),
            func.max(SearchQueryLog.created_at).label("last_searched_at"),
        )
        .where(SearchQueryLog.kind == "page", SearchQueryLog.created_at >= since)
        .group_by(folded)
    )
    if zero_only:
        stmt = stmt.having(zero == func.count())
    stmt = stmt.order_by(func.count().desc(), func.max(SearchQueryLog.created_at).desc()).limit(limit)
    rows = (await db.execute(stmt)).all()
    return {
        "days": days,
        "items": [
            {
                "query": row.query,
                "searches": int(row.searches),
                "zero_results": int(row.zero_results or 0),
                "last_searched_at": row.last_searched_at,
            }
            for row in rows
        ],
    }


async def list_synonyms(db: AsyncSession) -> dict:
    rows = (
        await db.execute(
            select(SearchSynonym.group_key, SearchSynonym.term).order_by(SearchSynonym.group_key, SearchSynonym.id)
        )
    ).all()
    groups: dict[str, list[str]] = defaultdict(list)
    for group_key, term in rows:
        groups[group_key].append(term)
    return {"items": [{"group_key": key, "terms": terms} for key, terms in groups.items()]}


async def upsert_synonym_group(db: AsyncSession, group_key: str, terms: list[str]) -> dict:
    """Replace the group's terms. Terms are stored folded; a term already in
    another group moves to this one. Commits and refreshes the snapshot."""
    key = fold(normalize_query(group_key))
    folded_terms: list[str] = []
    for term in terms:
        value = fold(normalize_query(term))
        if value and value not in folded_terms:
            folded_terms.append(value)
    if not key or not folded_terms:
        raise ValueError("empty synonym group")
    await db.execute(delete(SearchSynonym).where(SearchSynonym.group_key == key))
    await db.execute(delete(SearchSynonym).where(SearchSynonym.term.in_(folded_terms)))
    for term in folded_terms:
        db.add(SearchSynonym(group_key=key, term=term))
    await db.commit()
    await refresh_synonyms(db, force=True)
    _suggest_cache.invalidate()
    _page_cache.invalidate()
    return {"group_key": key, "terms": folded_terms}


async def delete_synonym_group(db: AsyncSession, group_key: str) -> bool:
    key = fold(normalize_query(group_key))
    result = await db.execute(delete(SearchSynonym).where(SearchSynonym.group_key == key))
    await db.commit()
    await refresh_synonyms(db, force=True)
    _suggest_cache.invalidate()
    _page_cache.invalidate()
    return bool(result.rowcount)
