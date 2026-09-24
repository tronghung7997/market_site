from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import business, schemas, service

router = APIRouter(tags=["analytics"])


@router.get("/public/analytics-config", response_model=schemas.AnalyticsConfigPublic)
async def public_analytics_config(db: AsyncSession = Depends(get_session)):
    """Unauthenticated — the storefront layout reads it server-side to decide
    which third-party tags to render."""
    return await service.public_config(db)


@router.get("/admin/analytics-config", response_model=schemas.AnalyticsConfigAdmin)
async def admin_analytics_config(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.admin_config(db)


@router.patch("/admin/analytics-config", response_model=schemas.AnalyticsConfigAdmin)
async def update_analytics_config(
    body: schemas.AnalyticsConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_config(db, actor_id=admin.id, clarity_project_id=body.clarity_project_id)


@router.get("/admin/analytics/business", response_model=schemas.BusinessAnalytics)
async def business_analytics(
    range: str = Query("30d", pattern=business.RANGE_KEY_PATTERN),
    tz: str = Query("UTC", max_length=64),
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    granularity: str = Query("auto", pattern=business.GRANULARITY_PATTERN),
    compare: str = Query("previous", pattern=business.COMPARE_PATTERN),
    compare_from: date | None = Query(None),
    compare_to: date | None = Query(None),
    segment: str = Query("all", pattern=business.SEGMENT_PATTERN),
    seller_id: int | None = Query(None, ge=1),
    category_id: int | None = Query(None, ge=1),
    service_type: str | None = Query(None, max_length=50),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    rng = business.resolve_range(
        range, tz, from_date, to_date,
        granularity=granularity, compare=compare, compare_from=compare_from, compare_to=compare_to,
    )
    filters = business.Filters(
        segment=segment, seller_id=seller_id, category_id=category_id,
        service_type=(service_type or "").strip() or None,
    )
    return await business.get_business_analytics(rng, filters, db)


@router.get("/admin/analytics/business/filters", response_model=schemas.BusinessFilterOptions)
async def business_filter_options(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await business.get_filter_options(db)
