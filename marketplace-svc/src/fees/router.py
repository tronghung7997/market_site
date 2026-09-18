from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas
from .service import withdraw_quote
from .settings import get_fee_settings, update_fee_settings

router = APIRouter(tags=["fees"])

_PUBLIC_KEYS = (
    "platform_fee_percent", "category_fee_percent", "escrow_default_days", "escrow_min_days",
    "category_escrow_min_days", "withdraw_min_amount", "withdraw_fee_fixed", "withdraw_fee_percent",
    "dispute_seller_response_hours",
)


@router.get("/public/fee-config", response_model=schemas.PublicFeeConfig)
async def public_fee_config(db: AsyncSession = Depends(get_session)):
    cfg = await get_fee_settings(db)
    return {k: cfg[k] for k in _PUBLIC_KEYS}


@router.get("/wallet/withdraw-quote", response_model=schemas.WithdrawQuote)
async def quote(amount: int = Query(ge=0), _: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    """Fee and net payout for an amount the seller is about to request."""
    return await withdraw_quote(db, amount)


@router.get("/admin/fee-config", response_model=schemas.FeeRuntimeConfigResponse)
async def admin_fee_config(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await get_fee_settings(db)


@router.patch("/admin/fee-config", response_model=schemas.FeeRuntimeConfigResponse)
async def admin_update_fee_config(
    body: schemas.FeeRuntimeConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await update_fee_settings(db, actor_id=admin.id, **body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
