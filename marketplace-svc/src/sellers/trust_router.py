from dataclasses import asdict
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.config_approval.http import change_reason, respond
from src.config_approval.schemas import ConfigChangeQueued
from src.config_approval.service import submit_change
from src.database import get_session
from src.models.account import Account
from src.models.seller_fee_promo import SellerFeePromo
from src.models.seller_tier_state import SellerTierState
from src.sellers import fee_promo, tier_auto, trust
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
    # Automatic tier: admin lock, standing warning (grace) and the job switch.
    locked: bool = False
    at_risk_since: datetime | None = None
    at_risk_keys: list[str] | None = None
    grace_days: int = 14
    dispute_min_orders: int = 20
    auto_enabled: bool = True
    # Platform fee % the seller's sales settle at now (categories with their
    # own fee excepted), and the running/next fee promo if any.
    fee_percent: float
    fee_promo: dict | None = None


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
    locked: bool = False
    at_risk_since: datetime | None = None


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
    from src.fees.service import platform_fee_percent_for

    progress = await trust.seller_progress(account, db)
    rules = await get_tier_rules(db)
    current = rules.get(progress["tier"])
    upcoming = rules.get(progress["next_tier"]) if progress["next_tier"] else None
    cfg = await trust.get_config(db)
    state = await db.get(SellerTierState, account.id)
    promo = await db.get(SellerFeePromo, account.id)
    fee = 0.0 if account.is_internal else await platform_fee_percent_for(
        db, seller_tier=progress["tier"], category_id=None, seller_id=account.id,
    )
    return {
        **progress,
        "current_rule": asdict(current) if current else None,
        "next_rule": asdict(upcoming) if upcoming else None,
        "locked": bool(state and state.locked),
        "at_risk_since": state.at_risk_since if state else None,
        "at_risk_keys": state.at_risk_keys if state else None,
        "grace_days": cfg["auto"]["grace_days"],
        "dispute_min_orders": cfg["auto"]["dispute_min_orders"],
        "auto_enabled": cfg["auto"]["enabled"],
        "fee_percent": fee,
        "fee_promo": fee_promo.promo_dict(promo),
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


@router.put("/admin/seller-trust-config", responses={202: {"model": ConfigChangeQueued}})
async def admin_update_trust_config(
    body: dict, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
    reason: str | None = Depends(change_reason),
):
    """Applies at once only with CONFIG_APPROVAL_REQUIRED off; otherwise 202 + a
    request a second admin approves (src/config_approval)."""
    body.pop("change_reason", None)
    try:
        # Validated up front so a malformed document is a 422 either way.
        payload = trust.validate_config(body)
        outcome = await submit_change(db, "seller_trust_config", actor_id=admin.id, payload=payload, reason=reason)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return respond(outcome, outcome.result if outcome.result is not None else await trust.get_config(db))


@router.get("/admin/seller-tier-review", response_model=list[ReviewRow])
async def admin_tier_review(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    """Who meets the next tier's criteria and who slipped below their own."""
    return await trust.review_queue(db)


# ── automatic tier job, lock, fee promo (admin) ─────────────────────────────

class TierJobRun(BaseModel):
    # Preview: evaluate everyone, change nothing.
    dry_run: bool = True


@router.post("/admin/tier-job/run")
async def admin_run_tier_job(body: TierJobRun, admin: Account = Depends(require_role("admin"))) -> dict:
    """"Chạy xét hạng ngay" (or its preview). Same rules as the 03:00 run."""
    return await tier_auto.run_tier_job(dry_run=body.dry_run, actor_id=admin.id)


class TierLock(BaseModel):
    locked: bool


async def _seller_or_404(db: AsyncSession, account_id: int) -> Account:
    seller = await db.get(Account, account_id)
    if seller is None or "seller" not in (seller.roles or []):
        raise HTTPException(status_code=404, detail="Không tìm thấy người bán")
    return seller


@router.patch("/admin/sellers/{account_id}/tier-lock")
async def admin_set_tier_lock(
    account_id: int, body: TierLock, admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
) -> dict:
    await _seller_or_404(db, account_id)
    state = await tier_auto.set_tier_lock(db, account_id, locked=body.locked, actor_id=admin.id)
    await db.commit()
    return {"locked": state.locked}


class FeePromoGrant(BaseModel):
    fee_percent: float = Field(default=0, ge=0, le=100)
    # Length of the offer; ignored when ends_at is given.
    days: int | None = Field(default=None, ge=1, le=fee_promo.MAX_DAYS)
    ends_at: datetime | None = None
    # No end date: the seller's own fee until an admin changes or revokes it.
    open_ended: bool = False
    # Badge shown while the promo runs: verified (Pro) or trusted (Elite, blue tick).
    badge_tier: str | None = Field(default=None, pattern="^(verified|trusted)$")
    note: str | None = Field(default=None, max_length=500)


@router.put("/admin/sellers/{account_id}/fee-promo")
async def admin_grant_fee_promo(
    account_id: int, body: FeePromoGrant, admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
) -> dict:
    await _seller_or_404(db, account_id)
    try:
        return await fee_promo.grant_fee_promo(
            db, account_id=account_id, actor_id=admin.id, fee_percent=body.fee_percent, days=body.days,
            ends_at=body.ends_at, open_ended=body.open_ended, badge_tier=body.badge_tier, note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/admin/sellers/{account_id}/fee-promo", status_code=204)
async def admin_revoke_fee_promo(
    account_id: int, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
) -> None:
    await _seller_or_404(db, account_id)
    await fee_promo.revoke_fee_promo(db, account_id=account_id, actor_id=admin.id)
