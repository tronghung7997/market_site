from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import InsufficientCredit
from src.models.account import Account
from src.models.wallet import Transaction, TransactionType, Wallet, WithdrawRequest, WithdrawStatus


async def get_wallet_by_account(account_id: int, db: AsyncSession) -> Wallet:
    wallet = await db.scalar(select(Wallet).where(Wallet.account_id == account_id))
    if not wallet:
        raise HTTPException(status_code=404, detail="Không tìm thấy ví")
    return wallet


async def topup(account_id: int, amount: int, db: AsyncSession) -> Wallet:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    wallet = await get_wallet_by_account(account_id, db)
    wallet.balance += amount
    tx = Transaction(wallet_id=wallet.id, type=TransactionType.topup, amount=amount, description="Admin topup")
    db.add(tx)
    await db.commit()
    await db.refresh(wallet)
    return wallet


async def deduct_credit(account_id: int, amount: int, description: str, reference_id: str, db: AsyncSession) -> Transaction:
    wallet = await get_wallet_by_account(account_id, db)
    if wallet.balance < amount:
        raise InsufficientCredit()
    wallet.balance -= amount
    tx = Transaction(
        wallet_id=wallet.id, type=TransactionType.purchase_hold,
        amount=amount, description=description, reference_id=reference_id,
    )
    db.add(tx)
    return tx


async def release_escrow(order_id: int, seller_id: int, amount: int, platform_fee: int, db: AsyncSession) -> None:
    seller_wallet = await get_wallet_by_account(seller_id, db)
    seller_amount = amount - platform_fee
    seller_wallet.balance += seller_amount
    db.add(Transaction(
        wallet_id=seller_wallet.id, type=TransactionType.purchase_release,
        amount=seller_amount, description="Order payment", reference_id=f"order-{order_id}",
    ))
    if platform_fee > 0:
        platform_wallet = await get_wallet_by_account(1, db)  # account_id=1 is platform
        platform_wallet.balance += platform_fee
        db.add(Transaction(
            wallet_id=platform_wallet.id, type=TransactionType.platform_fee,
            amount=platform_fee, description="Platform fee", reference_id=f"order-{order_id}",
        ))


async def refund_escrow(order_id: int, buyer_id: int, amount: int, db: AsyncSession) -> None:
    buyer_wallet = await get_wallet_by_account(buyer_id, db)
    buyer_wallet.balance += amount
    db.add(Transaction(
        wallet_id=buyer_wallet.id, type=TransactionType.refund,
        amount=amount, description="Order refund", reference_id=f"order-{order_id}",
    ))


async def credit_affiliate_commission(
    affiliate_account_id: int, amount: int, order_id: int, db: AsyncSession
) -> None:
    wallet = await get_wallet_by_account(affiliate_account_id, db)
    wallet.balance += amount
    db.add(Transaction(
        wallet_id=wallet.id, type=TransactionType.affiliate_commission,
        amount=amount, description="Affiliate commission", reference_id=str(order_id),
    ))


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
            "id": t.id, "type": t.type, "amount": t.amount, "description": t.description,
            "reference_id": t.reference_id, "created_at": t.created_at, "order_status": status,
        })
    return out


async def request_withdraw(account_id: int, amount: int, db: AsyncSession) -> WithdrawRequest:
    wallet = await get_wallet_by_account(account_id, db)
    if wallet.balance < amount:
        raise InsufficientCredit()
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    req = WithdrawRequest(account_id=account_id, amount=amount)
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


async def list_withdrawals(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(WithdrawRequest, Account.email)
        .join(Account, WithdrawRequest.account_id == Account.id)
        .order_by(WithdrawRequest.created_at.desc())
    )
    return [
        {
            "id": req.id, "account_id": req.account_id, "account_email": email,
            "amount": req.amount, "status": req.status, "created_at": req.created_at,
        }
        for req, email in result.all()
    ]


async def approve_withdrawal(req_id: int, db: AsyncSession) -> WithdrawRequest:
    req = await db.get(WithdrawRequest, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu rút tiền")
    if req.status != WithdrawStatus.pending:
        raise HTTPException(status_code=400, detail="Yêu cầu đã được xử lý")
    wallet = await get_wallet_by_account(req.account_id, db)
    if wallet.balance < req.amount:
        raise InsufficientCredit()
    wallet.balance -= req.amount
    req.status = WithdrawStatus.approved
    db.add(Transaction(
        wallet_id=wallet.id, type=TransactionType.withdraw,
        amount=req.amount, description="Withdrawal approved",
    ))
    await db.commit()
    await db.refresh(req)
    return req
