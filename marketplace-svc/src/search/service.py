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
  fan out into a random page of the catalog.

Read-only: nothing here commits.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from src.categories.service import search_categories
from src.i18n.catalog import DEFAULT_LOCALE
from src.i18n.search_text import normalize_query
from src.products.service import list_products, suggest_products
from src.runtime_config import KeyedProcessCache
from src.sellers.service import search_sellers

STATEMENT_TIMEOUT_MS = 400
MIN_CHARS_PRODUCTS = 2
MIN_CHARS_SELLERS = 2

SUGGEST_PRODUCT_LIMIT = 6
SUGGEST_CATEGORY_LIMIT = 4
SUGGEST_SELLER_LIMIT = 3
PAGE_CATEGORY_LIMIT = 6
PAGE_SELLER_LIMIT = 4

_PG_QUERY_CANCELED = "57014"

_suggest_cache: KeyedProcessCache[tuple, dict] = KeyedProcessCache(
    "search_suggest", ttl_seconds=20, max_entries=2000,
)
_page_cache: KeyedProcessCache[tuple, dict] = KeyedProcessCache(
    "search_page", ttl_seconds=10, max_entries=500,
)


class SearchTimeout(Exception):
    """PostgreSQL cancelled the search after ``STATEMENT_TIMEOUT_MS``."""


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
        return cached
    try:
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
    return result
