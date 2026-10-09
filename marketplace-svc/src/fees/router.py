from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.config_approval.http import change_reason, respond
from src.config_approval.schemas import ConfigChangeQueued
from src.config_approval.service import submit_change
from src.database import get_session
from src.models.account import Account

from . import schemas
from .service import withdraw_quote
from .settings import get_fee_settings, platform_account_candidates

router = APIRouter(tags=["fees"])

_PUBLIC_KEYS = (
    "platform_fee_percent", "category_fee_percent", "escrow_default_hours", "escrow_floor_hours", "escrow_min_hours",
    "category_escrow_min_hours", "withdraw_min_amount", "withdraw_fee_fixed", "withdraw_fee_percent",
    "dispute_seller_response_hours", "dispute_open_window_hours", "dispute_evidence_image_required",
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
    return {**await get_fee_settings(db), "platform_account_candidates": await platform_account_candidates(db)}


@router.patch("/admin/fee-config", response_model=schemas.FeeRuntimeConfigResponse, responses={202: {"model": ConfigChangeQueued}})
async def admin_update_fee_config(
    body: schemas.FeeRuntimeConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    reason: str | None = Depends(change_reason),
):
    """Applies at once only with CONFIG_APPROVAL_REQUIRED off; otherwise 202 + a
    request a second admin approves (src/config_approval)."""
    try:
        outcome = await submit_change(
            db, "fee_config", actor_id=admin.id, payload=body.model_dump(mode="json", exclude_unset=True), reason=reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    cfg = outcome.result if outcome.result is not None else await get_fee_settings(db)
    return respond(outcome, {**cfg, "platform_account_candidates": await platform_account_candidates(db)})
