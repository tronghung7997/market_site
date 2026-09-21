from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account
from src.sellers.tier_config import get_tier_rules, update_tier_rules
from src.sellers.tiers import TIER_ORDER

router = APIRouter(tags=["seller-tiers"])


class TierRuleResponse(BaseModel):
    tier: str
    max_active_products: int | None
    withdraw_limit_per_request: int | None
    fee_discount_pp: int
    escrow_reduction_days: int
    updated_at: str | None = None
    updated_by_id: int | None = None


class TierRulePatch(BaseModel):
    """A field left out is untouched; a limit sent as null becomes unlimited."""
    max_active_products: int | None = Field(default=None, ge=0)
    withdraw_limit_per_request: int | None = Field(default=None, ge=0)
    fee_discount_pp: int | None = Field(default=None, ge=0, le=100)
    escrow_reduction_days: int | None = Field(default=None, ge=0, le=90)


class TierRulesUpdate(BaseModel):
    tiers: dict[str, TierRulePatch]


class TierRulesResponse(BaseModel):
    tiers: list[TierRuleResponse]


def _payload(rules) -> dict:
    return {"tiers": [asdict(rules[t]) for t in TIER_ORDER if t in rules]}


@router.get("/admin/seller-tier-config", response_model=TierRulesResponse)
async def admin_seller_tier_config(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return _payload(await get_tier_rules(db))


@router.patch("/admin/seller-tier-config", response_model=TierRulesResponse)
async def admin_update_seller_tier_config(
    body: TierRulesUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    # exclude_unset keeps "not sent" apart from "sent as null" (= clear the limit).
    tiers = {t: p.model_dump(exclude_unset=True) for t, p in body.tiers.items()}
    try:
        return _payload(await update_tier_rules(db, actor_id=admin.id, tiers=tiers))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/public/seller-tiers", response_model=TierRulesResponse)
async def public_seller_tiers(db: AsyncSession = Depends(get_session)):
    """What each tier gets — shown to sellers so the cap never surprises them."""
    return _payload(await get_tier_rules(db))
