from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.site_status import require_withdrawals_open
from src.auth.dependencies import get_current_account, require_role, require_verified_email, require_withdrawal_mfa
from src.config import settings
from src.database import get_session
from src.media.http import image_response
from src.models.account import Account
from src.sellers.tier_config import rule_for

from . import schemas, service

router = APIRouter(tags=["wallet"])


@router.get("/wallet", response_model=schemas.WalletResponse)
async def get_wallet(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    wallet = await service.get_wallet_by_account(account.id, db)
    resp = schemas.WalletResponse.model_validate(wallet)
    resp.escrow_paid, resp.escrow_incoming = await service.escrow_snapshot(account.id, db)
    from src.payments.service import pending_deposit_total
    resp.pending_deposits = await pending_deposit_total(account.id, db)
    if "seller" in (account.roles or []):
        tier = account.seller_tier or "new"
        resp.withdraw_policy = schemas.WithdrawPolicy(
            tier=tier, limit_per_request=(await rule_for(db, tier)).withdraw_limit_per_request,
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
        actor_id=admin.id, source="admin", event="manual_topup", reason=body.reason, proof_ids=body.proof_images,
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
async def withdraw(
    body: schemas.WithdrawRequestCreate,
    account: Account = Depends(require_role("seller")),
    _verified: Account = Depends(require_verified_email),
    db: AsyncSession = Depends(get_session),
):
    await require_withdrawals_open(db)
    await require_withdrawal_mfa(account, body.totp_code, db)
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
async def reject_withdrawal(
    req_id: int,
    body: schemas.WithdrawRejectRequest,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.reject_withdrawal(req_id, body.reason, db)


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
    escrow_paid, escrow_incoming = await service.escrow_snapshot(account_id, db)
    return {
        "account_id": account_id,
        "email": account.email,
        "available_balance": wallet.available_balance if wallet else 0,
        "locked_balance": wallet.locked_balance if wallet else 0,
        "pending_balance": wallet.pending_balance if wallet else 0,
        "escrow_paid": escrow_paid,
        "escrow_incoming": escrow_incoming,
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
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """approved → paid: admin đã chuyển khoản thật xong, điền mã tham chiếu.
    approve chỉ là "đồng ý chi"; bước này mới chốt "tiền đã rời tài khoản"."""
    return await service.mark_withdrawal_paid(
        req_id, body.payout_reference, db, actor_id=admin.id, receipt_ids=body.receipt_images,
    )


@router.get("/admin/wallet/transactions/{tx_id}/proof/{media_id}", include_in_schema=False)
async def admin_transaction_proof(
    tx_id: int, media_id: str, request: Request, v: str = "full",
    _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
) -> Response:
    return await image_response(db, request, await service.transaction_proof_image(tx_id, media_id, db), v)


@router.get("/wallet/withdrawals/{req_id}/receipt/{media_id}", include_in_schema=False)
async def my_withdrawal_receipt(
    req_id: int, media_id: str, request: Request, v: str = "full",
    account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session),
) -> Response:
    obj = await service.withdrawal_receipt_image(req_id, media_id, db, owner_id=account.id)
    return await image_response(db, request, obj, v)


@router.get("/admin/withdrawals/{req_id}/receipt/{media_id}", include_in_schema=False)
async def admin_withdrawal_receipt(
    req_id: int, media_id: str, request: Request, v: str = "full",
    _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
) -> Response:
    return await image_response(db, request, await service.withdrawal_receipt_image(req_id, media_id, db), v)
