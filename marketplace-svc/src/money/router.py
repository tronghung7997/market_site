from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.config_approval.http import change_reason, respond
from src.config_approval.schemas import ConfigChangeQueued
from src.config_approval.service import submit_change
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["money"])


@router.get("/public/money-config", response_model=schemas.MoneyConfigPublic)
async def public_money_config(db: AsyncSession = Depends(get_session)):
    """Unauthenticated — FE CurrencyProvider fetches once per session."""
    return await service.public_config(db)


@router.get("/admin/money-config", response_model=schemas.MoneyConfigAdmin)
async def admin_money_config(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.admin_config(db)


@router.patch("/admin/money-config", response_model=schemas.MoneyConfigUpdateResponse, responses={202: {"model": ConfigChangeQueued}})
async def update_money_config(
    body: schemas.MoneyConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    reason: str | None = Depends(change_reason),
):
    """Applies at once only with CONFIG_APPROVAL_REQUIRED off; otherwise 202 + a
    request a second admin approves (src/config_approval)."""
    outcome = await submit_change(
        db, "money_config", actor_id=admin.id, payload=body.model_dump(mode="json", exclude_unset=True), reason=reason,
    )
    return respond(outcome, outcome.result if outcome.result is not None else await service.admin_config(db))


@router.post("/admin/money-config/reset-to-env", response_model=schemas.MoneyConfigUpdateResponse, responses={202: {"model": ConfigChangeQueued}})
async def reset_money_config_to_env(
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    reason: str | None = Depends(change_reason),
):
    """Same as a PATCH of the env FX rate — goes through approval like one."""
    outcome = await submit_change(
        db, "money_config", actor_id=admin.id, payload=service.env_reset_payload(), reason=reason,
    )
    return respond(outcome, outcome.result if outcome.result is not None else await service.admin_config(db))
