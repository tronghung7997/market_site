import re
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.exceptions import ErrorCode, InsufficientCredit, api_error
from src.logging import current_request_id
from src.models.account import Account
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.wallet import (
    TRANSACTION_DIRECTION, WITHDRAW_SOURCE_AFFILIATE, WITHDRAW_SOURCE_SELLER,
    Transaction, TransactionType, Wallet, WithdrawRequest, WithdrawStatus,
)
from src.fees.service import platform_fee_percent_for, withdraw_fee_amount
from src.media import service as media_service
from src.media.service import private_images
from src.models.media import MediaObject, MediaPurpose
from src.wallet.schemas import MAX_PROOF_IMAGES
from src.fees.settings import get_fee_settings, platform_account_id
from src.sellers.tier_config import rule_for

# media subject types (subject_id = transaction id / withdraw request id).
TRANSACTION_PROOF_SUBJECT = "wallet_transaction"
WITHDRAW_RECEIPT_SUBJECT = "withdraw_request"


def escrow_settlement(total_amount: int, refunded_amount: int, fee_percent: float) -> tuple[int, int]:
    """Return the remaining escrow and platform fee paid at final settlement."""
    if total_amount < 0 or refunded_amount < 0 or refunded_amount > total_amount:
        raise ValueError("Invalid order refund totals")
    if fee_percent < 0 or fee_percent > 100:
        raise ValueError("Invalid platform fee percentage")
    remaining_amount = total_amount - refunded_amount
    platform_fee = int(remaining_amount * fee_percent / 100)
    return remaining_amount, platform_fee


def promo_subsidy(discount: int, total_amount: int, remaining_amount: int, platform_fee: int) -> tuple[int, int]:
    """(share, fee on share) of a promo discount at settlement.

    The buyer paid ``total_amount`` = list price − ``discount``; the platform
    funds the discount. The seller gets the part of it that matches what they
    keep (``remaining_amount`` / ``total_amount``, so a partial refund shrinks
    it and a full refund cancels it) less the platform fee on that part, at the
    same rate as ``platform_fee`` on ``remaining_amount`` — so a seller ends up
    exactly where they would be had the buyer paid the list price.
    """
    if discount <= 0 or remaining_amount <= 0 or total_amount <= 0:
        return 0, 0
    share = discount * remaining_amount // total_amount
    return share, share * platform_fee // remaining_amount


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


ESCROW_OPEN_STATUSES = (
    OrderStatus.pending, OrderStatus.processing, OrderStatus.delivered, OrderStatus.disputed,
)


def order_in_books():
    """SQL condition for orders whose money lives in the ledger: every real
    order, plus seeded ones that were actually paid. Seed data (trust_seed)
    never touches a wallet, but prod test orders hidden afterwards with
    ``is_seeded`` keep their ``purchase_hold`` — leaving their open escrow
    out makes the platform totals come up short by exactly that amount."""
    return or_(Order.is_seeded.is_(False), exists().where(
        Transaction.type == TransactionType.purchase_hold,
        Transaction.reference_id == func.concat("order-", Order.id),
    ))


@dataclass(frozen=True)
class EscrowEstimate:
    """One unsettled sale and what it should pay the seller at release."""
    status: OrderStatus
    disputed: bool
    expires_at: datetime | None
    gross: int
    fee: int

    @property
    def net(self) -> int:
        return self.gross - self.fee


