from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.buyer_tiers import config, service
from src.config_approval.http import change_reason, respond
from src.config_approval.schemas import ConfigChangeQueued
from src.config_approval.service import submit_change
from src.database import get_session
from src.models.account import Account

router = APIRouter(tags=["buyer-tiers"])


class BuyerLevel(BaseModel):
    tier: str
    name_vi: str
    name_en: str
    min_amount: int
    cashback_percent: float
    # None: no per-key limit (the per-IP flood guard still applies).
    api_requests_per_minute: int | None
    api_orders_per_minute: int | None


class BuyerTiersPublic(BaseModel):
    criterion: str
    levels: list[BuyerLevel]


class BuyerTierHistoryRow(BaseModel):
    old_tier: str
    new_tier: str
    reason: str | None
    created_at: datetime


class BuyerTierProgress(BaseModel):
    tier: str
    criterion: str
    value: int
    reached_tier: str
    next_tier: str | None
    next_min_amount: int | None
    current: BuyerLevel
    levels: list[BuyerLevel]
    cashback_total: int
    history: list[BuyerTierHistoryRow]


@router.get("/public/buyer-tiers", response_model=BuyerTiersPublic)
async def public_buyer_tiers(db: AsyncSession = Depends(get_session)):
    cfg = await config.get_config(db)
    return {"criterion": cfg["criterion"], "levels": service.public_levels(cfg)}


@router.get("/account/buyer-tier", response_model=BuyerTierProgress)
async def my_buyer_tier(
    account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session),
):
    """The signed-in account's buyer tier, its figure and the next threshold."""
    return await service.buyer_progress(account, db)


@router.get("/admin/accounts/{account_id}/buyer-tier", response_model=BuyerTierProgress)
async def admin_buyer_tier(
    account_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
):
    account = await db.get(Account, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    return await service.buyer_progress(account, db)


@router.get("/admin/buyer-tier-config")
async def admin_buyer_tier_config(
    _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
) -> dict:
    return await config.get_config(db)


@router.put("/admin/buyer-tier-config", responses={202: {"model": ConfigChangeQueued}})
async def admin_update_buyer_tier_config(
    body: dict, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
    reason: str | None = Depends(change_reason),
):
    """Applies at once only with CONFIG_APPROVAL_REQUIRED off; otherwise 202 + a
    request a second admin approves (src/config_approval)."""
    body.pop("change_reason", None)
    try:
        # Validated up front so a malformed document is a 422 either way.
        payload = config.validate_config(body)
        outcome = await submit_change(db, "buyer_tier_config", actor_id=admin.id, payload=payload, reason=reason)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return respond(outcome, outcome.result if outcome.result is not None else await config.get_config(db))
