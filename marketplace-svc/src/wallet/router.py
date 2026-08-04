from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.config import settings
from src.database import get_session
from src.models.account import Account
from src.sellers.tiers import withdraw_limit

from . import schemas, service

router = APIRouter(tags=["wallet"])


@router.get("/wallet", response_model=schemas.WalletResponse)
async def get_wallet(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    wallet = await service.get_wallet_by_account(account.id, db)
    resp = schemas.WalletResponse.model_validate(wallet)
    if "seller" in (account.roles or []):
        tier = account.seller_tier or "new"
        resp.withdraw_policy = schemas.WithdrawPolicy(
            tier=tier, limit_per_request=withdraw_limit(tier),
        )
    return resp


@router.post("/wallet/topup", response_model=schemas.WalletResponse)
async def topup(
    body: schemas.TopupRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.topup(
        body.account_id, body.amount, db,
        actor_id=admin.id, source="admin", event="manual_topup",
    )


@router.post("/wallet/demo-topup", response_model=schemas.WalletResponse)
async def demo_topup(body: schemas.DemoTopupRequest, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    # Đường nạp giả cho dev/demo — production PHẢI tắt (ENABLE_DEMO_TOPUP unset/false):
    # nạp thật đi qua PayOS (POST /wallet/deposits, src/payments/router.py).
    if not settings.enable_demo_topup:
        raise HTTPException(status_code=403, detail="Demo topup đã tắt — dùng nạp tiền qua cổng thanh toán")
    return await service.topup(
        account.id, body.amount, db,
        actor_id=account.id, source="demo", event="demo_topup",
    )


@router.get("/wallet/transactions", response_model=list[schemas.TransactionResponse])
async def transactions(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.get_transactions(account.id, db)


@router.post("/wallet/withdraw", response_model=schemas.WithdrawRequestResponse)
async def withdraw(body: schemas.WithdrawRequestCreate, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.request_withdraw(
        account.id, body.amount, db,
        bank_bin=body.bank_bin, bank_name=body.bank_name,
        bank_account_number=body.bank_account_number,
        bank_account_holder=body.bank_account_holder,
    )


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


@router.get("/admin/accounts/{account_id}/wallet")
async def admin_account_wallet(
    account_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Ví của một user bất kỳ — cho ca khiếu nại "tiền tôi đâu" (trước đây
    admin phải mở psql). Account chưa có ví → số 0, không 404."""
    from sqlalchemy import select

    from src.models.wallet import Wallet

    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    wallet = await db.scalar(select(Wallet).where(Wallet.account_id == account_id))
    return {
        "account_id": account_id,
        "email": account.email,
        "available_balance": wallet.available_balance if wallet else 0,
        "locked_balance": wallet.locked_balance if wallet else 0,
        "pending_balance": wallet.pending_balance if wallet else 0,
    }


@router.post("/admin/wallets/backfill-missing")
async def backfill_missing_wallets(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    """Tạo ví 0đ cho mọi account bị thiếu — dọn account mồ côi do script seed
    tạo Account thẳng mà bỏ sót Wallet (xem docstring service.backfill_missing_wallets).
    Idempotent: gọi lại khi không còn account thiếu ví trả về danh sách rỗng."""
    account_ids = await service.backfill_missing_wallets(db)
    return {"backfilled_account_ids": account_ids}


@router.get("/admin/accounts/{account_id}/transactions", response_model=list[schemas.TransactionResponse])
async def admin_account_transactions(
    account_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.get_transactions(account_id, db)
    except HTTPException:
        return []  # chưa có ví = chưa có giao dịch


@router.post("/admin/withdrawals/{req_id}/paid", response_model=schemas.WithdrawRequestResponse)
async def mark_withdrawal_paid(
    req_id: int,
    body: schemas.WithdrawMarkPaidRequest,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """approved → paid: admin đã chuyển khoản thật xong, điền mã tham chiếu.
    approve chỉ là "đồng ý chi"; bước này mới chốt "tiền đã rời tài khoản"."""
    return await service.mark_withdrawal_paid(req_id, body.payout_reference, db)
