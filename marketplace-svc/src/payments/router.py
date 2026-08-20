from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account
from src.payments import nowpayments_client, payos_client, rail_config, schemas, sepay_client, service

import structlog

logger = structlog.get_logger()

router = APIRouter(tags=["payments"])


@router.get("/wallet/deposit-methods", response_model=schemas.DepositMethodsResponse)
async def deposit_methods(db: AsyncSession = Depends(get_session)):
    """Discovery of enabled deposit rails (admin flags ∩ secrets; no secrets leaked)."""
    return await service.deposit_methods_public(db)


@router.post("/wallet/deposits", response_model=schemas.DepositResponse, status_code=201)
async def create_deposit(
    body: schemas.DepositCreateRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.create_deposit(
        account.id,
        body.amount,
        db,
        method=body.method,
        pay_currency=body.pay_currency,
    )


@router.get("/wallet/deposits/me", response_model=list[schemas.DepositResponse])
async def my_deposits(
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_deposits(account.id, db)


@router.post("/wallet/deposits/{intent_id}/cancel", response_model=schemas.DepositResponse)
async def cancel_deposit(
    intent_id: int,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.cancel_deposit(intent_id, account.id, db)


@router.post("/webhooks/payos")
async def payos_webhook(request: Request, db: AsyncSession = Depends(get_session)):
    """Public endpoint PayOS gọi khi có giao dịch. Quy tắc phản hồi (thiết kế
    §3): sai chữ ký → 401; mọi trường hợp còn lại (kể cả payload lạ) → 200
    để PayOS không retry-bão — idempotency đã nằm ở UNIQUE event."""
    try:
        payload = await request.json()
    except ValueError:
        logger.warning("payos_webhook_not_json")
        return {"ok": True, "note": "body không phải JSON"}

    if not isinstance(payload, dict):
        return {"ok": True, "note": "payload không phải object"}

    if "data" not in payload and "signature" not in payload:
        return {"ok": True, "note": "ping"}

    if not payos_client.is_configured():
        logger.error("payos_webhook_received_but_not_configured")
        return {"ok": True, "note": "PayOS chưa được cấu hình — bỏ qua"}

    if not payos_client.verify_webhook_signature(payload):
        from src.security.events import security_event
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        order_code = data.get("orderCode")
        security_event(
            "webhook_signature_failed",
            level="warning",
            provider="payos",
            deposit_id=order_code if isinstance(order_code, int) else None,
        )
        logger.error("payos_webhook_bad_signature")
        raise HTTPException(status_code=401, detail="Chữ ký webhook không hợp lệ")

    return await service.handle_webhook(payload, db)


@router.post("/webhooks/sepay")
async def sepay_webhook(request: Request, db: AsyncSession = Depends(get_session)):
    """Receive a SePay bank transaction using raw-body HMAC verification."""
    raw_body = await request.body()
    signature = request.headers.get("X-SePay-Signature")
    timestamp = request.headers.get("X-SePay-Timestamp")

    rail = await rail_config.ensure_seeded(db)
    if not sepay_client.is_configured(
        bank_code=rail.sepay_bank_code,
        account_number=rail.sepay_bank_account_number,
        account_name=rail.sepay_bank_account_name,
        account_id=rail.sepay_bank_account_id,
    ):
        logger.error("sepay_webhook_received_but_not_configured")
        raise HTTPException(status_code=503, detail="SePay chưa được cấu hình")
    if not sepay_client.verify_webhook_signature(raw_body, signature, timestamp):
        from src.security.events import security_event

        security_event("webhook_signature_failed", level="warning", provider="sepay")
        logger.warning("sepay_webhook_bad_signature")
        raise HTTPException(status_code=401, detail="Chữ ký webhook không hợp lệ")

    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Webhook body không phải JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Webhook payload phải là object")

    await service.handle_sepay_webhook(payload, db)
    # SePay requires this ACK shape for both first delivery and replay.
    return {"success": True}


@router.post("/webhooks/nowpayments")
async def nowpayments_webhook(request: Request, db: AsyncSession = Depends(get_session)):
    """NOWPayments IPN. Bad signature → 401. Everything else → 200."""
    try:
        payload = await request.json()
    except ValueError:
        logger.warning("nowpayments_ipn_not_json")
        return {"ok": True, "note": "body không phải JSON"}

    if not isinstance(payload, dict):
        return {"ok": True, "note": "payload không phải object"}

    if not nowpayments_client.is_configured():
        logger.error("nowpayments_ipn_received_but_not_configured")
        return {"ok": True, "note": "NOWPayments chưa cấu hình — bỏ qua"}

    sig = request.headers.get("x-nowpayments-sig") or request.headers.get("x-nowpayments-sig".title())
    # httpx / starlette headers are case-insensitive
    if not sig:
        sig = request.headers.get("X-Nowpayments-Sig")

    if not nowpayments_client.verify_ipn_signature(payload, sig):
        from src.security.events import security_event
        security_event(
            "webhook_signature_failed",
            level="warning",
            provider="nowpayments",
            deposit_id=None,
        )
        logger.error("nowpayments_ipn_bad_signature")
        raise HTTPException(status_code=401, detail="Chữ ký IPN không hợp lệ")

    return await service.handle_nowpayments_ipn(payload, db)


@router.get("/admin/deposits", response_model=list[schemas.AdminDepositResponse])
async def admin_deposits(
    status: str | None = Query(default=None),
    provider: str | None = Query(default=None),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_admin_deposits(db, status, provider=provider)


@router.get("/admin/payos-events")
async def admin_payos_events(
    order_code: int | None = Query(default=None),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_payos_events(db, order_code)


@router.get("/admin/sepay-events")
async def admin_sepay_events(
    payment_code: str | None = Query(default=None),
    _admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_sepay_events(db, payment_code)


@router.get("/admin/nowpayments-events")
async def admin_nowpayments_events(
    payment_id: str | None = Query(default=None),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_nowpayments_events(db, payment_id)


@router.get(
    "/admin/deposit-ledger",
    response_model=schemas.AdminDepositLedgerResponse,
)
async def admin_deposit_ledger(
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    provider: str | None = Query(default=None, max_length=32),
    search: str | None = Query(default=None, max_length=128),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_admin_deposit_ledger(
        db,
        limit=limit,
        offset=offset,
        provider=provider,
        search=search,
    )


@router.get(
    "/admin/deposits/{intent_id}/transactions",
    response_model=list[schemas.AdminDepositTransactionRow],
)
async def admin_deposit_transactions(
    intent_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_admin_deposit_transactions(intent_id, db)


@router.post(
    "/admin/deposits/{intent_id}/reconcile",
    response_model=schemas.DepositReconcileResponse,
)
async def admin_reconcile_deposit(
    intent_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    result = await service.reconcile_intent(intent_id, db)
    return {"id": intent_id, **result}


@router.get("/admin/deposit-rail-config", response_model=schemas.DepositRailConfigAdmin)
async def admin_deposit_rail_config(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    from src.payments import rail_config
    return await rail_config.admin_config(db)


@router.patch("/admin/deposit-rail-config", response_model=schemas.DepositRailConfigAdmin)
async def update_deposit_rail_config(
    body: schemas.DepositRailConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    from src.payments import rail_config
    return await rail_config.update_config(
        db,
        actor_id=admin.id,
        **body.model_dump(exclude_unset=True),
    )


@router.post("/admin/deposit-rail-config/reset-to-env", response_model=schemas.DepositRailConfigAdmin)
async def reset_deposit_rail_config(
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    from src.payments import rail_config
    return await rail_config.reset_to_env(db, actor_id=admin.id)
