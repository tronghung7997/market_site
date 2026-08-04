from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account
from src.models.service_task import ServiceTaskStatus

from . import schemas, service

router = APIRouter(tags=["tasks"])


def _to_response(task, order_status: str | None) -> schemas.TaskResponse:
    resp = schemas.TaskResponse.model_validate(task)
    resp.order_status = order_status
    return resp


@router.get("/admin/tasks", response_model=list[schemas.TaskResponse])
async def list_tasks(
    status: ServiceTaskStatus | None = Query(None),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    rows = await service.list_tasks(db, status=status)
    return [_to_response(task, order_status) for task, order_status in rows]


@router.put("/admin/tasks/{task_id}", response_model=schemas.TaskResponse)
async def update_task(
    task_id: int,
    body: schemas.TaskUpdateRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    updates = body.model_dump(exclude_unset=True)
    task, order_status = await service.update_task(task_id, updates, db, actor_id=admin.id)
    return _to_response(task, order_status)
