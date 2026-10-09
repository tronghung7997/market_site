from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(prefix="/admin/config-changes", tags=["config-approval"])


@router.get("", response_model=schemas.ConfigChangeList)
async def list_config_changes(
    state: Literal["pending", "history", "all"] = "pending",
    section: str | None = Query(None, max_length=48),
    limit: int = Query(50, ge=1, le=200),
    before_id: int | None = Query(None, ge=1),
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_requests(
        db, viewer_id=admin.id, state=state, section=section, limit=limit, before_id=before_id,
    )


@router.get("/{request_id}", response_model=schemas.ConfigChangeRequestOut)
async def get_config_change(
    request_id: int, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
):
    return await service.get_request(db, request_id, viewer_id=admin.id)


@router.post("/{request_id}/approve", response_model=schemas.ConfigChangeRequestOut)
async def approve_config_change(
    request_id: int, body: schemas.ConfigChangeDecision,
    admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
):
    return await service.approve(db, request_id, admin_id=admin.id, note=body.note)


@router.post("/{request_id}/reject", response_model=schemas.ConfigChangeRequestOut)
async def reject_config_change(
    request_id: int, body: schemas.ConfigChangeDecision,
    admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
):
    return await service.reject(db, request_id, admin_id=admin.id, note=body.note)


@router.post("/{request_id}/cancel", response_model=schemas.ConfigChangeRequestOut)
async def cancel_config_change(
    request_id: int, body: schemas.ConfigChangeDecision,
    admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
):
    return await service.cancel(db, request_id, admin_id=admin.id, note=body.note)
