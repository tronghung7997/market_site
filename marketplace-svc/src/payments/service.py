"""Luồng nạp tiền PayOS — thiết kế
docs/superpowers/specs/2026-07-23-bank-payment-design.md.

Bất biến quan trọng:
- `DepositIntent.id` == orderCode phía PayOS (map 1-1, không match memo).
- Credit ví theo SỐ TIỀN THỰC NHẬN từ webhook/đối soát, không theo số buyer hứa.
- Mọi đường dẫn tới credit đều đi qua duy nhất `apply_deposit_paid()` sau khi
  đã khoá intent FOR UPDATE — webhook và job đối soát không thể credit đôi.
"""
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.config import settings
from src.logging import current_request_id
from src.models.account import Account
from src.models.payment import DepositIntent, DepositIntentStatus, PayosWebhookEvent
from src.models.wallet import Transaction, TransactionType, Wallet
from src.payments import payos_client

logger = structlog.get_logger()


async def create_deposit(account_id: int, amount: int, db: AsyncSession) -> DepositIntent:
    if not payos_client.is_configured():
        raise HTTPException(status_code=503, detail="Cổng thanh toán chưa được cấu hình — liên hệ quản trị viên")
    if amount < settings.deposit_min_amount:
        raise HTTPException(
            status_code=422,
            detail=f"Số tiền nạp tối thiểu {settings.deposit_min_amount:,}đ".replace(",", "."),
        )
    if amount > settings.deposit_max_amount:
        raise HTTPException(
            status_code=422,
            detail=f"Số tiền nạp tối đa {settings.deposit_max_amount:,}đ mỗi lệnh".replace(",", "."),
        )
    pending_count = await db.scalar(
        select(func.count(DepositIntent.id)).where(
            DepositIntent.account_id == account_id,
            DepositIntent.status == DepositIntentStatus.pending,
        )
    )
    if (pending_count or 0) >= settings.deposit_max_pending_per_account:
        raise HTTPException(
            status_code=429,
            detail="Bạn đang có quá nhiều lệnh nạp chờ thanh toán — hoàn tất hoặc huỷ bớt trước",
        )

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.deposit_expire_minutes)
    intent = DepositIntent(account_id=account_id, amount=amount, expires_at=expires_at)
    db.add(intent)
    await db.flush()  # cần id làm orderCode

    try:
        data = await payos_client.create_payment_request(
            order_code=intent.id,
            amount=amount,
            # ≤ 9 ký tự với tài khoản chưa liên kết định danh — "NAP" + id
            description=f"NAP{intent.id}",
            return_url=f"{settings.frontend_base_url}/wallet",
            cancel_url=f"{settings.frontend_base_url}/wallet",
            expired_at=int(expires_at.timestamp()),
        )
    except (payos_client.PayOSError, payos_client.PayOSUnavailableError) as e:
        # Không để intent mồ côi: rollback xoá luôn row vừa flush.
        await db.rollback()
        logger.error("payos_create_failed", account_id=account_id, amount=amount, error=str(e))
        raise HTTPException(status_code=502, detail="Không tạo được link thanh toán — thử lại sau") from e

    intent.payment_link_id = data.get("paymentLinkId")
    intent.checkout_url = data.get("checkoutUrl")
    intent.qr_code = data.get("qrCode")
    # Mốc tiền vào log_entries (audit DB, hiện ở /admin/logs) — structlog chỉ
    # ra stdout, restart là mất dấu (review vận hành 24/07).
    await log_event(
        db, "info", f"Lệnh nạp #{intent.id} tạo — {amount:,}đ (account {account_id})".replace(",", "."),
        request_id=current_request_id(),
        metadata={"event": "deposit_created", "intent_id": intent.id, "account_id": account_id, "amount": amount},
    )
    await db.commit()
    await db.refresh(intent)
    return intent


async def cancel_deposit(intent_id: int, account_id: int, db: AsyncSession) -> DepositIntent:
    intent = await db.get(DepositIntent, intent_id, with_for_update=True)
    if intent is None or intent.account_id != account_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy lệnh nạp")
    if intent.status != DepositIntentStatus.pending:
        raise HTTPException(status_code=400, detail="Lệnh nạp không còn ở trạng thái chờ")
    intent.status = DepositIntentStatus.cancelled
    await log_event(
        db, "info", f"Lệnh nạp #{intent.id} bị huỷ bởi người dùng",
        request_id=current_request_id(),
        metadata={"event": "deposit_cancelled", "intent_id": intent.id, "account_id": account_id},
    )
    await db.commit()
    # Sau commit — huỷ phía PayOS best-effort, lỗi không ảnh hưởng trạng thái mình.
    await payos_client.cancel_payment(intent.id)
    await db.refresh(intent)
    return intent


