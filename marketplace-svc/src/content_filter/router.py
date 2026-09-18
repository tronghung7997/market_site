from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas
from .service import get_config, screen, update_config

router = APIRouter(tags=["content-filter"])


@router.get("/admin/content-filter", response_model=schemas.ContentFilterConfigResponse)
async def admin_get_content_filter(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await get_config(db)


@router.patch("/admin/content-filter", response_model=schemas.ContentFilterConfigResponse)
async def admin_update_content_filter(
    body: schemas.ContentFilterConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await update_config(db, actor_id=admin.id, **body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/admin/content-filter/test", response_model=schemas.ContentFilterTestResponse)
async def admin_test_content_filter(
    body: schemas.ContentFilterTestRequest,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Dry run for the settings page: shows what a message would become."""
    result = screen(body.text, await get_config(db))
    return {"blocked": result.blocked, "text": result.text, "matches": result.matches}
