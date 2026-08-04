from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account
from src.payments import payos_client, schemas, service

import structlog

logger = structlog.get_logger()

router = APIRouter(tags=["payments"])


@router.post("/wallet/deposits", response_model=schemas.DepositResponse, status_code=201)
async def create_deposit(
    body: schemas.DepositCreateRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    return await service.create_deposit(account.id, body.amount, db)


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

    # PayOS bắn một request "test" khi bấm confirm-webhook trên my.payos.vn —
    # không có data/signature thật. Nhận diện và trả 200 để đăng ký URL thành công.
    if "data" not in payload and "signature" not in payload:
        return {"ok": True, "note": "ping"}

    # Chưa cấu hình PayOS = không có khoá để verify → nuốt lặng lẽ (200, không
    # xử lý). Trả 401 ở đây sẽ khiến PayOS retry-bão vào một hệ chưa sẵn sàng.
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


@router.get("/admin/deposits", response_model=list[schemas.AdminDepositResponse])
async def admin_deposits(
    status: str | None = Query(default=None),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_admin_deposits(db, status)


@router.get("/admin/payos-events")
async def admin_payos_events(
    order_code: int | None = Query(default=None),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Sổ webhook thô — bằng chứng đối soát (đã dùng để phân biệt giao dịch
    mock/thật hôm 24/07)."""
    return await service.list_payos_events(db, order_code)


@router.post("/admin/deposits/{intent_id}/reconcile")
async def admin_reconcile_deposit(
    intent_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    status = await service.reconcile_intent(intent_id, db)
    return {"id": intent_id, "status": status}
