from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_session
from src.exceptions import ErrorCode, api_error
from src.i18n.deps import get_request_locale
from src.i18n.search_text import MAX_QUERY_LENGTH
from src.rate_limit import check_rate_limit
from src.security.client_ip import client_ip

from . import schemas, service

router = APIRouter(tags=["search"])

_RATE_WINDOW_SECONDS = 60


async def _throttle(request: Request) -> None:
    """Per-IP fixed window; fails open so a Redis blip degrades to unthrottled
    search rather than a dead search box (the statement timeout still bounds
    database work)."""
    allowed = await check_rate_limit(
        f"search:{client_ip(request)}",
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
