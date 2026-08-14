from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
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


@router.patch("/admin/money-config", response_model=schemas.MoneyConfigUpdateResponse)
async def update_money_config(
    body: schemas.MoneyConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_config(
        db,
        actor_id=admin.id,
        display_fx_rate=body.display_fx_rate,
        display_currency_default=body.display_currency_default,
        allow_user_toggle=body.allow_user_toggle,
        allow_locale_toggle=body.allow_locale_toggle,
        show_fx_hints=body.show_fx_hints,
    )


@router.post("/admin/money-config/reset-to-env", response_model=schemas.MoneyConfigUpdateResponse)
async def reset_money_config_to_env(
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.reset_to_env(db, actor_id=admin.id)
