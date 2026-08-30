from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.exceptions import InsufficientCredit
from src.logging import current_request_id
from src.models.account import Account
from src.models.wallet import (
    TRANSACTION_DIRECTION, Transaction, TransactionType, Wallet, WithdrawRequest, WithdrawStatus,
)
from src.sellers.tiers import withdraw_limit


def escrow_settlement(total_amount: int, refunded_amount: int, fee_percent: float) -> tuple[int, int]:
    """Return the remaining escrow and platform fee paid at final settlement."""
    if total_amount < 0 or refunded_amount < 0 or refunded_amount > total_amount:
        raise ValueError("Invalid order refund totals")
    if fee_percent < 0 or fee_percent > 100:
        raise ValueError("Invalid platform fee percentage")
    remaining_amount = total_amount - refunded_amount
    platform_fee = int(remaining_amount * fee_percent / 100)
    return remaining_amount, platform_fee


async def get_wallet_by_account(
    account_id: int,
    db: AsyncSession,
    *,
    for_update: bool = False,
) -> Wallet:
    stmt = select(Wallet).where(Wallet.account_id == account_id)
    if for_update:
        stmt = stmt.with_for_update()
    wallet = await db.scalar(stmt)
    if not wallet:
        raise HTTPException(status_code=404, detail="Không tìm thấy ví")
    return wallet


async def backfill_missing_wallets(db: AsyncSession) -> list[int]:
    """Tạo Wallet(available_balance=0) cho mọi Account chưa có ví.

    register_account() (auth/service.py) luôn tạo Wallet song song với Account,
    nhưng vài script seed (vd scripts/seed_topproxy.py trước bản vá này) từng
    insert Account thẳng vào DB mà bỏ sót Wallet. Hậu quả: escrow_release_job/
    sla_check_job/provision_sweep_job gọi get_wallet_by_account() cho account đó
    sẽ 404, và nếu không được cô lập per-order thì exception đó chặn luôn việc
    release/refund của MỌI đơn khác đang chờ trong cùng lượt chạy job — không
    chỉ đơn của account thiếu ví (xem sự cố đơn #52 kẹt theo đơn #55).

    Endpoint gọi hàm này (POST /admin/wallets/backfill-missing) là lối thoát
    một lệnh curl để dọn account mồ côi kiểu này, không cần truy cập DB trực
    tiếp.
    """
    result = await db.execute(
        select(Account.id).where(~Account.id.in_(select(Wallet.account_id)))
    )
    missing_ids = [row for (row,) in result.all()]
    for account_id in missing_ids:
        db.add(Wallet(account_id=account_id))
    if missing_ids:
        await log_event(
            db, "warning", f"Backfill ví thiếu cho {len(missing_ids)} account: {missing_ids}",
            request_id=current_request_id(),
            metadata={"event": "wallet_backfill", "account_ids": missing_ids},
        )
        await db.commit()
    return missing_ids


