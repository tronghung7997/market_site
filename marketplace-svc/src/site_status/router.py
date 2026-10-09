from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.config_approval.http import change_reason, respond
from src.config_approval.schemas import ConfigChangeQueued
from src.config_approval.service import submit_change
from src.database import get_session
from src.models.account import Account

from . import schemas
from .html import sanitize_announcement_html
from .service import get_site_status, public_view

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


@router.patch("/admin/site-status", response_model=schemas.SiteStatusAdmin, responses={202: {"model": ConfigChangeQueued}})
async def admin_update_site_status(
    body: schemas.SiteStatusUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    reason: str | None = Depends(change_reason),
):
    """Maintenance mode and the money freezes always apply at once (emergency
    path, audit-flagged); announcement and upload-cap changes wait for a second
    admin while CONFIG_APPROVAL_REQUIRED is on (202 + the request)."""
    try:
        outcome = await submit_change(
            db, "site_status", actor_id=admin.id, payload=body.model_dump(mode="json", exclude_unset=True), reason=reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return respond(outcome, outcome.result if outcome.result is not None else await get_site_status(db))


@router.post("/admin/site-status/announcement-preview", response_model=schemas.AnnouncementPreviewResponse)
async def admin_announcement_preview(
    body: schemas.AnnouncementPreviewRequest,
    _: Account = Depends(require_role("admin")),
):
    """The sanitized form of an HTML announcement, for the settings preview."""
    return {"html": sanitize_announcement_html(body.html)}
