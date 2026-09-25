from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.config import settings
from src.database import get_session
from src.exceptions import ErrorCode, api_error
from src.i18n.deps import get_request_locale
from src.i18n.search_text import MAX_QUERY_LENGTH
from src.models.account import Account
from src.rate_limit import check_rate_limit
from src.security.client_ip import request_client_ip

from . import schemas, service

router = APIRouter(tags=["search"])

_RATE_WINDOW_SECONDS = 60


async def _throttle(request: Request) -> None:
    """Per-IP fixed window; fails open so a Redis blip degrades to unthrottled
    search rather than a dead search box (the statement timeout still bounds
    database work)."""
    allowed = await check_rate_limit(
        f"search:{request_client_ip(request)}",
        limit=settings.search_ip_rate_limit,
        window_seconds=_RATE_WINDOW_SECONDS,
    )
    if not allowed:
        raise api_error(
            ErrorCode.RATE_LIMITED,
            status.HTTP_429_TOO_MANY_REQUESTS,
            headers={"Retry-After": str(_RATE_WINDOW_SECONDS)},
        )


@router.get("/search/suggest", response_model=schemas.SearchSuggestResponse)
async def search_suggest(
    request: Request,
    q: str = Query("", max_length=MAX_QUERY_LENGTH),
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    """Typeahead for the header search / command palette."""
    await _throttle(request)
    try:
        return await service.suggest(db, q, locale=locale)
    except service.SearchTimeout:
        raise api_error(ErrorCode.SEARCH_TIMEOUT, status.HTTP_504_GATEWAY_TIMEOUT)


@router.get("/search", response_model=schemas.SearchResponse)
async def search_page(
    request: Request,
    q: str = Query("", max_length=MAX_QUERY_LENGTH),
    category_id: int | None = Query(None),
    in_stock: bool = Query(False),
    fulfillment: Literal["instant"] | None = Query(None),
    min_price: int | None = Query(None, ge=0),
    max_price: int | None = Query(None, ge=0),
    sort: Literal["relevance", "newest", "bestseller", "rating", "price_asc", "price_desc"] = Query("relevance"),
    page: int = Query(1, ge=1),
    per_page: int = Query(24, ge=1, le=60),
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    """Results page: ranked, filterable, paginated products plus the top
    category and seller matches."""
    await _throttle(request)
    try:
        return await service.search(
            db,
            q,
            locale=locale,
            page=page,
            per_page=per_page,
            sort=sort,
            category_id=category_id,
            in_stock=in_stock,
            fulfillment=fulfillment,
            min_price=min_price,
            max_price=max_price,
        )
    except service.SearchTimeout:
        raise api_error(ErrorCode.SEARCH_TIMEOUT, status.HTTP_504_GATEWAY_TIMEOUT)


@router.get("/admin/search/queries", response_model=schemas.SearchQueryStatsResponse)
async def admin_search_queries(
    days: int = Query(30, ge=1, le=service.QUERY_STATS_MAX_DAYS),
    limit: int = Query(50, ge=1, le=200),
    zero_only: bool = Query(False),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """What people searched for on the results page, most frequent first."""
    return await service.query_stats(db, days=days, limit=limit, zero_only=zero_only)


@router.get("/admin/search/synonyms", response_model=schemas.SearchSynonymsResponse)
async def admin_search_synonyms(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_synonyms(db)


@router.put("/admin/search/synonyms", response_model=schemas.SearchSynonymGroup)
async def admin_upsert_synonym_group(
    body: schemas.SearchSynonymGroupUpsert,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.upsert_synonym_group(db, body.group_key, body.terms)
    except ValueError:
        raise api_error(ErrorCode.SEARCH_SYNONYM_INVALID, status.HTTP_422_UNPROCESSABLE_ENTITY)


@router.delete("/admin/search/synonyms/{group_key}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_synonym_group(
    group_key: str,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    if not await service.delete_synonym_group(db, group_key):
        raise api_error(ErrorCode.SEARCH_SYNONYM_NOT_FOUND, status.HTTP_404_NOT_FOUND)
