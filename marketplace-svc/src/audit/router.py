from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["audit"])


@router.get("/admin/logs", response_model=list[schemas.LogEntryResponse])
async def list_logs(
    request_id: str | None = None,
    job_id: str | None = None,
    order_id: int | None = None,
    level: str | None = None,
    limit: int = Query(100, ge=1, le=200),
    since: datetime | None = None,
    until: datetime | None = None,
    before_id: int | None = Query(None, ge=1),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.query_logs(
        db,
        request_id=request_id,
        job_id=job_id,
        order_id=order_id,
        level=level,
        limit=limit,
        since=since,
        until=until,
        before_id=before_id,
    )
