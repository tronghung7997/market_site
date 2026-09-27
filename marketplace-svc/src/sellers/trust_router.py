from dataclasses import asdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account
from src.sellers import trust
from src.sellers.tier_config import get_tier_rules

router = APIRouter(tags=["seller-trust"])


class CriterionRow(BaseModel):
    key: str
    value: float | int | None
    target: float | int
    # None: the score criterion is skipped until there is enough data.
    met: bool | None
    keep: bool


class TierProgress(BaseModel):
    tier: str
    score: int | None
    score_parts: dict[str, float] | None
    score_points: dict[str, int]
    next_tier: str | None
    next_tier_promotable: bool
    criteria: list[CriterionRow]
    met: int
    eligible: bool
    at_risk: list[CriterionRow]
    window_days: int
    min_orders_for_score: int
    metrics: dict[str, int]
    # Levers of the current and next tier (seller_tier_config rows).
    current_rule: dict | None
    next_rule: dict | None


class ReviewRow(BaseModel):
    account_id: int
    public_key: str
    name: str
    tier: str
    score: int | None
    next_tier: str | None
    next_tier_promotable: bool
    criteria: list[CriterionRow]
    met: int
    eligible: bool
    at_risk: list[CriterionRow]
    orders_lifetime: int
    gmv_lifetime: int


class TierEvent(BaseModel):
    old_tier: str
    new_tier: str
    reason: str | None
    # Admin-only view: the acting admin's email, or None if that account is gone.
    actor_email: str | None
    created_at: datetime


class AdminTierDetail(TierProgress):
    # Demo orders the score leaves out (Order.is_seeded).
    seeded_orders: int
    history: list[TierEvent]


async def _progress_with_rules(account: Account, db: AsyncSession) -> dict:
    progress = await trust.seller_progress(account, db)
    rules = await get_tier_rules(db)
    current = rules.get(progress["tier"])
    upcoming = rules.get(progress["next_tier"]) if progress["next_tier"] else None
    return {
        **progress,
        "current_rule": asdict(current) if current else None,
        "next_rule": asdict(upcoming) if upcoming else None,
    }


@router.get("/seller/tier-progress", response_model=TierProgress)
async def seller_tier_progress(
    seller: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session),
):
    return await _progress_with_rules(seller, db)


@router.get("/admin/sellers/{account_id}/tier-detail", response_model=AdminTierDetail)
async def admin_seller_tier_detail(
    account_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
):
    """One seller's score, criteria and tier history, computed now."""
    seller = await db.get(Account, account_id)
    if seller is None or "seller" not in (seller.roles or []):
        raise HTTPException(status_code=404, detail="Không tìm thấy người bán")
    return {
        **await _progress_with_rules(seller, db),
        "seeded_orders": await trust.seeded_order_count(seller.id, db),
        "history": await trust.tier_history(seller.id, db),
    }


@router.get("/admin/seller-trust-config")
async def admin_trust_config(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)) -> dict:
    return await trust.get_config(db)


@router.put("/admin/seller-trust-config")
async def admin_update_trust_config(
    body: dict, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
) -> dict:
    try:
        return await trust.update_config(db, body, actor_id=admin.id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/admin/seller-tier-review", response_model=list[ReviewRow])
async def admin_tier_review(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    """Who meets the next tier's criteria and who slipped below their own."""
    return await trust.review_queue(db)