async def list_deposits(account_id: int, db: AsyncSession, limit: int = 20) -> list[DepositIntent]:
    rows = await db.execute(
        select(DepositIntent)
        .where(DepositIntent.account_id == account_id)
        .order_by(DepositIntent.created_at.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())


async def apply_deposit_paid(
    intent: DepositIntent, paid_amount: int, reference: str | None, db: AsyncSession,
    *, source: str,
) -> None:
    """Credit ví cho một intent ĐÃ ĐƯỢC KHOÁ FOR UPDATE bởi caller và còn ở
    trạng thái chưa-paid. Đường duy nhất cộng tiền nạp — webhook lẫn job đối
    soát đều đi qua đây. Không commit — caller commit để credit + đổi trạng
    thái intent nằm chung transaction."""
    # UPDATE nguyên tử (balance = balance + X ngay trong SQL) thay vì đọc-rồi-
    # ghi qua ORM: hai webhook của HAI lệnh nạp khác nhau cùng account chạy
    # song song sẽ cùng đọc số dư cũ và ghi đè nhau — một khoản nạp bốc hơi
    # dù cả hai intent đều 'paid' và ledger đủ 2 dòng (review 24/07 #1).
    wallet_id = await db.scalar(
        update(Wallet)
        .where(Wallet.account_id == intent.account_id)
        .values(available_balance=Wallet.available_balance + paid_amount)
        .returning(Wallet.id)
    )
    if wallet_id is None:
        wallet = Wallet(account_id=intent.account_id, available_balance=paid_amount)
        db.add(wallet)
        await db.flush()
        wallet_id = wallet.id

    note = f"Nạp tiền qua PayOS (lệnh #{intent.id})"
    if paid_amount != intent.amount:
        note += f" — LỆCH: dự kiến {intent.amount}, thực nhận {paid_amount}"
        logger.warning(
            "deposit_amount_mismatch", intent_id=intent.id,
            expected=intent.amount, received=paid_amount, source=source,
        )
    db.add(Transaction(
        wallet_id=wallet_id, type=TransactionType.deposit, amount=paid_amount,
        description=note, reference_id=f"deposit-{intent.id}" + (f"-{reference}" if reference else ""),
    ))
    intent.status = DepositIntentStatus.paid
    intent.paid_amount = paid_amount
    intent.payos_reference = reference
    intent.paid_at = datetime.now(timezone.utc)
    logger.info("deposit_paid", intent_id=intent.id, amount=paid_amount, source=source)
    await log_event(
        db, "info",
        f"Lệnh nạp #{intent.id} ĐÃ NHẬN {paid_amount:,}đ (nguồn: {source}, ref {reference})".replace(",", "."),
        request_id=current_request_id(),
        metadata={"event": "deposit_paid", "intent_id": intent.id, "account_id": intent.account_id,
                  "amount": paid_amount, "source": source, "reference": reference},
    )


async def handle_webhook(payload: dict, db: AsyncSession) -> dict:
    """Xử lý một POST từ PayOS. Trả dict để router luôn 200 (trừ sai chữ ký
    — 401 ở router). Idempotent theo UNIQUE(payment_link_id, reference)."""
    data = payload.get("data") or {}
    payment_link_id = str(data.get("paymentLinkId") or "")
    reference = str(data.get("reference") or "")
    order_code = data.get("orderCode")
    amount = data.get("amount")

    # bool là subclass của int trong Python — loại tường minh, và amount phải
    # DƯƠNG: chữ ký hợp lệ không có nghĩa dữ liệu vô hại, một amount âm lọt
    # vào apply_deposit_paid sẽ TRỪ ví thay vì cộng.
    if (
        not payment_link_id or not reference
        or not isinstance(order_code, int) or isinstance(order_code, bool)
        or not isinstance(amount, int) or isinstance(amount, bool)
        or amount <= 0
    ):
        logger.warning("payos_webhook_bad_shape", payload_keys=sorted(payload.keys()))
        return {"ok": True, "note": "bỏ qua — payload thiếu field hoặc giá trị không hợp lệ"}

    # Sổ thô + idempotency: đã thấy (payment_link_id, reference) → no-op.
    inserted = await db.execute(
        pg_insert(PayosWebhookEvent)
        .values(
            payment_link_id=payment_link_id, order_code=order_code, reference=reference,
            amount=amount, raw=payload, signature_valid=True,
        )
        .on_conflict_do_nothing(constraint="uq_payos_events_link_reference")
        .returning(PayosWebhookEvent.id)
    )
    if inserted.scalar() is None:
        await db.commit()
        return {"ok": True, "note": "duplicate — đã xử lý trước đó"}

    # PayOS chỉ webhook giao dịch thành công; code trong data nói kết quả.
    if data.get("code") not in (None, "00"):
        await db.commit()
        return {"ok": True, "note": f"bỏ qua — data.code={data.get('code')}"}

    intent = await db.get(DepositIntent, order_code, with_for_update=True)
    if intent is None:
        await log_event(
            db, "error", f"Webhook PayOS orderCode {order_code} không khớp lệnh nạp nào ({amount}đ, ref {reference})",
            request_id=current_request_id(),
            metadata={"event": "deposit_webhook_unknown", "order_code": order_code, "amount": amount},
        )
        await db.commit()
        logger.error("payos_webhook_unknown_order_code", order_code=order_code)
        # emit_incident owns its session — call after the main flow commits.
        await _alert(
            db, "error",
            f"Webhook PayOS cho orderCode {order_code} không khớp lệnh nạp nào "
            f"(ref {reference}, {amount}đ) — tiền có thể đã nhận, cần đối soát tay",
            target_id=order_code,
            reason_code="unknown_order",
        )
        return {"ok": True, "note": "không tìm thấy lệnh nạp — đã ghi sổ, cần admin xem"}

    # Webhook có chữ ký nhưng trỏ nhầm lệnh (PayOS gửi lỗi / dữ liệu corrupt):
    # orderCode khớp mà paymentLinkId không khớp thì KHÔNG credit — link id là
    # danh tính thật của phiên thanh toán (review 24/07 #4).
    if intent.payment_link_id and payment_link_id != intent.payment_link_id:
        intent_id = intent.id
        await db.commit()
        logger.error(
            "payos_webhook_link_mismatch", intent_id=intent_id,
            expected=intent.payment_link_id, got=payment_link_id,
        )
        await _alert(
            db, "error",
            f"Webhook cho lệnh nạp #{intent_id} mang paymentLinkId lạ ({payment_link_id}) "
            f"— không credit, cần đối soát tay",
            target_id=intent_id,
            reason_code="link_mismatch",
        )
        return {"ok": True, "note": "paymentLinkId không khớp lệnh nạp — đã ghi sổ, không credit"}

    if intent.status == DepositIntentStatus.paid:
        intent_id = intent.id  # chốt trước commit — sau commit attribute hết hạn
        already_reference = intent.payos_reference
        await db.commit()
        # Reconcile job có thể đã credit TRƯỚC khi webhook gốc tới (webhook chỉ
        # chậm chứ không mất) — cùng reference nghĩa là cùng MỘT giao dịch,
        # tuyệt đối không báo "chuyển 2 lần" kẻo vận hành hoàn nhầm tiền
        # (review 24/07 #3).
        if already_reference and reference == already_reference:
            logger.info("payos_webhook_after_reconcile", intent_id=intent_id, reference=reference)
            return {"ok": True, "note": "webhook đến muộn của giao dịch đã đối soát — bỏ qua"}
        logger.warning("payos_webhook_already_paid", intent_id=intent_id, reference=reference)
        await _alert(
            db, "warning",
            f"Lệnh nạp #{intent_id} nhận THÊM giao dịch {amount}đ (ref {reference}) sau khi đã paid "
            f"(ref cũ {already_reference}) — khách có thể chuyển 2 lần, cần hoàn tay",
            target_id=intent_id,
            reason_code="double_payment",
        )
        return {"ok": True, "note": "lệnh đã paid trước đó — giao dịch thừa cần admin đối soát"}

    # expired/cancelled mà tiền vẫn về: tiền thật đã nhận thì vẫn credit
    # (chính sách §6.6 của thiết kế) — log + alert để admin biết.
    late_status = intent.status.value if intent.status in (DepositIntentStatus.expired, DepositIntentStatus.cancelled) else None
    if late_status:
        logger.warning("payos_webhook_late_payment", intent_id=intent.id, status=late_status)

    # Chốt các giá trị cần cho alert TRƯỚC commit — sau commit attribute ORM
    # hết hạn, đọc lại trên session async sẽ nổ MissingGreenlet.
    intent_id = intent.id
    expected_amount = intent.amount
    await apply_deposit_paid(intent, amount, reference, db, source="webhook")
    await db.commit()

    if late_status:
        await _alert(
            db, "warning",
            f"Lệnh nạp #{intent_id} được thanh toán MUỘN (trạng thái trước đó: {late_status}) — đã credit {amount}đ",
            target_id=intent_id,
            reason_code="late_payment",
        )
    if amount != expected_amount:
        await _alert(
            db, "warning",
            f"Lệnh nạp #{intent_id} lệch tiền: dự kiến {expected_amount}đ, thực nhận {amount}đ (đã credit theo thực nhận)",
            target_id=intent_id,
            reason_code="amount_mismatch",
        )
    return {"ok": True}


async def _alert(
    db: AsyncSession, severity: str, message: str, *, target_id: int, reason_code: str = "anomaly",
) -> None:
    """Alert vận hành cho các ca bất thường của luồng nạp — best-effort,
    không bao giờ được làm hỏng phản hồi webhook (PayOS cần 2xx).

    Uses emit_incident (own session) so webhook response path never depends
    on the caller's transaction state.
    """
    from src.alerts.service import emit_incident, fp_deposit

    try:
        await emit_incident(
            fingerprint=fp_deposit(target_id, reason_code),
            type_="deposit_anomaly",
            severity=severity,
            target_type="deposit",
            target_id=target_id,
            message=message,
        )
    except Exception as e:
        logger.error("deposit_alert_failed", error=str(e))


async def reconcile_intent(intent_id: int, db: AsyncSession) -> str:
    """Đối soát chủ động một intent với PayOS (bù miss webhook). Trả trạng
    thái sau đối soát."""
    intent = await db.get(DepositIntent, intent_id, with_for_update=True)
    if intent is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy lệnh nạp")
    if intent.status == DepositIntentStatus.paid:
        return intent.status.value

    try:
        info = await payos_client.get_payment_info(intent.id)
    except (payos_client.PayOSError, payos_client.PayOSUnavailableError) as e:
        # Chốt các giá trị cần dùng TRƯỚC rollback: `rollback()` expire TOÀN BỘ
        # object trong session (khác `commit()` — expire_on_commit=False không
        # cứu được ca này), nên đọc `intent.status` sau đó là một lazy-load
        # trong ngữ cảnh async → MissingGreenlet. Hệ quả trước khi sửa:
        # POST /admin/deposits/{id}/reconcile trả 500 mỗi lần PayOS lỗi mạng,
        # còn trong job thì bị `except Exception` nuốt mất.
        current_status = intent.status.value
        logger.warning("deposit_reconcile_failed", intent_id=intent_id, error=str(e))
        await db.rollback()
        return current_status

    status = info.get("status")
    if status == "PAID":
        paid_amount = int(info.get("amountPaid") or info.get("amount") or intent.amount)
        transactions = info.get("transactions") or []
        reference = None
        if transactions and isinstance(transactions[0], dict):
            reference = transactions[0].get("reference")
        await apply_deposit_paid(intent, paid_amount, reference, db, source="reconcile")
    elif status == "CANCELLED":
        intent.status = DepositIntentStatus.cancelled
    elif status == "EXPIRED":
        intent.status = DepositIntentStatus.expired
    await db.commit()
    return intent.status.value


async def list_payos_events(db: AsyncSession, order_code: int | None = None, limit: int = 50) -> list[dict]:
    """Sổ webhook thô cho admin đối soát — immutable, kèm cờ chữ ký."""
    q = select(PayosWebhookEvent).order_by(PayosWebhookEvent.received_at.desc()).limit(limit)
    if order_code is not None:
        q = q.where(PayosWebhookEvent.order_code == order_code)
    rows = await db.execute(q)
    return [
        {
            "id": e.id, "order_code": e.order_code, "payment_link_id": e.payment_link_id,
            "reference": e.reference, "amount": e.amount,
            "signature_valid": e.signature_valid, "received_at": e.received_at, "raw": e.raw,
        }
        for e in rows.scalars().all()
    ]


async def list_admin_deposits(db: AsyncSession, status: str | None, limit: int = 100) -> list[dict]:
    q = (
        select(DepositIntent, Account.email)
        .join(Account, DepositIntent.account_id == Account.id)
        .order_by(DepositIntent.created_at.desc())
        .limit(limit)
    )
    if status:
        q = q.where(DepositIntent.status == status)
    rows = await db.execute(q)
    out = []
    for intent, email in rows.all():
        out.append({
            "id": intent.id, "account_id": intent.account_id, "account_email": email,
            "amount": intent.amount, "status": intent.status.value,
            "checkout_url": intent.checkout_url, "qr_code": intent.qr_code,
            "paid_amount": intent.paid_amount, "payment_link_id": intent.payment_link_id,
            "payos_reference": intent.payos_reference,
            "created_at": intent.created_at, "expires_at": intent.expires_at, "paid_at": intent.paid_at,
        })
    return out
