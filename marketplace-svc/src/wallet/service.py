from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import InsufficientCredit
from src.models.wallet import Transaction, TransactionType, Wallet, WithdrawRequest, WithdrawStatus


async def get_wallet_by_account(account_id: int, db: AsyncSession) -> Wallet:
    wallet = await db.scalar(select(Wallet).where(Wallet.account_id == account_id))
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    return wallet


async def topup(account_id: int, amount: int, db: AsyncSession) -> Wallet:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
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


async def get_transactions(account_id: int, db: AsyncSession) -> list[Transaction]:
    wallet = await get_wallet_by_account(account_id, db)
    result = await db.execute(
        select(Transaction).where(Transaction.wallet_id == wallet.id).order_by(Transaction.created_at.desc())
    )
    return list(result.scalars().all())


async def request_withdraw(account_id: int, amount: int, db: AsyncSession) -> WithdrawRequest:
    wallet = await get_wallet_by_account(account_id, db)
    if wallet.balance < amount:
        raise InsufficientCredit()
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    req = WithdrawRequest(account_id=account_id, amount=amount)
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return req


async def list_withdrawals(db: AsyncSession) -> list[WithdrawRequest]:
    result = await db.execute(select(WithdrawRequest).order_by(WithdrawRequest.created_at.desc()))
    return list(result.scalars().all())


async def approve_withdrawal(req_id: int, db: AsyncSession) -> WithdrawRequest:
    req = await db.get(WithdrawRequest, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    if req.status != WithdrawStatus.pending:
        raise HTTPException(status_code=400, detail="Already processed")
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