async def seller_escrow_estimates(
    seller_id: int, db: AsyncSession, *, now: datetime | None = None,
) -> list[EscrowEstimate]:
    """Every unsettled, non-seeded sale of a seller with the payout the release
    job would make today: remaining escrow plus the promo top-up, less the
    platform fee at the seller's tier (0 % for internal sellers; a running
    seller fee promo for orders that settle before it ends). The one source
    for "money from sales on its way to the wallet" — the wallet balance strip
    and the seller's payout schedule both read it."""
    from src.sellers.fee_promo import active_fee_promo

    seller = await db.get(Account, seller_id)
    if seller is None:
        return []
    tier = str(getattr(seller.seller_tier, "value", seller.seller_tier) or "new")
    open_dispute = exists().where(Dispute.order_id == Order.id, Dispute.status == DisputeStatus.open)
    product_id = func.coalesce(Order.product_id, ProductVariant.product_id)
    rows = (await db.execute(
        select(
            Order.status, Order.total_amount, Order.refunded_amount, Order.discount_amount, Order.escrow_expires_at,
            Product.category_id, open_dispute.label("disputed"),
        )
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .outerjoin(Product, Product.id == product_id)
        .where(
            Order.seller_id == seller_id,
            Order.is_seeded.is_(False),
            Order.status.in_(ESCROW_OPEN_STATUSES),
        )
    )).all()
    fee_by_category: dict[int | None, float] = {}
    # A running fee promo applies to orders that settle before it ends.
    promo = await active_fee_promo(db, seller_id, at=now or datetime.now(timezone.utc))
    out = []
    for status, total_amount, refunded_amount, discount, expires_at, category_id, disputed in rows:
        if seller.is_internal:
            percent = 0.0
        elif promo is not None and (expires_at is None or promo.ends_at is None or expires_at < promo.ends_at):
            percent = float(promo.fee_percent)
        else:
            if category_id not in fee_by_category:
                fee_by_category[category_id] = await platform_fee_percent_for(db, seller_tier=tier, category_id=category_id)
            percent = fee_by_category[category_id]
        gross, fee = escrow_settlement(total_amount, refunded_amount, percent)
        # A promo order settles at list price: the platform adds the discount.
        share, share_fee = promo_subsidy(discount, total_amount, gross, fee)
        out.append(EscrowEstimate(status, bool(disputed), expires_at, gross + share, fee + share_fee))
    return out


async def escrow_snapshot(account_id: int, db: AsyncSession) -> tuple[int, int]:
    """(paid, incoming): what this account has paid into unsettled orders as a
    buyer (`total - refunded`), and what its unsettled sales should still pay
    it as a seller — net of the platform fee, the figure the payout schedule
    shows (``seller_escrow_estimates``)."""
    held = func.coalesce(func.sum(Order.total_amount - Order.refunded_amount), 0)
    paid = await db.scalar(
        select(held).where(Order.buyer_id == account_id, Order.status.in_(ESCROW_OPEN_STATUSES))
    )
    incoming = sum(e.net for e in await seller_escrow_estimates(account_id, db))
    return int(paid or 0), int(incoming)


async def topup(
    account_id: int,
    amount: int,
    db: AsyncSession,
    *,
    actor_id: int | None = None,
    source: str = "admin",
    event: str = "manual_topup",
    reason: str | None = None,
    proof_ids: list[str] | None = None,
) -> Wallet:
    """Credit a wallet. `source`/`event` distinguish admin manual vs demo funding.

    A manual admin credit must carry a `reason`; it is copied into the ledger
    description and the audit row so the money is never anonymous.
    """
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    reason = (reason or "").strip() or None
    if source == "admin" and not reason:
        raise HTTPException(status_code=422, detail="Cần ghi lý do khi cộng tiền thủ công")
    wallet = await get_wallet_by_account(account_id, db, for_update=True)
    wallet.available_balance += amount
    # Shown to the account owner in their ledger, so it reads in their language.
    if event == "demo_topup":
        description = "Nạp thử (demo)"
    else:
        description = f"GMMO cộng tiền — {reason}" if reason else "GMMO cộng tiền"
    tx = Transaction(wallet_id=wallet.id, type=TransactionType.topup, amount=amount, description=description)
    db.add(tx)
    if proof_ids:
        await db.flush()
        tx.proof_media = await media_service.set_subject_media(
            db, actor_id=actor_id or 0, purpose=MediaPurpose.adjustment_proof, subject_type=TRANSACTION_PROOF_SUBJECT,
            subject_id=tx.id, public_ids=proof_ids, max_count=MAX_PROOF_IMAGES,
        )
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
            "reason": reason,
            "proof_images": [snap["id"] for snap in (tx.proof_media or [])],
        },
    )
    if source == "admin":
        from src.notifications.history import notify
        await notify(db, account_id, "wallet_credited", category="wallet", params={"amount": amount}, href="/wallet")
    await db.commit()
    await db.refresh(wallet)
    return wallet


