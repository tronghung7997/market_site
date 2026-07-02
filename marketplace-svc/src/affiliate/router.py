from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["affiliate"])


@router.post("/affiliate/click", status_code=status.HTTP_204_NO_CONTENT)
async def click(body: schemas.ClickRequest, db: AsyncSession = Depends(get_session)):
    await service.record_click(body.code, db, path=body.path, referrer=body.referrer)
    return None


@router.get("/affiliate/me", response_model=schemas.AffiliateStatsResponse)
async def affiliate_me(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    return await service.get_affiliate_stats(account.id, db, date_from=date_from, date_to=date_to)


@router.get("/admin/affiliates", response_model=schemas.PaginatedAffiliateSummary)
async def admin_list_affiliates(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    return await service.list_affiliates_admin(db, search=search, page=page, per_page=per_page)


@router.get("/admin/affiliates/{account_id}", response_model=schemas.AffiliateStatsResponse)
async def admin_affiliate_detail(
    account_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return await service.get_affiliate_stats(account_id, db, date_from=date_from, date_to=date_to)


@router.patch("/admin/affiliates/{account_id}/code", response_model=schemas.AffiliateCodeResponse)
async def admin_update_affiliate_code(
    account_id: int,
    body: schemas.UpdateCodeRequest,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_affiliate_code(account_id, body.code, db)


@router.get("/admin/affiliate-fund", response_model=schemas.FundOverview)
async def admin_fund_overview(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.get_fund_overview(db)


@router.post("/admin/affiliate-fund/topup", response_model=schemas.FundOverview)
async def admin_fund_topup(
    body: schemas.FundTopupRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.topup_fund(body.amount, admin.id, db, note=body.note)
