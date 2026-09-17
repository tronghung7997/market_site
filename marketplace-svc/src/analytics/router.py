from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

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