async def admin_debit(
    account_id: int,
    amount: int,
    db: AsyncSession,
    *,
    actor_id: int,
    reason: str,
    proof_ids: list[str] | None = None,
) -> Wallet:
    """Admin manual debit: the mirror of an admin ``topup``. Books an
    ``adjustment_debit`` (money out of the platform ledger, see
    ledger.service) under the wallet row lock and refuses to overdraw the
    available balance. Held/locked money is never touched."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="Cần ghi lý do khi trừ tiền thủ công")
    wallet = await get_wallet_by_account(account_id, db, for_update=True)
    if wallet.available_balance < amount:
        raise HTTPException(status_code=400, detail="Số tiền trừ vượt quá số dư khả dụng")
    wallet.available_balance -= amount
    tx = Transaction(
        wallet_id=wallet.id, type=TransactionType.adjustment_debit, amount=amount,
        description=f"GMMO trừ tiền — {reason}",
    )
    db.add(tx)
    if proof_ids:
        await db.flush()
        tx.proof_media = await media_service.set_subject_media(
            db, actor_id=actor_id, purpose=MediaPurpose.adjustment_proof, subject_type=TRANSACTION_PROOF_SUBJECT,
            subject_id=tx.id, public_ids=proof_ids, max_count=MAX_PROOF_IMAGES,
        )
    await log_event(
        db, "warning", f"Admin debit {amount:,}đ from account {account_id}".replace(",", "."),
        request_id=current_request_id(),
        metadata={
            "event": "manual_debit",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "account",
            "subject_id": account_id,
            "outcome": "success",
            "source": "admin",
            "amount": amount,
            "reason": reason,
            "proof_images": [snap["id"] for snap in (tx.proof_media or [])],
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
    order = await db.get(Order, order_id)
    if order is not None and order.discount_amount:
        share, share_fee = promo_subsidy(order.discount_amount, order.total_amount, amount, platform_fee)
        if share - share_fee > 0:
            # The platform funds the buyer's promo discount (money into the
            # books, like affiliate commissions — see ledger._SOURCE_IN).
            seller_wallet.available_balance += share - share_fee
            db.add(Transaction(
                wallet_id=seller_wallet.id, type=TransactionType.promo_subsidy,
                amount=share - share_fee, description=f"Sàn bù khuyến mãi {order.promo_code or ''}".strip(),
                reference_id=reference_id,
            ))
    if platform_fee > 0:
        platform_wallet = await get_wallet_by_account(await platform_account_id(db), db, for_update=True)
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


_ORDER_REF = re.compile(r"^order-(\d+)(?:[:-].*)?$")
_WITHDRAW_REF = re.compile(r"^withdraw-(\d+)$")


def order_ledger_condition(order_id: int, *, include_affiliate: bool = False):
    """SQL condition for every ledger row of one order — the single source of
    the reference convention. Escrow rows reference ``order-<id>``; refunds may
    add a suffix: ``:dispute:…``, ``:short-delivery``, ``:admin-refund`` or the
    partial-delivery ``-short``. Affiliate rows reference the bare ``<id>``.
    The separator is required, so order 12 never matches order 120."""
    ref = f"order-{order_id}"
    cond = or_(
        Transaction.reference_id == ref,
        Transaction.reference_id.like(f"{ref}:%"),
        Transaction.reference_id.like(f"{ref}-%"),
    )
    if include_affiliate:
        cond = or_(cond, and_(
            Transaction.reference_id == str(order_id),
            Transaction.type.in_((TransactionType.affiliate_commission, TransactionType.affiliate_clawback)),
        ))
    return cond


def _order_id_from_reference(reference_id: str | None) -> int | None:
    """Order behind a ledger reference: ``order-{id}[suffix]`` for purchase /
    release / refund rows, a bare ``{id}`` for affiliate commissions."""
    if not reference_id:
        return None
    match = _ORDER_REF.match(reference_id)
    if match:
        return int(match.group(1))
    if reference_id.isdigit():
        return int(reference_id)
    return None


def _reference_label(reference_id: str | None, order_codes: dict[int, str]) -> str | None:
    """What the buyer/seller sees as the reference: the order code or the
    payment provider's reference for deposits. Internal row ids (dispute ids
    and idempotency keys in refund suffixes, deposit intents, withdraw
    requests) never surface."""
    if not reference_id:
        return None
    match = _ORDER_REF.match(reference_id)
    if match:
        return order_codes.get(int(match.group(1)))
    if reference_id.isdigit():
        return order_codes.get(int(reference_id))
    if reference_id.startswith("deposit-"):
        _, _, tail = reference_id.removeprefix("deposit-").partition("-")
        return tail or None
    return None


async def get_transactions(account_id: int, db: AsyncSession, *, with_proof: bool = False) -> list[dict]:
    """The wallet's ledger, newest first. Proof images of manual credits are
    admin evidence: only the admin view (`with_proof`) lists them; the owner
    sees the row and its reason, not what the admin attached."""
    wallet = await get_wallet_by_account(account_id, db)
    result = await db.execute(
        select(Transaction).where(Transaction.wallet_id == wallet.id).order_by(Transaction.created_at.desc())
    )
    return await describe_transactions(list(result.scalars().all()), wallet, account_id, db, with_proof=with_proof)


async def describe_transactions(
    txs: list[Transaction], wallet: Wallet, account_id: int, db: AsyncSession, *, with_proof: bool = False,
) -> list[dict]:
    """Ledger rows as the owner reads them: order code and status, withdrawal
    status, the platform fee a sale was net of, the visible reference."""
    # Rows point at their order via reference_id — resolve the order's code (what
    # the UI shows) and, for purchase_hold rows, its current status so the UI can
    # show something more accurate than "held" forever.
    order_ids = {oid for t in txs if (oid := _order_id_from_reference(t.reference_id)) is not None}

    order_status: dict[int, str] = {}
    order_codes: dict[int, str] = {}
    # Test orders hidden from every order list (`is_seeded`) keep their money
    # rows here; the row says so, or it points at an order no list shows.
    hidden_orders: set[int] = set()
    if order_ids:
        from src.models.order import Order
        rows = await db.execute(
            select(Order.id, Order.status, Order.order_code, Order.is_seeded).where(Order.id.in_(order_ids))
        )
        for oid, st, code, seeded in rows.all():
            order_status[oid] = st.value
            order_codes[oid] = code
            if seeded:
                hidden_orders.add(oid)

    # A withdrawal's rows (lock, unlock, payout, fee) follow its request, so the
    # lock reads "waiting for review" only while the request is open.
    withdraw_ids = {
        int(m.group(1)) for t in txs if t.reference_id and (m := _WITHDRAW_REF.match(t.reference_id))
    }
    withdrawals: dict[int, dict] = {}
    if withdraw_ids:
        rows = await db.execute(
            select(WithdrawRequest)
            .where(WithdrawRequest.id.in_(withdraw_ids), WithdrawRequest.account_id == account_id)
        )
        for req in rows.scalars().all():
            fee = int(req.fee_amount or 0)
            withdrawals[req.id] = {
                "status": req.status.value, "amount": req.amount, "fee_amount": fee,
                "net_amount": req.net_amount if req.net_amount is not None else req.amount - fee,
                "payout_reference": req.payout_reference, "reject_reason": req.reject_reason,
                "created_at": req.created_at,
            }

    # A sale is paid out net of the platform fee, which is booked on the
    # platform wallet under the same order reference: the seller sees both.
    release_refs = {t.reference_id for t in txs if t.type == TransactionType.purchase_release and t.reference_id}
    fee_by_ref: dict[str, int] = {}
    if release_refs:
        platform_wallet = await db.scalar(
            select(Wallet.id).where(Wallet.account_id == await platform_account_id(db))
        )
        if platform_wallet is not None and platform_wallet != wallet.id:
            rows = await db.execute(
                select(Transaction.reference_id, func.sum(Transaction.amount))
                .where(
                    Transaction.wallet_id == platform_wallet,
                    Transaction.type == TransactionType.platform_fee,
                    Transaction.reference_id.in_(release_refs),
                )
                .group_by(Transaction.reference_id)
            )
            fee_by_ref = {ref: int(total) for ref, total in rows.all()}

    out = []
    for t in txs:
        order_id = _order_id_from_reference(t.reference_id)
        status = order_status.get(order_id) if (order_id is not None and t.type == TransactionType.purchase_hold) else None
        withdraw_match = _WITHDRAW_REF.match(t.reference_id) if t.reference_id else None
        withdrawal = withdrawals.get(int(withdraw_match.group(1))) if withdraw_match else None
        out.append({
            "id": t.id, "type": t.type, "amount": t.amount,
            "direction": TRANSACTION_DIRECTION[t.type].value,
            "description": t.description,
            "reference_id": t.reference_id, "created_at": t.created_at, "order_status": status,
            "proof_images": private_images(t.proof_media) if with_proof else [],
            "order_code": order_codes.get(order_id) if order_id is not None else None,
            # A withdrawal's rows share the bank transfer's reference once it is paid.
            "reference_label": (withdrawal or {}).get("payout_reference") if withdraw_match else _reference_label(t.reference_id, order_codes),
            "withdraw_status": withdrawal["status"] if withdrawal else None,
            "withdrawal": withdrawal,
            "fee_amount": fee_by_ref.get(t.reference_id, 0) if t.type == TransactionType.purchase_release else None,
            "order_hidden": order_id in hidden_orders,
        })
    return out


async def request_withdraw(
    account_id: int, amount: int, db: AsyncSession,
    *, bank_bin: str | None = None, bank_name: str | None = None,
    bank_account_number: str | None = None, bank_account_holder: str | None = None,
) -> WithdrawRequest:
    """Lock ``amount`` for a bank payout an admin approves and pays later.

    A seller withdraws from its balance under its tier's per-request limit
    (``seller_balance``). Any other account withdraws only the affiliate
    commission it earned (``affiliate_commission``): at most
    ``affiliate.service.withdrawable_commission`` — never deposited money or
    cashback — and the seller tier limits do not apply. The minimum, fee, lock
    and approval flow are the same for both."""
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    # The wallet row lock serialises concurrent requests of one account, so the
    # commission cap below sees every earlier request.
    wallet = await get_wallet_by_account(account_id, db, for_update=True)
    if wallet.available_balance < amount:
        raise InsufficientCredit()
    account = await db.get(Account, account_id)
    if account is not None and "seller" in (account.roles or []):
        source = WITHDRAW_SOURCE_SELLER
        limit = (await rule_for(db, account.seller_tier or "new")).withdraw_limit_per_request
        if limit is not None and amount > limit:
            raise HTTPException(
                status_code=400,
                detail=f"Vượt hạn mức rút tiền theo cấp độ người bán (tối đa {limit:,}đ/lần)".replace(",", "."),
            )
    else:
        from src.affiliate.service import withdrawable_commission

        source = WITHDRAW_SOURCE_AFFILIATE
        cap = await withdrawable_commission(account_id, db)
        if amount > cap:
            raise api_error(ErrorCode.WITHDRAW_COMMISSION_EXCEEDED, status.HTTP_422_UNPROCESSABLE_CONTENT, limit=cap)
    fee_cfg = await get_fee_settings(db)
    if amount < int(fee_cfg["withdraw_min_amount"]):
        raise api_error(ErrorCode.WITHDRAW_BELOW_MINIMUM, status.HTTP_400_BAD_REQUEST)
    fee_amount = withdraw_fee_amount(amount, fee_cfg)
    if amount - fee_amount <= 0:
        raise api_error(ErrorCode.WITHDRAW_BELOW_MINIMUM, status.HTTP_400_BAD_REQUEST)
    # Khoá tiền ngay lúc gửi yêu cầu — tránh bug seller gửi nhiều yêu cầu rút
    # vượt quá số dư thực trước khi admin duyệt request nào.
    wallet.available_balance -= amount
    wallet.locked_balance += amount
    req = WithdrawRequest(
        account_id=account_id, amount=amount, fee_amount=fee_amount, net_amount=amount - fee_amount, source=source,
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
        metadata={"event": "withdraw_requested", "withdraw_id": req.id, "account_id": account_id, "amount": amount,
                  "fee_amount": fee_amount, "source": source},
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
        "fee_amount": req.fee_amount, "net_amount": req.net_amount if req.net_amount is not None else req.amount - req.fee_amount,
        "source": req.source or WITHDRAW_SOURCE_SELLER,
        "receipt_images": private_images(req.receipt_media),
    }


async def list_withdrawals(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(WithdrawRequest, Account.email)
        .join(Account, WithdrawRequest.account_id == Account.id)
        .order_by(WithdrawRequest.created_at.desc())
    )
    return [_withdraw_dict(req, email) for req, email in result.all()]


def _requester_href(req: WithdrawRequest) -> str:
    """Where the requester follows the request: sellers in their console,
    commission withdrawals (no seller console) in the wallet."""
    return "/wallet" if req.source == WITHDRAW_SOURCE_AFFILIATE else "/seller/withdrawals"


async def approve_withdrawal(req_id: int, db: AsyncSession) -> WithdrawRequest:
    """pending → approved: admin agrees to pay. Money stays locked and nothing
    is booked — it leaves the platform only when the transfer is confirmed
    (``mark_withdrawal_paid``), so the books never show a payout that has not
    happened yet."""
    req = await db.get(WithdrawRequest, req_id, with_for_update=True)
    if not req:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu rút tiền")
    if req.status != WithdrawStatus.pending:
        raise HTTPException(status_code=400, detail="Yêu cầu đã được xử lý")
    wallet = await get_wallet_by_account(req.account_id, db, for_update=True)
    if wallet.locked_balance < req.amount:
        raise HTTPException(status_code=409, detail="Số dư đang khoá không đủ cho yêu cầu này")
    req.status = WithdrawStatus.approved
    fee = int(req.fee_amount or 0)
    net = req.amount - fee
    await log_event(
        db, "info", f"Yêu cầu rút #{req.id} được DUYỆT ({req.amount:,}đ, account {req.account_id})".replace(",", "."),
        request_id=current_request_id(),
        metadata={"event": "withdraw_approved", "withdraw_id": req.id, "account_id": req.account_id, "amount": req.amount, "fee_amount": fee, "net_amount": net},
    )
    from src.mail.service import enqueue_mail, frontend_url
    await enqueue_mail(
        db,
        template="withdrawal_approved",
        account_id=req.account_id,
        idempotency_key=f"withdrawal_approved:{req.id}",
        payload={"amount": net, "action_url": frontend_url("vi", _requester_href(req))},
    )
    from src.notifications.history import notify
    await notify(db, req.account_id, "withdrawal_approved", category="wallet", params={"amount": net}, href=_requester_href(req))
    await db.commit()
    await db.refresh(req)
    return req


async def reject_withdrawal(req_id: int, reason: str, db: AsyncSession) -> WithdrawRequest:
    """pending/approved → rejected: the locked money goes back to the wallet.
    An approved request can still be rejected until the transfer is confirmed
    (wrong bank details found while paying), except legacy approvals whose
    payout was already booked under the old flow."""
    req = await db.get(WithdrawRequest, req_id, with_for_update=True)
    if not req:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu rút tiền")
    if req.status not in (WithdrawStatus.pending, WithdrawStatus.approved):
        raise HTTPException(status_code=400, detail="Yêu cầu đã được xử lý")
    if req.status == WithdrawStatus.approved and await _payout_booked(req, db):
        raise HTTPException(status_code=409, detail="Yêu cầu này đã ghi sổ chi tiền, không từ chối được nữa")
    cleaned = reason.strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Từ chối rút tiền phải kèm lý do")
    wallet = await get_wallet_by_account(req.account_id, db, for_update=True)
    if wallet.locked_balance < req.amount:
        # Nothing to give back: the money is no longer locked for this
        # request, so unlocking it would credit the seller a second time.
        raise HTTPException(status_code=409, detail="Số dư đang khoá không đủ cho yêu cầu này — tiền có thể đã được chi, kiểm tra sổ trước khi từ chối")
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
            "action_url": frontend_url("vi", _requester_href(req)),
        },
    )
    from src.notifications.history import notify
    await notify(
        db, req.account_id, "withdrawal_rejected", category="wallet",
        params={"amount": req.amount, "reason": req.reject_reason}, href=_requester_href(req),
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


async def _payout_booked(req: WithdrawRequest, db: AsyncSession) -> bool:
    """True once the payout left the platform in the ledger. Requests approved
    before balance layers (q1a2b3c4d5e6, 2026-07-16) were booked at approval
    with an unreferenced ``withdraw`` row and never got a ``withdraw-<id>``
    lock: the unreferenced payout of the same amount on that wallet counts."""
    ref = f"withdraw-{req.id}"
    rows = (await db.execute(
        select(Transaction.type).where(Transaction.reference_id == ref)
    )).scalars().all()
    if TransactionType.withdraw in rows:
        return True
    if rows:
        return False
    return await db.scalar(
        select(Transaction.id)
        .join(Wallet, Wallet.id == Transaction.wallet_id)
        .where(
            Wallet.account_id == req.account_id,
            Transaction.type == TransactionType.withdraw,
            Transaction.reference_id.is_(None),
            Transaction.amount.in_({req.amount, req.amount - int(req.fee_amount or 0)}),
            Transaction.created_at >= req.created_at,
        )
        .limit(1)
    ) is not None


async def _book_payout(req: WithdrawRequest, db: AsyncSession) -> None:
    wallet = await get_wallet_by_account(req.account_id, db, for_update=True)
    if wallet.locked_balance < req.amount:
        raise HTTPException(status_code=409, detail="Số dư đang khoá không đủ cho yêu cầu này")
    wallet.locked_balance -= req.amount
    fee = int(req.fee_amount or 0)
    net = req.amount - fee
    # Only the net transfer leaves the platform; the fee stays in the platform wallet (account 1).
    db.add(Transaction(
        wallet_id=wallet.id, type=TransactionType.withdraw,
        amount=net, description="Đã chuyển khoản rút tiền", reference_id=f"withdraw-{req.id}",
    ))
    if fee > 0:
        db.add(Transaction(
            wallet_id=wallet.id, type=TransactionType.withdraw_fee,
            amount=fee, description="Phí rút tiền", reference_id=f"withdraw-{req.id}",
        ))
        platform_wallet = await get_wallet_by_account(await platform_account_id(db), db, for_update=True)
        platform_wallet.available_balance += fee
        db.add(Transaction(
            wallet_id=platform_wallet.id, type=TransactionType.platform_fee,
            amount=fee, description="Withdrawal fee", reference_id=f"withdraw-{req.id}",
        ))


async def mark_withdrawal_paid(
    req_id: int, payout_reference: str, db: AsyncSession, *, actor_id: int | None = None, receipt_ids: list[str] | None = None,
) -> WithdrawRequest:
    """approved → paid: the transfer happened, so the money leaves the
    platform now. The locked amount is released; the net payout is booked as
    ``withdraw`` and the fee as ``withdraw_fee`` on the seller wallet plus
    ``platform_fee`` (reference ``withdraw-<id>``) on the platform wallet.
    Requests approved under the old flow already have those rows: they are
    only marked paid."""
    req = await db.get(WithdrawRequest, req_id, with_for_update=True)
    if not req:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu rút tiền")
    if req.status != WithdrawStatus.approved:
        raise HTTPException(status_code=400, detail="Chỉ xác nhận chuyển khoản cho yêu cầu đã duyệt")
    if not await _payout_booked(req, db):
        await _book_payout(req, db)
    req.status = WithdrawStatus.paid
    req.payout_reference = payout_reference
    req.paid_at = datetime.now(timezone.utc)
    if receipt_ids:
        req.receipt_media = await media_service.set_subject_media(
            db, actor_id=actor_id or 0, purpose=MediaPurpose.payout_receipt, subject_type=WITHDRAW_RECEIPT_SUBJECT,
            subject_id=req.id, public_ids=receipt_ids, max_count=MAX_PROOF_IMAGES,
        )
    await log_event(
        db, "info", f"Yêu cầu rút #{req.id} ĐÃ CHI TIỀN ({req.amount:,}đ, ref {payout_reference})".replace(",", "."),
        request_id=current_request_id(),
        metadata={"event": "withdraw_paid", "withdraw_id": req.id, "account_id": req.account_id,
                  "amount": req.amount, "payout_reference": payout_reference, "actor_id": actor_id,
                  "receipt_images": [snap["id"] for snap in (req.receipt_media or [])]},
    )
    from src.notifications.history import notify
    await notify(
        db, req.account_id, "withdrawal_paid", category="wallet",
        params={"amount": req.amount - int(req.fee_amount or 0)}, href=_requester_href(req),
    )
    await db.commit()
    await db.refresh(req)
    return req


async def transaction_proof_image(tx_id: int, media_id: str, db: AsyncSession) -> MediaObject:
    """Evidence image of a manual credit (admin only — enforced by the router)."""
    obj = await media_service.find_on_subject(db, media_id, subject_type=TRANSACTION_PROOF_SUBJECT, subject_ids=[tx_id])
    if obj is None:
        raise api_error(ErrorCode.MEDIA_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return obj


async def withdrawal_receipt_image(
    req_id: int, media_id: str, db: AsyncSession, *, owner_id: int | None = None,
) -> MediaObject:
    """Payout receipt of a withdrawal; ``owner_id`` restricts it to the seller who asked."""
    req = await db.get(WithdrawRequest, req_id)
    obj = None
    if req is not None and (owner_id is None or req.account_id == owner_id):
        obj = await media_service.find_on_subject(db, media_id, subject_type=WITHDRAW_RECEIPT_SUBJECT, subject_ids=[req_id])
    if obj is None:
        raise api_error(ErrorCode.MEDIA_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return obj
