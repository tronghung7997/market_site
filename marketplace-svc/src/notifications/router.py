from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["notifications"])


@router.get("/me/action-items", response_model=list[schemas.ActionItem])
async def account_action_items(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.account_action_items(account, db)


@router.get("/orders/action-items", response_model=list[schemas.ActionItem])
async def buyer_action_items(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.buyer_action_items(account.id, db)


@router.get("/seller/action-items", response_model=list[schemas.ActionItem])
async def seller_action_items(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.seller_action_items(account.id, db)


@router.get("/admin/action-items", response_model=list[schemas.ActionItem])
async def admin_action_items(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.admin_action_items(db)
