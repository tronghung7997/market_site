from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas
from .service import get_site_status, public_view, update_site_status

router = APIRouter(tags=["site-status"])


@router.get("/public/site-status", response_model=schemas.SiteStatusPublic)
async def public_site_status(db: AsyncSession = Depends(get_session)):
    return public_view(await get_site_status(db))


@router.get("/admin/site-status", response_model=schemas.SiteStatusAdmin)
async def admin_site_status(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await get_site_status(db)


@router.patch("/admin/site-status", response_model=schemas.SiteStatusAdmin)
async def admin_update_site_status(
    body: schemas.SiteStatusUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    changes = body.model_dump(exclude_unset=True, exclude={"clear_maintenance_until", "clear_announcement_window"})
    try:
        return await update_site_status(
            db, actor_id=admin.id,
            clear_maintenance_until=body.clear_maintenance_until,
            clear_announcement_window=body.clear_announcement_window,
            **changes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
