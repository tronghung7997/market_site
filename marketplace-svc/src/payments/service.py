"""Luồng nạp tiền multi-provider (SePay bank transfer | NOWPayments).

SePay research: docs/superpowers/specs/2026-08-19-sepay-migration-research.md
NOW plan: docs/superpowers/plans/2026-08-11-nowpayments-usdt-deposit-plan.md

Bất biến:
- Ledger credit luôn VND integer qua `apply_deposit_paid` (FOR UPDATE).
- SePay: only credit an exact amount/account/payment-code match.
- NOW: credit đúng `intent.amount` (target VND) khi finished + actually_paid
  validated (không fallback pay_amount; merchant absorb fee/FX).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import structlog
from fastapi import HTTPException
from sqlalchemy import String, cast, exists, func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.config import settings
from src.database import SessionLocal
from src.logging import current_request_id
from src.models.account import Account
from src.models.payment import (
    DepositIntent,
    DepositIntentStatus,
    DepositProvider,
    NowpaymentsIpnEvent,
    PayosWebhookEvent,
    SePayWebhookEvent,
)
from src.models.wallet import Transaction, TransactionType, Wallet
from src.payments import fx, nowpayments_client, payos_client, rail_config, sepay_client

logger = structlog.get_logger()

QUOTE_DRIFT_ALERT_PCT = Decimal("2")
_NOW_RECONCILE_DEBUG_TAG = "[DEBUG-NOW-RECONCILE]"
_NOW_RECONCILE_DEBUG_ENABLED = False


def _redact_nowpayments_error(error: Exception) -> str:
    """Temporary reconcile diagnostics must never persist provider credentials."""
    safe_error = str(error)
    for secret in (
        settings.nowpayments_api_key,
        settings.nowpayments_ipn_secret,
        settings.nowpayments_auth_email,
        settings.nowpayments_auth_password,
    ):
        secret = str(secret or "").strip()
        if secret:
            safe_error = safe_error.replace(secret, "[REDACTED]")
    return safe_error[:1000]


async def _log_nowpayments_reconcile_debug(
    *,
    intent_id: int,
    branch: str,
    error: Exception | None = None,
    invoice_id: str | None = None,
    payment_id: str | None = None,
    config: dict[str, object] | None = None,
) -> None:
    """Persist temporary diagnostics independently from the rolled-back reconcile transaction."""
    if not _NOW_RECONCILE_DEBUG_ENABLED:
        return
    safe_error = _redact_nowpayments_error(error) if error is not None else None
    error_type = type(error).__name__ if error is not None else None
    message = f"{_NOW_RECONCILE_DEBUG_TAG} Lệnh nạp #{intent_id}: branch={branch}"
    if error_type and safe_error:
        message = f"{message}; {error_type}: {safe_error}"
    try:
        async with SessionLocal() as log_db:
            await log_event(
                log_db,
                "error" if error is not None else "warning",
                message,
                request_id=current_request_id(),
                metadata={
                    "event": "nowpayments_reconcile_debug",
                    "order_id": intent_id,
                    "intent_id": intent_id,
                    "provider": "nowpayments",
                    "branch": branch,
                    "error_type": error_type,
                    "error": safe_error,
                    "now_invoice_id": invoice_id,
                    "now_payment_id": payment_id,
                    "config": config,
                    "temporary": True,
                },
            )
            await log_db.commit()
    except Exception as log_error:  # Diagnostics must never break reconciliation.
        logger.warning(
            "nowpayments_reconcile_debug_log_failed",
            intent_id=intent_id,
            branch=branch,
            error=_redact_nowpayments_error(log_error),
        )


async def deposit_methods_public(db: AsyncSession) -> dict:
    """Buyer-facing rails: admin flag AND secrets present."""
    methods = await rail_config.public_methods(db)
    await db.commit()
    return methods


async def _pending_cap_check(account_id: int, db: AsyncSession) -> None:
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


async def create_deposit(
    account_id: int,
    amount: int,
    db: AsyncSession,
    *,
    method: str = "sepay",
    pay_currency: str | None = None,
) -> DepositIntent:
    method = (method or "sepay").lower().strip()
    if method == DepositProvider.nowpayments.value:
        return await _create_nowpayments_deposit(account_id, amount, db, pay_currency=pay_currency)
    if method != DepositProvider.sepay.value:
        raise HTTPException(status_code=400, detail=f"Phương thức nạp không hỗ trợ: {method}")
    return await _create_sepay_deposit(account_id, amount, db)


async def _create_sepay_deposit(account_id: int, amount: int, db: AsyncSession) -> DepositIntent:
    rail = await rail_config.ensure_seeded(db)
    if not rail.sepay_enabled:
        raise HTTPException(status_code=503, detail="Nạp chuyển khoản tạm thời không khả dụng")
    if not sepay_client.is_configured():
        raise HTTPException(status_code=503, detail="SePay chưa được cấu hình — liên hệ quản trị viên")
    if amount < rail.deposit_min_amount:
        raise HTTPException(
            status_code=422,
            detail=f"Số tiền nạp tối thiểu {rail.deposit_min_amount:,}đ".replace(",", "."),
        )
    if amount > rail.deposit_max_amount:
        raise HTTPException(
            status_code=422,
            detail=f"Số tiền nạp tối đa {rail.deposit_max_amount:,}đ mỗi lệnh".replace(",", "."),
        )
    await _pending_cap_check(account_id, db)

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=rail.deposit_expire_minutes)
    try:
        payment_code = sepay_client.generate_payment_code()
        qr_code = sepay_client.build_vietqr_url(
            amount=amount,
            payment_code=payment_code,
        )
    except ValueError as exc:
        await db.rollback()
        logger.error("sepay_qr_create_failed", account_id=account_id, amount=amount, error=str(exc))
        raise HTTPException(status_code=503, detail="Cấu hình SePay không hợp lệ") from exc

    intent = DepositIntent(
        account_id=account_id,
        amount=amount,
        expires_at=expires_at,
        provider=DepositProvider.sepay.value,
        payment_code=payment_code,
        bank_code=settings.sepay_bank_code.strip(),
        bank_account_number=settings.sepay_bank_account_number.strip(),
        bank_account_name=settings.sepay_bank_account_name.strip(),
        qr_code=qr_code,
    )
    db.add(intent)
    await db.flush()

    await log_event(
        db,
        "info",
        f"Lệnh nạp SePay #{intent.id} tạo — {amount:,}đ (account {account_id})".replace(",", "."),
        request_id=current_request_id(),
        metadata={
            "event": "deposit_created",
            "intent_id": intent.id,
            "account_id": account_id,
            "amount": amount,
            "provider": "sepay",
            "payment_code": intent.payment_code,
        },
    )
    await db.commit()
    await db.refresh(intent)
    return intent


async def _create_nowpayments_deposit(
    account_id: int,
    amount: int,
    db: AsyncSession,
    *,
    pay_currency: str | None = None,
) -> DepositIntent:
    rail = await rail_config.ensure_seeded(db)
    if not rail.nowpayments_enabled:
        raise HTTPException(status_code=503, detail="Nạp USDT tạm thời không khả dụng")
    if not nowpayments_client.is_configured():
        raise HTTPException(status_code=503, detail="Cổng USDT chưa được cấu hình — liên hệ quản trị viên")

    # Hosted invoice owns network selection. A caller must not be able to pin
    # an arbitrary asset or bypass the merchant's USDT-only coin settings.
    if pay_currency:
        raise HTTPException(
            status_code=400,
            detail="Chọn mạng USDT trên trang thanh toán an toàn của NOWPayments",
        )

    if amount < rail.deposit_usdt_min_vnd:
        raise HTTPException(
            status_code=422,
            detail=f"Số tiền nạp USDT tối thiểu {rail.deposit_usdt_min_vnd:,}đ".replace(",", "."),
        )
    if amount > rail.deposit_usdt_max_vnd:
        raise HTTPException(
            status_code=422,
            detail=f"Số tiền nạp USDT tối đa {rail.deposit_usdt_max_vnd:,}đ mỗi lệnh".replace(",", "."),
        )
    await _pending_cap_check(account_id, db)

    from src.money.service import get_effective_rate

    rate = await get_effective_rate(db)
    if rate is None or rate <= 0:
        raise HTTPException(status_code=503, detail="Tỷ giá hiển thị chưa cấu hình — không tạo được lệnh USDT")

    try:
        quoted_usd = fx.vnd_to_usd_quote(amount, rate)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=rail.deposit_usdt_local_window_minutes)
    intent = DepositIntent(
        account_id=account_id,
        amount=amount,
        expires_at=expires_at,
        provider=DepositProvider.nowpayments.value,
        price_currency="usd",
        quoted_usd_amount=quoted_usd,
        vnd_per_usd_snapshot=rate,
    )
    db.add(intent)
    await db.flush()

    order_id = nowpayments_client.format_order_id(intent.id)
    try:
        data = await nowpayments_client.create_invoice(
            price_amount=quoted_usd,
            price_currency="usd",
            order_id=order_id,
            order_description=f"Wallet deposit #{intent.id}",
        )
    except (nowpayments_client.NowPaymentsError, nowpayments_client.NowPaymentsUnavailableError) as e:
        await db.rollback()
        logger.error("nowpayments_create_failed", account_id=account_id, amount=amount, error=str(e))
        raise HTTPException(status_code=502, detail="Không tạo được lệnh nạp USDT — thử lại sau") from e

    intent.now_invoice_id = str(data.get("id"))
    intent.checkout_url = str(data.get("invoice_url"))
    intent.external_reference = intent.now_invoice_id

    await log_event(
        db, "info",
        f"Lệnh nạp USDT #{intent.id} tạo checkout: {amount:,}đ / ~{quoted_usd} USD".replace(",", "."),
        request_id=current_request_id(),
        metadata={
            "event": "deposit_created",
            "intent_id": intent.id,
            "account_id": account_id,
            "amount": amount,
            "provider": "nowpayments",
            "now_invoice_id": intent.now_invoice_id,
            "quoted_usd": str(quoted_usd),
        },
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
    provider = intent.provider or DepositProvider.sepay.value
    await log_event(
        db, "info", f"Lệnh nạp #{intent.id} bị huỷ bởi người dùng",
        request_id=current_request_id(),
        metadata={
            "event": "deposit_cancelled",
            "intent_id": intent.id,
            "account_id": account_id,
            "provider": provider,
        },
    )
    await db.commit()
    if provider == DepositProvider.payos.value:
        await payos_client.cancel_payment(intent.id)
    # NOW has no hard cancel API — local cancel only; late finished still credits.
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
    intent: DepositIntent,
    paid_amount: int,
    reference: str | None,
    db: AsyncSession,
    *,
    source: str,
    paid_crypto_amount: Decimal | None = None,
    outcome_amount: Decimal | None = None,
    outcome_currency: str | None = None,
) -> None:
    """Credit ví cho intent ĐÃ KHOÁ FOR UPDATE và chưa paid. Không commit."""
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

    provider = intent.provider or DepositProvider.sepay.value
    if provider == DepositProvider.nowpayments.value:
        note = f"Nạp tiền USDT (lệnh #{intent.id})"
        intent.external_reference = reference
    elif provider == DepositProvider.sepay.value:
        note = f"Nạp tiền qua SePay (lệnh #{intent.id})"
        intent.sepay_reference = reference
        intent.external_reference = reference
    else:
        note = f"Nạp tiền qua PayOS (lệnh #{intent.id})"
        intent.payos_reference = reference

    if paid_amount != intent.amount:
        note += f" — LỆCH: dự kiến {intent.amount}, thực nhận {paid_amount}"
        logger.warning(
            "deposit_amount_mismatch", intent_id=intent.id,
            expected=intent.amount, received=paid_amount, source=source, provider=provider,
        )
    db.add(Transaction(
        wallet_id=wallet_id, type=TransactionType.deposit, amount=paid_amount,
        description=note, reference_id=f"deposit-{intent.id}" + (f"-{reference}" if reference else ""),
    ))
    intent.status = DepositIntentStatus.paid
    intent.paid_amount = paid_amount
    if paid_crypto_amount is not None:
        intent.paid_crypto_amount = paid_crypto_amount
    if outcome_amount is not None:
        intent.outcome_amount = outcome_amount
    if outcome_currency is not None:
        intent.outcome_currency = outcome_currency
    intent.paid_at = datetime.now(timezone.utc)
    logger.info(
        "deposit_paid", intent_id=intent.id, amount=paid_amount,
        source=source, provider=provider,
    )
    await log_event(
        db, "info",
        f"Lệnh nạp #{intent.id} ĐÃ NHẬN {paid_amount:,}đ (nguồn: {source}, ref {reference})".replace(",", "."),
        request_id=current_request_id(),
        metadata={
            "event": "deposit_paid",
            "intent_id": intent.id,
            "account_id": intent.account_id,
            "amount": paid_amount,
            "source": source,
            "reference": reference,
            "provider": provider,
            "paid_crypto_amount": str(paid_crypto_amount) if paid_crypto_amount is not None else None,
        },
    )


# ---------------------------------------------------------------------------
# SePay bank transaction webhook
# ---------------------------------------------------------------------------


async def handle_sepay_webhook(payload: dict, db: AsyncSession) -> dict:
    """Process a signature-verified SePay transaction and ACK business rejects.

    Invalid HMAC/timestamps are rejected by the router.  Every validly-signed
    transaction with a usable ID is journaled before business matching so
    retries and manual replay remain race-safe.
    """
    transaction_id_raw = payload.get("id")
    transaction_id = str(transaction_id_raw or "").strip()
    payment_code = str(payload.get("code") or "").strip().upper() or None
    reference = str(payload.get("referenceCode") or "").strip() or None
    account_number = str(payload.get("accountNumber") or "").strip()
    transfer_type = str(payload.get("transferType") or "").strip().lower()
    amount = payload.get("transferAmount")

    if (
        not transaction_id
        or len(transaction_id) > 64
        or isinstance(transaction_id_raw, bool)
        or not account_number
        or not isinstance(amount, int)
        or isinstance(amount, bool)
        or amount <= 0
    ):
        logger.warning("sepay_webhook_bad_shape", payload_keys=sorted(payload.keys()))
        return {"note": "invalid payload shape"}

    inserted = await db.execute(
        pg_insert(SePayWebhookEvent)
        .values(
            transaction_id=transaction_id,
            payment_code=payment_code,
            reference=reference,
            account_number=account_number,
            amount=amount,
            source="webhook",
            signature_valid=True,
            raw=payload,
        )
        .on_conflict_do_nothing(constraint="uq_sepay_events_transaction_id")
        .returning(SePayWebhookEvent.id)
    )
    if inserted.scalar() is None:
        await db.commit()
        return {"note": "duplicate transaction"}

    if transfer_type != "in":
        await db.commit()
        return {"note": "outgoing transaction ignored"}

    expected_account = settings.sepay_bank_account_number.strip()
    if account_number != expected_account:
        await db.commit()
        logger.error(
            "sepay_webhook_account_mismatch",
            transaction_id=transaction_id,
            expected=expected_account,
            got=account_number,
        )
        await _alert(
            db,
            "error",
            f"SePay transaction {transaction_id} vào tài khoản lạ {account_number} — không credit",
            target_id=0,
            reason_code="bank_account_mismatch",
        )
        return {"note": "bank account mismatch"}

    if not sepay_client.is_valid_payment_code(payment_code):
        await db.commit()
        logger.warning("sepay_webhook_unmatched_code", code=payment_code, transaction_id=transaction_id)
        return {"note": "payment code missing or invalid"}

    intent = await db.scalar(
        select(DepositIntent)
        .where(DepositIntent.payment_code == payment_code)
        .with_for_update()
    )
    if intent is None:
        await db.commit()
        logger.error("sepay_webhook_unknown_intent", payment_code=payment_code, transaction_id=transaction_id)
        await _alert(
            db,
            "error",
            f"SePay code {payment_code} không khớp lệnh nạp nào ({amount}đ, ref {reference})",
            target_id=0,
            reason_code="unknown_order",
        )
        return {"note": "unknown deposit intent"}

    intent_id = intent.id

    if (
        intent.provider != DepositProvider.sepay.value
        or intent.payment_code != payment_code
        or intent.bank_account_number != account_number
    ):
        intent_provider = intent.provider
        await db.commit()
        logger.error(
            "sepay_webhook_intent_mismatch",
            intent_id=intent_id,
            provider=intent_provider,
            payment_code=payment_code,
            account_number=account_number,
        )
        await _alert(
            db,
            "error",
            f"SePay transaction {transaction_id} không khớp provider/code/tài khoản của lệnh #{intent_id}",
            target_id=intent_id,
            reason_code="intent_mismatch",
        )
        return {"note": "intent fields mismatch"}

    if intent.status == DepositIntentStatus.paid:
        same_payment = (
            (intent.sepay_transaction_id and intent.sepay_transaction_id == transaction_id)
            or (reference and intent.sepay_reference == reference)
        )
        await db.commit()
        if same_payment:
            return {"note": "payment already reconciled"}
        await _alert(
            db,
            "warning",
            f"Lệnh nạp #{intent_id} nhận thêm giao dịch {amount}đ (ref {reference}) sau khi đã paid",
            target_id=intent_id,
            reason_code="double_payment",
        )
        return {"note": "additional payment requires manual review"}

    if amount != intent.amount:
        expected_amount = intent.amount
        await db.commit()
        logger.warning(
            "sepay_webhook_amount_mismatch",
            intent_id=intent_id,
            expected=expected_amount,
            received=amount,
        )
        await _alert(
            db,
            "warning",
            f"Lệnh nạp #{intent_id} lệch tiền: dự kiến {expected_amount}đ, thực nhận {amount}đ — chưa credit",
            target_id=intent_id,
            reason_code="amount_mismatch",
        )
        return {"note": "amount mismatch requires manual review"}

    late_status = (
        intent.status.value
        if intent.status in (DepositIntentStatus.expired, DepositIntentStatus.cancelled)
        else None
    )
    intent.sepay_transaction_id = transaction_id
    await apply_deposit_paid(intent, intent.amount, reference or transaction_id, db, source="sepay_webhook")
    await db.commit()

    if late_status:
        await _alert(
            db,
            "warning",
            f"Lệnh nạp #{intent_id} thanh toán muộn sau trạng thái {late_status} — đã credit {amount}đ",
            target_id=intent_id,
            reason_code="late_payment",
        )
    return {"note": "credited"}


# ---------------------------------------------------------------------------
# Legacy PayOS webhook — retained only for intents created before cutover
# ---------------------------------------------------------------------------


async def handle_webhook(payload: dict, db: AsyncSession) -> dict:
    """Xử lý một POST từ PayOS. Trả dict để router luôn 200 (trừ sai chữ ký)."""
    data = payload.get("data") or {}
    payment_link_id = str(data.get("paymentLinkId") or "")
    reference = str(data.get("reference") or "")
    order_code = data.get("orderCode")
    amount = data.get("amount")

    if (
        not payment_link_id or not reference
        or not isinstance(order_code, int) or isinstance(order_code, bool)
        or not isinstance(amount, int) or isinstance(amount, bool)
        or amount <= 0
    ):
        logger.warning("payos_webhook_bad_shape", payload_keys=sorted(payload.keys()))
        return {"ok": True, "note": "bỏ qua — payload thiếu field hoặc giá trị không hợp lệ"}

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
        await _alert(
            db, "error",
            f"Webhook PayOS cho orderCode {order_code} không khớp lệnh nạp nào "
            f"(ref {reference}, {amount}đ) — tiền có thể đã nhận, cần đối soát tay",
            target_id=order_code,
            reason_code="unknown_order",
        )
        return {"ok": True, "note": "không tìm thấy lệnh nạp — đã ghi sổ, cần admin xem"}

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
        intent_id = intent.id
        already_reference = intent.payos_reference
        await db.commit()
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

    late_status = intent.status.value if intent.status in (DepositIntentStatus.expired, DepositIntentStatus.cancelled) else None
    if late_status:
        logger.warning("payos_webhook_late_payment", intent_id=intent.id, status=late_status)

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


# ---------------------------------------------------------------------------
# NOWPayments IPN
# ---------------------------------------------------------------------------


async def handle_nowpayments_ipn(payload: dict, db: AsyncSession) -> dict:
    """Process verified NOW IPN. Caller already verified signature.

    Always prefer 200 for unknown/bad business cases to avoid retry storms
    (except signature — 401 at router).
    """
    payment_id = str(payload.get("payment_id") or "").strip()
    payment_status = str(payload.get("payment_status") or "").strip().lower()
    order_id_raw = payload.get("order_id")
    order_id_str = str(order_id_raw) if order_id_raw is not None else None

    if not payment_id or not payment_status:
        logger.warning("nowpayments_ipn_bad_shape", keys=sorted(payload.keys()))
        return {"ok": True, "note": "missing payment_id/status"}

    p_hash = nowpayments_client.payload_hash(payload)
    inserted = await db.execute(
        pg_insert(NowpaymentsIpnEvent)
        .values(
            payment_id=payment_id,
            payment_status=payment_status,
            order_id=order_id_str,
            payload_hash=p_hash,
            signature_valid=True,
            raw=payload,
        )
        .on_conflict_do_nothing(constraint="uq_nowpayments_ipn_payment_status_hash")
        .returning(NowpaymentsIpnEvent.id)
    )
    if inserted.scalar() is None:
        await db.commit()
        return {"ok": True, "note": "duplicate ipn"}

    # Non-terminal statuses: journal only.
    if payment_status != "finished":
        await db.commit()
        return {"ok": True, "note": f"status={payment_status} — no credit"}

    intent_id = nowpayments_client.parse_order_id(order_id_str)
    if intent_id is None:
        await db.commit()
        logger.error("nowpayments_ipn_bad_order_id", order_id=order_id_str, payment_id=payment_id)
        await _alert(
            db, "error",
            f"NOW IPN finished với order_id không parse được ({order_id_str}), payment_id={payment_id}",
            target_id=0,
            reason_code="bad_order_id",
        )
        return {"ok": True, "note": "unparseable order_id"}

    intent = await db.get(DepositIntent, intent_id, with_for_update=True)
    if intent is None:
        await db.commit()
        logger.error("nowpayments_ipn_unknown_intent", intent_id=intent_id, payment_id=payment_id)
        await _alert(
            db, "error",
            f"NOW IPN finished cho DEP-{intent_id} không tồn tại (payment_id={payment_id})",
            target_id=intent_id,
            reason_code="unknown_order",
        )
        return {"ok": True, "note": "unknown intent"}

    credited = await _try_credit_nowpayments_finished(
        intent, payload, db, source="ipn",
    )
    await db.commit()
    return {"ok": True, "note": "credited" if credited else "finished but not credited"}


async def _try_credit_nowpayments_finished(
    intent: DepositIntent,
    payload: dict,
    db: AsyncSession,
    *,
    source: str,
) -> bool:
    """Validate finished payload against intent and credit target VND if OK.

    Caller holds FOR UPDATE on intent. Does not commit.
    Returns True if credit applied.
    """
    payment_id = str(payload.get("payment_id") or "").strip()
    order_id_str = str(payload.get("order_id") or "")
    invoice_id = str(payload.get("invoice_id") or "").strip()
    intent_id = intent.id

    if intent.provider != DepositProvider.nowpayments.value:
        logger.error("nowpayments_credit_wrong_provider", intent_id=intent_id, provider=intent.provider)
        await _alert(
            db, "error",
            f"NOW finished cho intent #{intent_id} nhưng provider={intent.provider}",
            target_id=intent_id,
            reason_code="provider_mismatch",
        )
        return False

    # A hosted invoice gets a payment_id only after the buyer picks a network.
    # Bind it to this intent through the immutable invoice_id first.
    if intent.now_invoice_id and invoice_id != str(intent.now_invoice_id):
        logger.error(
            "nowpayments_invoice_id_mismatch",
            intent_id=intent_id, expected=intent.now_invoice_id, got=invoice_id or None,
        )
        await _alert(
            db, "error",
            f"NOW invoice_id thiếu/lạ cho lệnh #{intent_id}",
            target_id=intent_id,
            reason_code="invoice_id_mismatch",
        )
        return False

    if intent.now_payment_id and payment_id != str(intent.now_payment_id):
        logger.error(
            "nowpayments_payment_id_mismatch",
            intent_id=intent_id, expected=intent.now_payment_id, got=payment_id,
        )
        await _alert(
            db, "error",
            f"NOW payment_id lạ cho lệnh #{intent_id}: got {payment_id}, expected {intent.now_payment_id}",
            target_id=intent_id,
            reason_code="payment_id_mismatch",
        )
        return False

    # Strict: order_id and pay_currency MUST be present and match intent.
    expected_order = nowpayments_client.format_order_id(intent_id)
    if not order_id_str or order_id_str != expected_order:
        logger.error(
            "nowpayments_order_id_mismatch",
            intent_id=intent_id, expected=expected_order, got=order_id_str or None,
        )
        await _alert(
            db, "error",
            f"NOW order_id thiếu/lạ cho lệnh #{intent_id}: {order_id_str or '(empty)'} (expected {expected_order})",
            target_id=intent_id,
            reason_code="order_id_mismatch",
        )
        return False

    pay_currency = str(payload.get("pay_currency") or "").lower().strip()
    expected_currency = (intent.pay_currency or "").lower().strip()
    is_hosted_usdt = bool(intent.now_invoice_id)
    # Hosted checkout: buyer picks network on NOW. Trust merchant coin settings
    # there; here only require a USDT family code (usdtbsc, usdttrc20, usdtsol…).
    # Non-hosted (legacy pinned payment) still requires exact match to intent.
    currency_matches = (
        pay_currency.startswith("usdt") if is_hosted_usdt
        else bool(expected_currency) and pay_currency == expected_currency
    )
    if not pay_currency or not currency_matches:
        logger.error(
            "nowpayments_currency_mismatch",
            intent_id=intent_id, expected=expected_currency or None, got=pay_currency or None,
        )
        await _alert(
            db, "error",
            f"NOW pay_currency thiếu/lạ cho lệnh #{intent_id}: {pay_currency or '(empty)'} "
            f"(expected {'USDT network' if is_hosted_usdt else (expected_currency or '(unset on intent)')})",
            target_id=intent_id,
            reason_code="currency_mismatch",
        )
        return False

    # First finished IPN binds this invoice to its payment reference. Subsequent
    # payments for the same invoice cannot become a second credit.
    if not intent.now_payment_id:
        intent.now_payment_id = payment_id
        intent.pay_currency = pay_currency

    actually_paid = nowpayments_client.parse_decimal(payload.get("actually_paid"))
    # Never fall back to pay_amount for "received" proof.
    if actually_paid is None or actually_paid <= 0:
        logger.error(
            "nowpayments_actually_paid_invalid",
            intent_id=intent_id, actually_paid=payload.get("actually_paid"),
        )
        await _alert(
            db, "error",
            f"NOW finished #{intent_id} nhưng actually_paid không hợp lệ ({payload.get('actually_paid')}) — không credit",
            target_id=intent_id,
            reason_code="actually_paid_invalid",
        )
        return False

    # Direct payments have the required amount at creation. Hosted invoices
    # reveal it only once NOWPayments has created the selected-network payment.
    required_pay_amount = intent.pay_amount or nowpayments_client.parse_decimal(payload.get("pay_amount"))
    if required_pay_amount is None or required_pay_amount <= 0:
        logger.error("nowpayments_pay_amount_invalid", intent_id=intent_id, pay_amount=payload.get("pay_amount"))
        await _alert(
            db, "error",
            f"NOW finished #{intent_id} nhưng pay_amount không hợp lệ - không credit",
            target_id=intent_id,
            reason_code="pay_amount_invalid",
        )
        return False
    if fx.underpay(actually_paid, Decimal(required_pay_amount)):
        logger.warning(
            "nowpayments_underpay",
            intent_id=intent_id, actually_paid=str(actually_paid), pay_amount=str(required_pay_amount),
        )
        await _alert(
            db, "warning",
            f"NOW underpay lệnh #{intent_id}: paid {actually_paid} < required {required_pay_amount} — không credit phase 1",
            target_id=intent_id,
            reason_code="underpay",
        )
        return False

    if intent.pay_amount is None:
        intent.pay_amount = required_pay_amount

    if intent.status == DepositIntentStatus.paid:
        already = intent.external_reference or intent.now_payment_id
        if already and str(already) == payment_id:
            logger.info("nowpayments_already_paid_same_ref", intent_id=intent_id)
            return False
        await _alert(
            db, "warning",
            f"Lệnh nạp USDT #{intent_id} đã paid nhưng nhận finished khác (ref {payment_id}, cũ {already})",
            target_id=intent_id,
            reason_code="double_payment",
        )
        return False

    late_status = (
        intent.status.value
        if intent.status in (DepositIntentStatus.expired, DepositIntentStatus.cancelled)
        else None
    )

    outcome_amount = nowpayments_client.parse_decimal(payload.get("outcome_amount"))
    outcome_currency = payload.get("outcome_currency")
    if outcome_currency is not None:
        outcome_currency = str(outcome_currency).lower()

    # Gross-target: always credit intent.amount (buyer-facing promise).
    await apply_deposit_paid(
        intent,
        intent.amount,
        payment_id,
        db,
        source=source,
        paid_crypto_amount=actually_paid,
        outcome_amount=outcome_amount,
        outcome_currency=outcome_currency,
    )

    if late_status:
        await _alert(
            db, "warning",
            f"Lệnh nạp USDT #{intent_id} finished MUỘN (trước đó: {late_status}) — đã credit {intent.amount}đ",
            target_id=intent_id,
            reason_code="late_payment",
        )

    # Quote-drift alert (merchant exposure visibility only).
    if intent.vnd_per_usd_snapshot:
        from src.money.service import get_effective_rate
        live = await get_effective_rate(db)
        if live and live > 0:
            drift = fx.quote_drift_pct(intent.vnd_per_usd_snapshot, live)
            if drift > QUOTE_DRIFT_ALERT_PCT:
                await _alert(
                    db, "warning",
                    f"Lệnh nạp USDT #{intent_id}: FX drift {drift}% "
                    f"(snapshot {intent.vnd_per_usd_snapshot} → live {live}) — vẫn credit target VND",
                    target_id=intent_id,
                    reason_code="fx_drift",
                )
    return True


async def _alert(
    db: AsyncSession, severity: str, message: str, *, target_id: int, reason_code: str = "anomaly",
) -> None:
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


# ---------------------------------------------------------------------------
# Reconcile
# ---------------------------------------------------------------------------


def _reconcile_outcome(
    status: str,
    *,
    provider_status: str | None,
    reconcile_result: str,
) -> dict:
    return {
        "status": status,
        "provider_status": provider_status,
        "reconcile_result": reconcile_result,
    }


async def reconcile_intent(intent_id: int, db: AsyncSession) -> dict:
    intent = await db.get(DepositIntent, intent_id, with_for_update=True)
    if intent is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy lệnh nạp")
    if intent.status == DepositIntentStatus.paid:
        return _reconcile_outcome(
            intent.status.value,
            provider_status=None,
            reconcile_result="already_paid",
        )

    provider = intent.provider or DepositProvider.sepay.value
    if provider == DepositProvider.nowpayments.value:
        return await _reconcile_nowpayments(intent, db)
    if provider == DepositProvider.sepay.value:
        return await _reconcile_sepay(intent, db)
    return await _reconcile_payos(intent, db)


async def _reconcile_sepay(intent: DepositIntent, db: AsyncSession) -> dict:
    if not sepay_client.is_reconciliation_configured():
        outcome = _reconcile_outcome(
            intent.status.value,
            provider_status=None,
            reconcile_result="not_configured",
        )
        await db.rollback()
        return outcome
    if not intent.payment_code or not intent.bank_account_number:
        outcome = _reconcile_outcome(
            intent.status.value,
            provider_status=None,
            reconcile_result="validation_failed",
        )
        await db.rollback()
        return outcome

    intent_id = intent.id
    try:
        matches = await sepay_client.list_matching_transactions(
            payment_code=intent.payment_code,
            amount=intent.amount,
            created_at=intent.created_at - timedelta(minutes=5),
        )
    except (sepay_client.SePayError, sepay_client.SePayUnavailableError) as exc:
        outcome = _reconcile_outcome(
            intent.status.value,
            provider_status=None,
            reconcile_result="provider_error",
        )
        logger.warning("deposit_reconcile_failed", intent_id=intent_id, error=str(exc), provider="sepay")
        await db.rollback()
        return outcome

    if not matches:
        await db.commit()
        return _reconcile_outcome(
            intent.status.value,
            provider_status="not_found",
            reconcile_result="not_found",
        )

    tx = matches[0]
    transaction_id = str(tx["id"])
    reference = str(tx.get("reference_number") or "").strip() or transaction_id
    try:
        amount = int(tx.get("amount_in") or 0)
    except (TypeError, ValueError):
        amount = 0
    if amount != intent.amount:
        outcome = _reconcile_outcome(
            intent.status.value,
            provider_status="invalid_amount",
            reconcile_result="validation_failed",
        )
        await db.rollback()
        return outcome

    await db.execute(
        pg_insert(SePayWebhookEvent)
        .values(
            transaction_id=transaction_id,
            payment_code=intent.payment_code,
            reference=reference,
            account_number=intent.bank_account_number,
            amount=amount,
            source="reconcile",
            signature_valid=None,
            raw=tx,
        )
        .on_conflict_do_nothing(constraint="uq_sepay_events_transaction_id")
    )
    intent.sepay_transaction_id = transaction_id
    await apply_deposit_paid(intent, intent.amount, reference, db, source="sepay_reconcile")
    await db.commit()

    if len(matches) > 1:
        await _alert(
            db,
            "warning",
            f"Lệnh nạp #{intent_id} có {len(matches)} giao dịch SePay khớp; chỉ credit giao dịch đầu tiên",
            target_id=intent_id,
            reason_code="multiple_matching_payments",
        )
    return _reconcile_outcome(
        DepositIntentStatus.paid.value,
        provider_status="paid",
        reconcile_result="credited",
    )


async def _reconcile_payos(intent: DepositIntent, db: AsyncSession) -> dict:
    intent_id = intent.id
    try:
        info = await payos_client.get_payment_info(intent.id)
    except (payos_client.PayOSError, payos_client.PayOSUnavailableError) as e:
        current_status = intent.status.value
        outcome = _reconcile_outcome(
            current_status,
            provider_status=None,
            reconcile_result="provider_error",
        )
        logger.warning("deposit_reconcile_failed", intent_id=intent_id, error=str(e), provider="payos")
        await db.rollback()
        return outcome

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
    return _reconcile_outcome(
        intent.status.value,
        provider_status=str(status).lower() if status is not None else None,
        reconcile_result="credited" if intent.status == DepositIntentStatus.paid else "checked",
    )


async def _reconcile_nowpayments(intent: DepositIntent, db: AsyncSession) -> dict:
    intent_id = intent.id
    requested_payment_id = str(intent.now_payment_id or "").strip()
    requested_invoice_id = str(intent.now_invoice_id or "").strip() or None
    if not requested_payment_id and requested_invoice_id:
        if not nowpayments_client.is_reconciliation_configured():
            outcome = _reconcile_outcome(
                intent.status.value,
                provider_status=None,
                reconcile_result="not_configured",
            )
            await db.rollback()
            await _log_nowpayments_reconcile_debug(
                intent_id=intent_id,
                branch="invoice_history_not_configured",
                invoice_id=requested_invoice_id,
                config={
                    "api_key": bool(settings.nowpayments_api_key),
                    "auth_email": bool(settings.nowpayments_auth_email),
                    "auth_password": bool(settings.nowpayments_auth_password),
                },
            )
            return outcome
        try:
            candidates = await nowpayments_client.list_payments_by_invoice(requested_invoice_id)
        except (nowpayments_client.NowPaymentsError, nowpayments_client.NowPaymentsUnavailableError) as e:
            current_status = intent.status.value
            outcome = _reconcile_outcome(
                current_status,
                provider_status=None,
                reconcile_result="provider_error",
            )
            safe_error = _redact_nowpayments_error(e)
            logger.warning("nowpayments_invoice_reconcile_failed", intent_id=intent_id, error=safe_error)
            await db.rollback()
            await _log_nowpayments_reconcile_debug(
                intent_id=intent_id,
                branch="invoice_history_list",
                error=e,
                invoice_id=requested_invoice_id,
                config=nowpayments_client.reconciliation_debug_config(),
            )
            return outcome

        provider_status: str | None = None
        provider_error = False
        validation_failed = False
        for candidate in candidates:
            payment_id = str(candidate.get("payment_id") or candidate.get("id") or "").strip()
            if not payment_id:
                continue
            try:
                info = await nowpayments_client.get_payment(payment_id)
            except (nowpayments_client.NowPaymentsError, nowpayments_client.NowPaymentsUnavailableError) as e:
                safe_error = _redact_nowpayments_error(e)
                logger.warning("nowpayments_payment_reconcile_failed", intent_id=intent_id, error=safe_error)
                await _log_nowpayments_reconcile_debug(
                    intent_id=intent_id,
                    branch="invoice_candidate_payment_fetch",
                    error=e,
                    invoice_id=requested_invoice_id,
                    payment_id=payment_id,
                )
                provider_error = True
                continue
            candidate_status = str(info.get("payment_status") or "").lower() or None
            if candidate_status and (provider_status != "finished" or candidate_status == "finished"):
                provider_status = candidate_status
            if candidate_status == "finished":
                credited = await _try_credit_nowpayments_finished(
                    intent, info, db, source="reconcile_invoice",
                )
                validation_failed = validation_failed or not credited
                if intent.status == DepositIntentStatus.paid:
                    break
        await db.commit()
        await db.refresh(intent)
        if intent.status == DepositIntentStatus.paid:
            result = "credited"
        elif validation_failed:
            result = "validation_failed"
        elif provider_status is not None:
            result = "checked"
        elif provider_error:
            result = "provider_error"
        else:
            result = "not_found"
        return _reconcile_outcome(
            intent.status.value,
            provider_status=provider_status,
            reconcile_result=result,
        )

    if not requested_payment_id:
        outcome = _reconcile_outcome(
            intent.status.value,
            provider_status=None,
            reconcile_result="not_found",
        )
        await db.rollback()
        return outcome
    if not nowpayments_client.is_configured():
        outcome = _reconcile_outcome(
            intent.status.value,
            provider_status=None,
            reconcile_result="not_configured",
        )
        await db.rollback()
        await _log_nowpayments_reconcile_debug(
            intent_id=intent_id,
            branch="direct_payment_not_configured",
            payment_id=requested_payment_id,
            config={
                "api_key": bool(settings.nowpayments_api_key),
                "ipn_secret": bool(settings.nowpayments_ipn_secret),
            },
        )
        return outcome

    try:
        info = await nowpayments_client.get_payment(requested_payment_id)
    except (nowpayments_client.NowPaymentsError, nowpayments_client.NowPaymentsUnavailableError) as e:
        current_status = intent.status.value
        outcome = _reconcile_outcome(
            current_status,
            provider_status=None,
            reconcile_result="provider_error",
        )
        safe_error = _redact_nowpayments_error(e)
        logger.warning("deposit_reconcile_failed", intent_id=intent_id, error=safe_error, provider="nowpayments")
        await db.rollback()
        await _log_nowpayments_reconcile_debug(
            intent_id=intent_id,
            branch="direct_payment_fetch",
            error=e,
            payment_id=requested_payment_id,
        )
        return outcome

    provider_status = str(info.get("payment_status") or "").lower() or None
    reconcile_result = "checked"
    if provider_status == "finished":
        # Re-lock path: intent may be expired after refresh — get again after remote call.
        # We still hold the same session object; if rollback happened we'd need re-fetch.
        credited = await _try_credit_nowpayments_finished(intent, info, db, source="reconcile")
        reconcile_result = "credited" if credited else "validation_failed"
    await db.commit()
    # Refresh status after possible credit
    await db.refresh(intent)
    return _reconcile_outcome(
        intent.status.value,
        provider_status=provider_status,
        reconcile_result=reconcile_result,
    )


async def list_payos_events(db: AsyncSession, order_code: int | None = None, limit: int = 50) -> list[dict]:
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


async def list_sepay_events(
    db: AsyncSession,
    payment_code: str | None = None,
    limit: int = 50,
) -> list[dict]:
    q = select(SePayWebhookEvent).order_by(SePayWebhookEvent.received_at.desc()).limit(limit)
    if payment_code:
        q = q.where(SePayWebhookEvent.payment_code == payment_code)
    rows = await db.execute(q)
    return [
        {
            "id": event.id,
            "transaction_id": event.transaction_id,
            "payment_code": event.payment_code,
            "reference": event.reference,
            "account_number": event.account_number,
            "amount": event.amount,
            "source": event.source,
            "signature_valid": event.signature_valid,
            "received_at": event.received_at,
            "raw": event.raw,
        }
        for event in rows.scalars().all()
    ]


async def list_nowpayments_events(
    db: AsyncSession, payment_id: str | None = None, limit: int = 50,
) -> list[dict]:
    q = select(NowpaymentsIpnEvent).order_by(NowpaymentsIpnEvent.received_at.desc()).limit(limit)
    if payment_id:
        q = q.where(NowpaymentsIpnEvent.payment_id == payment_id)
    rows = await db.execute(q)
    return [
        {
            "id": e.id,
            "payment_id": e.payment_id,
            "payment_status": e.payment_status,
            "order_id": e.order_id,
            "payload_hash": e.payload_hash,
            "signature_valid": e.signature_valid,
            "received_at": e.received_at,
            "raw": e.raw,
        }
        for e in rows.scalars().all()
    ]


def _as_decimal(value: object) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (ArithmeticError, ValueError):
        return None


def _amount_match(
    expected: Decimal | None,
    actual: Decimal | None,
) -> tuple[str, Decimal | None]:
    if expected is None or actual is None:
        return "unknown", None
    delta = actual - expected
    if delta == 0:
        return "exact", delta
    return ("underpaid" if delta < 0 else "overpaid"), delta


def _credit_state(*, credited: bool, actual: Decimal | None) -> str:
    if credited:
        return "credited"
    if actual is not None and actual > 0:
        return "held"
    return "not_credited"


async def _list_admin_deposit_transactions_for_intent(
    intent: DepositIntent,
    db: AsyncSession,
) -> list[dict]:
    provider = intent.provider or DepositProvider.sepay.value
    is_paid = intent.status == DepositIntentStatus.paid

    if provider == DepositProvider.sepay.value:
        rows = await db.execute(
            select(SePayWebhookEvent)
            .where(SePayWebhookEvent.payment_code == intent.payment_code)
            .order_by(SePayWebhookEvent.received_at.desc(), SePayWebhookEvent.id.desc())
        )
        expected = Decimal(intent.amount)
        transactions = []
        for event in rows.scalars().all():
            direction = str(event.raw.get("transferType") or "in").strip().lower()
            direction = "out" if direction == "out" else "in"
            actual = Decimal(event.amount)
            match_status, delta = _amount_match(expected, actual) if direction == "in" else ("unknown", None)
            credited = is_paid and (
                intent.sepay_transaction_id == event.transaction_id
                or bool(event.reference and intent.sepay_reference == event.reference)
            )
            transactions.append({
                "id": f"sepay:{event.id}",
                "provider": DepositProvider.sepay.value,
                "provider_transaction_id": event.transaction_id,
                "provider_status": "received" if direction == "in" else "outgoing",
                "reference": event.reference,
                "expected_amount": expected,
                "actual_amount": actual,
                "delta_amount": delta,
                "currency": "VND",
                "settled_amount": actual if credited else None,
                "settled_currency": "VND" if credited else None,
                "match_status": match_status,
                "credit_status": _credit_state(credited=credited, actual=actual if direction == "in" else None),
                "direction": direction,
                "source": event.source,
                "received_at": event.received_at,
                "destination": event.account_number,
                "event_count": 1,
                "raw": event.raw,
            })
        return transactions

    if provider == DepositProvider.nowpayments.value:
        order_id = nowpayments_client.format_order_id(intent.id)
        conditions = [NowpaymentsIpnEvent.order_id == order_id]
        if intent.now_payment_id:
            conditions.append(NowpaymentsIpnEvent.payment_id == intent.now_payment_id)
        rows = await db.execute(
            select(NowpaymentsIpnEvent)
            .where(or_(*conditions))
            .order_by(NowpaymentsIpnEvent.received_at.desc(), NowpaymentsIpnEvent.id.desc())
        )
        grouped: dict[str, dict] = {}
        for event in rows.scalars().all():
            group = grouped.setdefault(event.payment_id, {"latest": event, "count": 0})
            group["count"] += 1

        transactions = []
        for payment_id, group in grouped.items():
            event = group["latest"]
            raw = event.raw or {}
            expected = _as_decimal(raw.get("pay_amount")) or _as_decimal(intent.pay_amount)
            actual = _as_decimal(raw.get("actually_paid"))
            match_status, delta = _amount_match(expected, actual)
            credited = is_paid and (
                intent.now_payment_id == payment_id
                or intent.external_reference == payment_id
            )
            settled_amount = _as_decimal(raw.get("outcome_amount"))
            settled_currency = str(raw.get("outcome_currency") or "").strip().upper() or None
            if credited:
                settled_amount = settled_amount or _as_decimal(intent.outcome_amount)
                settled_currency = settled_currency or intent.outcome_currency
            currency = str(raw.get("pay_currency") or intent.pay_currency or "USDT").strip().upper()
            transactions.append({
                "id": f"nowpayments:{payment_id}",
                "provider": DepositProvider.nowpayments.value,
                "provider_transaction_id": payment_id,
                "provider_status": event.payment_status,
                "reference": str(raw.get("order_id") or event.order_id or payment_id),
                "expected_amount": expected,
                "actual_amount": actual,
                "delta_amount": delta,
                "currency": currency,
                "settled_amount": settled_amount,
                "settled_currency": settled_currency,
                "match_status": match_status,
                "credit_status": _credit_state(credited=credited, actual=actual),
                "direction": "in",
                "source": "ipn",
                "received_at": event.received_at,
                "destination": str(raw.get("pay_address") or intent.pay_address or "").strip() or None,
                "event_count": group["count"],
                "raw": raw,
            })
        return transactions

    if provider != DepositProvider.payos.value:
        return []

    rows = await db.execute(
        select(PayosWebhookEvent)
        .where(PayosWebhookEvent.order_code == intent.id)
        .order_by(PayosWebhookEvent.received_at.desc(), PayosWebhookEvent.id.desc())
    )
    expected = Decimal(intent.amount)
    transactions = []
    for event in rows.scalars().all():
        actual = Decimal(event.amount)
        match_status, delta = _amount_match(expected, actual)
        credited = is_paid and bool(
            intent.payos_reference == event.reference
            or intent.external_reference == event.reference
        )
        transactions.append({
            "id": f"payos:{event.id}",
            "provider": DepositProvider.payos.value,
            "provider_transaction_id": event.reference,
            "provider_status": "paid",
            "reference": event.reference,
            "expected_amount": expected,
            "actual_amount": actual,
            "delta_amount": delta,
            "currency": "VND",
            "settled_amount": actual if credited else None,
            "settled_currency": "VND" if credited else None,
            "match_status": match_status,
            "credit_status": _credit_state(credited=credited, actual=actual),
            "direction": "in",
            "source": "webhook",
            "received_at": event.received_at,
            "destination": event.payment_link_id,
            "event_count": 1,
            "raw": event.raw,
        })
    return transactions


async def list_admin_deposit_transactions(
    intent_id: int,
    db: AsyncSession,
) -> list[dict]:
    """Normalize provider journals into transaction-level rows for one deposit."""
    intent = await db.get(DepositIntent, intent_id)
    if intent is None:
        raise HTTPException(status_code=404, detail="Lệnh nạp không tồn tại")
    return await _list_admin_deposit_transactions_for_intent(intent, db)


async def list_admin_deposit_ledger(
    db: AsyncSession,
    *,
    limit: int = 25,
    offset: int = 0,
    provider: str | None = None,
    search: str | None = None,
) -> dict:
    """Return one filtered page of deposit intents and provider transactions."""
    filters = []
    normalized_provider = str(provider or "").strip().lower()
    if normalized_provider:
        if normalized_provider == DepositProvider.sepay.value:
            filters.append(or_(
                DepositIntent.provider == DepositProvider.sepay.value,
                DepositIntent.provider.is_(None),
            ))
        else:
            filters.append(DepositIntent.provider == normalized_provider)

    normalized_search = str(search or "").strip()
    if normalized_search:
        pattern = f"%{normalized_search}%"
        now_order_id = literal("DEP-") + cast(DepositIntent.id, String)
        search_conditions = [
            cast(DepositIntent.id, String).ilike(pattern),
            Account.email.ilike(pattern),
            DepositIntent.payment_code.ilike(pattern),
            DepositIntent.now_payment_id.ilike(pattern),
            DepositIntent.sepay_transaction_id.ilike(pattern),
            DepositIntent.sepay_reference.ilike(pattern),
            DepositIntent.external_reference.ilike(pattern),
            DepositIntent.payos_reference.ilike(pattern),
            exists(
                select(SePayWebhookEvent.id).where(
                    SePayWebhookEvent.payment_code == DepositIntent.payment_code,
                    or_(
                        SePayWebhookEvent.transaction_id.ilike(pattern),
                        SePayWebhookEvent.reference.ilike(pattern),
                    ),
                )
            ),
            exists(
                select(NowpaymentsIpnEvent.id).where(
                    or_(
                        NowpaymentsIpnEvent.order_id == now_order_id,
                        NowpaymentsIpnEvent.payment_id == DepositIntent.now_payment_id,
                    ),
                    or_(
                        NowpaymentsIpnEvent.payment_id.ilike(pattern),
                        NowpaymentsIpnEvent.order_id.ilike(pattern),
                    ),
                )
            ),
            exists(
                select(PayosWebhookEvent.id).where(
                    PayosWebhookEvent.order_code == DepositIntent.id,
                    PayosWebhookEvent.reference.ilike(pattern),
                )
            ),
        ]
        filters.append(or_(*search_conditions))

    total = await db.scalar(
        select(func.count(DepositIntent.id))
        .select_from(DepositIntent)
        .join(Account, DepositIntent.account_id == Account.id)
        .where(*filters)
    ) or 0
    result = await db.execute(
        select(DepositIntent, Account.email)
        .join(Account, DepositIntent.account_id == Account.id)
        .where(*filters)
        .order_by(DepositIntent.created_at.desc(), DepositIntent.id.desc())
        .limit(limit)
        .offset(offset)
    )

    items = []
    for intent, email in result.all():
        transactions = await _list_admin_deposit_transactions_for_intent(intent, db)
        items.append({
            "deposit": {
                "id": intent.id,
                "account_id": intent.account_id,
                "account_email": email,
                "amount": intent.amount,
                "paid_amount": intent.paid_amount,
                "status": intent.status.value,
                "provider": intent.provider or DepositProvider.sepay.value,
                "payment_code": intent.payment_code,
                "now_payment_id": intent.now_payment_id,
                "created_at": intent.created_at,
                "paid_at": intent.paid_at,
            },
            "transactions": transactions,
        })
    return {"total": total, "limit": limit, "offset": offset, "items": items}


async def list_admin_deposits(
    db: AsyncSession,
    status: str | None,
    limit: int = 100,
    *,
    provider: str | None = None,
) -> list[dict]:
    q = (
        select(DepositIntent, Account.email)
        .join(Account, DepositIntent.account_id == Account.id)
        .order_by(DepositIntent.created_at.desc())
        .limit(limit)
    )
    if status:
        q = q.where(DepositIntent.status == status)
    if provider:
        q = q.where(DepositIntent.provider == provider)
    rows = await db.execute(q)
    out = []
    for intent, email in rows.all():
        out.append({
            "id": intent.id,
            "account_id": intent.account_id,
            "account_email": email,
            "amount": intent.amount,
            "status": intent.status.value,
            "provider": intent.provider or "sepay",
            "payment_code": intent.payment_code,
            "bank_code": intent.bank_code,
            "bank_account_number": intent.bank_account_number,
            "bank_account_name": intent.bank_account_name,
            "sepay_transaction_id": intent.sepay_transaction_id,
            "sepay_reference": intent.sepay_reference,
            "checkout_url": intent.checkout_url,
            "qr_code": intent.qr_code,
            "payment_link_id": intent.payment_link_id,
            "paid_amount": intent.paid_amount,
            "payos_reference": intent.payos_reference,
            "external_reference": intent.external_reference,
            "pay_currency": intent.pay_currency,
            "pay_address": intent.pay_address,
            "pay_amount": intent.pay_amount,
            "now_payment_id": intent.now_payment_id,
            "quoted_usd_amount": intent.quoted_usd_amount,
            "vnd_per_usd_snapshot": intent.vnd_per_usd_snapshot,
            "price_currency": intent.price_currency,
            "paid_crypto_amount": intent.paid_crypto_amount,
            "outcome_amount": intent.outcome_amount,
            "outcome_currency": intent.outcome_currency,
            "created_at": intent.created_at,
            "expires_at": intent.expires_at,
            "paid_at": intent.paid_at,
        })
    return out