async def topup(
    account_id: int,
    amount: int,
    db: AsyncSession,
    *,
    actor_id: int | None = None,
    source: str = "admin",
    event: str = "manual_topup",
) -> Wallet:
    """Credit a wallet. `source`/`event` distinguish admin manual vs demo funding."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    wallet = await get_wallet_by_account(account_id, db, for_update=True)
    wallet.available_balance += amount
    description = "Demo topup" if event == "demo_topup" else "Admin topup"
    tx = Transaction(wallet_id=wallet.id, type=TransactionType.topup, amount=amount, description=description)
    db.add(tx)
    await log_event(
        db, "info", f"Topup {amount:,}đ vào account {account_id}".replace(",", "."),
        request_id=current_request_id(),
        metadata={
            "event": event,
            "actor_id": actor_id if actor_id is not None else account_id,
            "actor_type": "admin" if source == "admin" else "buyer",
            "subject_type": "account",
            "subject_id": account_id,
            "outcome": "success",
            "source": source,
            "amount": amount,
        },
    )
    await db.commit()
    await db.refresh(wallet)
    return wallet


async def deduct_credit(account_id: int, amount: int, description: str, reference_id: str, db: AsyncSession) -> Transaction:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    wallet = await get_wallet_by_account(account_id, db, for_update=True)
    existing = await db.scalar(
        select(Transaction).where(
            Transaction.type == TransactionType.purchase_hold,
            Transaction.reference_id == reference_id,
        )
    )
    if existing:
        return existing
    if wallet.available_balance < amount:
        raise InsufficientCredit()
    wallet.available_balance -= amount
    tx = Transaction(
        wallet_id=wallet.id, type=TransactionType.purchase_hold,
        amount=amount, description=description, reference_id=reference_id,
    )
    db.add(tx)
    return tx


async def release_escrow(order_id: int, seller_id: int, amount: int, platform_fee: int, db: AsyncSession) -> None:
    if amount <= 0 or platform_fee < 0 or platform_fee > amount:
        raise HTTPException(status_code=400, detail="Giá trị thanh toán ký quỹ không hợp lệ")
    seller_wallet = await get_wallet_by_account(seller_id, db, for_update=True)
    reference_id = f"order-{order_id}"
    existing = await db.scalar(
        select(Transaction.id).where(
            Transaction.type.in_((TransactionType.purchase_release, TransactionType.platform_fee)),
            Transaction.reference_id == reference_id,
        ).limit(1)
    )
    if existing:
        return
    seller_amount = amount - platform_fee
    if seller_amount > 0:
        seller_wallet.available_balance += seller_amount
        db.add(Transaction(
            wallet_id=seller_wallet.id, type=TransactionType.purchase_release,
            amount=seller_amount, description="Order payment", reference_id=reference_id,
        ))
    if platform_fee > 0:
        platform_wallet = await get_wallet_by_account(1, db, for_update=True)  # account_id=1 is platform
        platform_wallet.available_balance += platform_fee
        db.add(Transaction(
            wallet_id=platform_wallet.id, type=TransactionType.platform_fee,
            amount=platform_fee, description="Platform fee", reference_id=reference_id,
        ))


async def refund_escrow(
    order_id: int,
    buyer_id: int,
    amount: int,
    db: AsyncSession,
    *,
    reference_suffix: str = "",
) -> None:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền hoàn phải lớn hơn 0")
    from src.models.order import Order
    order = await db.get(Order, order_id, with_for_update=True)
    if not order or order.buyer_id != buyer_id or amount > order.total_amount - order.refunded_amount:
        raise HTTPException(status_code=400, detail="Số tiền hoàn vượt quá số dư ký quỹ")
    buyer_wallet = await get_wallet_by_account(buyer_id, db, for_update=True)
    reference_id = f"order-{order_id}{reference_suffix}"
    existing = await db.scalar(
        select(Transaction.id).where(
            Transaction.type == TransactionType.refund,
            Transaction.reference_id == reference_id,
        )
    )
    if existing:
        return
    order.refunded_amount += amount
    buyer_wallet.available_balance += amount
    db.add(Transaction(
        wallet_id=buyer_wallet.id, type=TransactionType.refund,
        amount=amount, description="Order refund", reference_id=reference_id,
    ))


async def credit_affiliate_commission(
    affiliate_account_id: int, amount: int, order_id: int, db: AsyncSession
) -> None:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Hoa hồng phải lớn hơn 0")
    wallet = await get_wallet_by_account(affiliate_account_id, db, for_update=True)
    reference_id = str(order_id)
    existing = await db.scalar(
        select(Transaction.id).where(
            Transaction.type == TransactionType.affiliate_commission,
            Transaction.reference_id == reference_id,
        )
    )
    if existing:
        return
    wallet.available_balance += amount
    db.add(Transaction(
        wallet_id=wallet.id, type=TransactionType.affiliate_commission,
        amount=amount, description="Affiliate commission", reference_id=reference_id,
    ))


async def clawback_affiliate_commission(
    affiliate_account_id: int, amount: int, order_id: int, db: AsyncSession
) -> int:
    """Debit recovered commission. Returns the amount actually taken (may be less)."""
    if amount <= 0:
        return 0
    wallet = await get_wallet_by_account(affiliate_account_id, db, for_update=True)
    reference_id = str(order_id)
    existing = await db.scalar(
        select(Transaction.id).where(
            Transaction.type == TransactionType.affiliate_clawback,
            Transaction.reference_id == reference_id,
        )
    )
    if existing:
        return 0
    recovered = min(wallet.available_balance, amount)
    if recovered <= 0:
        return 0
    wallet.available_balance -= recovered
    db.add(Transaction(
        wallet_id=wallet.id,
        type=TransactionType.affiliate_clawback,
        amount=recovered,
        description="Affiliate commission clawback",
        reference_id=reference_id,
    ))
    return recovered


async def get_transactions(account_id: int, db: AsyncSession) -> list[dict]:
    wallet = await get_wallet_by_account(account_id, db)
    result = await db.execute(
        select(Transaction).where(Transaction.wallet_id == wallet.id).order_by(Transaction.created_at.desc())
    )
    txs = list(result.scalars().all())

    # purchase_hold rows point at their order via reference_id="order-{id}" — resolve the
    # order's current status so the UI can show something more accurate than "held" forever.
    order_ids: set[int] = set()
    for t in txs:
        if t.type == TransactionType.purchase_hold and t.reference_id and t.reference_id.startswith("order-"):
            try:
                order_ids.add(int(t.reference_id.removeprefix("order-")))
            except ValueError:
                pass

    order_status: dict[int, str] = {}
    if order_ids:
        from src.models.order import Order
        rows = await db.execute(select(Order.id, Order.status).where(Order.id.in_(order_ids)))
        order_status = {oid: st.value for oid, st in rows.all()}

    out = []
    for t in txs:
        status = None
        if t.type == TransactionType.purchase_hold and t.reference_id and t.reference_id.startswith("order-"):
            try:
                status = order_status.get(int(t.reference_id.removeprefix("order-")))
            except ValueError:
                pass
        out.append({
            "id": t.id, "type": t.type, "amount": t.amount,
            "direction": TRANSACTION_DIRECTION[t.type].value,
            "description": t.description,
            "reference_id": t.reference_id, "created_at": t.created_at, "order_status": status,
        })
    return out


async def request_withdraw(
    account_id: int, amount: int, db: AsyncSession,
    *, bank_bin: str | None = None, bank_name: str | None = None,
    bank_account_number: str | None = None, bank_account_holder: str | None = None,
) -> WithdrawRequest:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    wallet = await get_wallet_by_account(account_id, db, for_update=True)
    if wallet.available_balance < amount:
        raise InsufficientCredit()
    account = await db.get(Account, account_id)
    limit = withdraw_limit(account.seller_tier if account else "new")
    if limit is not None and amount > limit:
        raise HTTPException(
            status_code=400,
            detail=f"Vượt hạn mức rút tiền theo cấp độ người bán (tối đa {limit:,}đ/lần)".replace(",", "."),
        )
    # Khoá tiền ngay lúc gửi yêu cầu — tránh bug seller gửi nhiều yêu cầu rút
    # vượt quá số dư thực trước khi admin duyệt request nào.
    wallet.available_balance -= amount
    wallet.locked_balance += amount
    req = WithdrawRequest(
        account_id=account_id, amount=amount,
        bank_bin=bank_bin, bank_name=bank_name,
        bank_account_number=bank_account_number, bank_account_holder=bank_account_holder,
    )
    db.add(req)
    await db.flush()
    db.add(Transaction(
        wallet_id=wallet.id, type=TransactionType.withdraw_lock,
        amount=amount, description="Khoá tiền chờ duyệt rút", reference_id=f"withdraw-{req.id}",
    ))
    await log_event(
        db, "info", f"Yêu cầu rút #{req.id} — {amount:,}đ (account {account_id}, đã khoá tiền)".replace(",", "."),
        request_id=current_request_id(),
        metadata={"event": "withdraw_requested", "withdraw_id": req.id, "account_id": account_id, "amount": amount},
    )
    await db.commit()
    await db.refresh(req)
    return req


def _withdraw_dict(req: WithdrawRequest, email: str | None) -> dict:
    return {
        "id": req.id, "account_id": req.account_id, "account_email": email,
        "amount": req.amount, "status": req.status, "created_at": req.created_at,
        "bank_bin": req.bank_bin, "bank_name": req.bank_name,
        "bank_account_number": req.bank_account_number,
        "bank_account_holder": req.bank_account_holder,
        "payout_reference": req.payout_reference, "paid_at": req.paid_at,
        "reject_reason": req.reject_reason,
    }


async def list_withdrawals(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(WithdrawRequest, Account.email)
        .join(Account, WithdrawRequest.account_id == Account.id)
        .order_by(WithdrawRequest.created_at.desc())
    )
    return [_withdraw_dict(req, email) for req, email in result.all()]


async def approve_withdrawal(req_id: int, db: AsyncSession) -> WithdrawRequest:
    req = await db.get(WithdrawRequest, req_id, with_for_update=True)
    if not req:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu rút tiền")
    if req.status != WithdrawStatus.pending:
        raise HTTPException(status_code=400, detail="Yêu cầu đã được xử lý")
    wallet = await get_wallet_by_account(req.account_id, db, for_update=True)
    if wallet.locked_balance < req.amount:
        raise HTTPException(status_code=409, detail="Số dư đang khoá không đủ cho yêu cầu này")
    # Tiền đã bị khoá (locked_balance) từ lúc request_withdraw — chỉ cần xoá khỏi
    # locked, KHÔNG đụng available_balance nữa.
    wallet.locked_balance -= req.amount
    req.status = WithdrawStatus.approved
    db.add(Transaction(
        wallet_id=wallet.id, type=TransactionType.withdraw,
        amount=req.amount, description="Withdrawal approved", reference_id=f"withdraw-{req.id}",
    ))
    await log_event(
        db, "info", f"Yêu cầu rút #{req.id} được DUYỆT ({req.amount:,}đ, account {req.account_id})".replace(",", "."),
        request_id=current_request_id(),
        metadata={"event": "withdraw_approved", "withdraw_id": req.id, "account_id": req.account_id, "amount": req.amount},
    )
    from src.mail.service import enqueue_mail, frontend_url
    await enqueue_mail(
        db,
        template="withdrawal_approved",
        account_id=req.account_id,
        idempotency_key=f"withdrawal_approved:{req.id}",
        payload={"amount": req.amount, "action_url": frontend_url("vi", "/seller/withdrawals")},
    )
    await db.commit()
    await db.refresh(req)
    return req


async def reject_withdrawal(req_id: int, reason: str, db: AsyncSession) -> WithdrawRequest:
    req = await db.get(WithdrawRequest, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu rút tiền")
    if req.status != WithdrawStatus.pending:
        raise HTTPException(status_code=400, detail="Yêu cầu đã được xử lý")
    cleaned = reason.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Từ chối rút tiền phải kèm lý do")
    wallet = await get_wallet_by_account(req.account_id, db)
    # Trả tiền đã khoá về lại available_balance.
    wallet.locked_balance -= req.amount
    wallet.available_balance += req.amount
    db.add(Transaction(
        wallet_id=wallet.id, type=TransactionType.withdraw_unlock,
        amount=req.amount, description="Huỷ khoá — yêu cầu rút tiền bị từ chối",
        reference_id=f"withdraw-{req.id}",
    ))
    req.status = WithdrawStatus.rejected
    req.reject_reason = cleaned[:500]
    await log_event(
        db, "info", f"Yêu cầu rút #{req.id} bị TỪ CHỐI ({req.amount:,}đ trả về ví account {req.account_id})".replace(",", "."),
        request_id=current_request_id(),
        metadata={"event": "withdraw_rejected", "withdraw_id": req.id, "account_id": req.account_id, "amount": req.amount},
    )
    from src.mail.service import enqueue_mail, frontend_url
    await enqueue_mail(
        db,
        template="withdrawal_rejected",
        account_id=req.account_id,
        idempotency_key=f"withdrawal_rejected:{req.id}",
        payload={
            "amount": req.amount,
            "reason": req.reject_reason,
            "action_url": frontend_url("vi", "/seller/withdrawals"),
        },
    )
    await db.commit()
    await db.refresh(req)
    return req


async def list_withdrawals_for_account(account_id: int, db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(WithdrawRequest, Account.email)
        .join(Account, WithdrawRequest.account_id == Account.id)
        .where(WithdrawRequest.account_id == account_id)
        .order_by(WithdrawRequest.created_at.desc())
    )
    return [_withdraw_dict(req, email) for req, email in result.all()]


async def mark_withdrawal_paid(req_id: int, payout_reference: str, db: AsyncSession) -> WithdrawRequest:
    """approved → paid. Không đụng số dư: tiền đã rời locked_balance từ lúc
    approve; bước này chỉ ghi nhận việc chi thật (đối soát với sao kê bank)."""
    req = await db.get(WithdrawRequest, req_id, with_for_update=True)
    if not req:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu rút tiền")
    if req.status != WithdrawStatus.approved:
        raise HTTPException(status_code=400, detail="Chỉ đánh dấu đã chi cho yêu cầu đã duyệt")
    req.status = WithdrawStatus.paid
    req.payout_reference = payout_reference
    req.paid_at = datetime.now(timezone.utc)
    await log_event(
        db, "info", f"Yêu cầu rút #{req.id} ĐÃ CHI TIỀN ({req.amount:,}đ, ref {payout_reference})".replace(",", "."),
        request_id=current_request_id(),
        metadata={"event": "withdraw_paid", "withdraw_id": req.id, "account_id": req.account_id,
                  "amount": req.amount, "payout_reference": payout_reference},
    )
    await db.commit()
    await db.refresh(req)
    return req
