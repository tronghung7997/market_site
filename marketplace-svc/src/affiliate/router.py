from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account
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
