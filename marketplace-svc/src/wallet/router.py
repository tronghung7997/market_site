from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["wallet"])


@router.get("/wallet", response_model=schemas.WalletResponse)
async def get_wallet(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.get_wallet_by_account(account.id, db)


@router.post("/wallet/topup", response_model=schemas.WalletResponse)
async def topup(body: schemas.TopupRequest, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.topup(body.account_id, body.amount, db)


@router.post("/wallet/demo-topup", response_model=schemas.WalletResponse)
async def demo_topup(body: schemas.DemoTopupRequest, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.topup(account.id, body.amount, db)


@router.get("/wallet/transactions", response_model=list[schemas.TransactionResponse])
async def transactions(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.get_transactions(account.id, db)


@router.post("/wallet/withdraw", response_model=schemas.WithdrawRequestResponse)
async def withdraw(body: schemas.WithdrawRequestCreate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.request_withdraw(account.id, body.amount, db)


@router.get("/wallet/withdrawals", response_model=list[schemas.WithdrawRequestResponse])
async def my_withdrawals(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.list_withdrawals_for_account(account.id, db)


@router.get("/admin/withdrawals", response_model=list[schemas.WithdrawRequestResponse])
async def list_withdrawals(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_withdrawals(db)


@router.post("/admin/withdrawals/{req_id}/approve", response_model=schemas.WithdrawRequestResponse)
async def approve_withdrawal(req_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.approve_withdrawal(req_id, db)


@router.post("/admin/withdrawals/{req_id}/reject", response_model=schemas.WithdrawRequestResponse)
async def reject_withdrawal(req_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.reject_withdrawal(req_id, db)
