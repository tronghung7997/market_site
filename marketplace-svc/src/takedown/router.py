"""Link takedown endpoints: buyer requests, admin pricing/sync, partner webhook."""

import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role, require_verified_email
from src.config import settings
from src.database import get_session
from src.media.store import PRIVATE_CACHE_CONTROL
from src.models.account import Account
from src.rate_limit import check_rate_limit
from src.takedown import client, schemas, service

router = APIRouter(tags=["takedown"])


def _image(data: bytes, content_type: str) -> Response:
    return Response(content=data, media_type=content_type, headers={
        "Cache-Control": PRIVATE_CACHE_CONTROL, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff",
    })


# ------------------------------------------------------------------ buyer

@router.get("/takedown/requests", response_model=list[schemas.TakedownRequestOut])
async def my_requests(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.list_for_buyer(db, account.id)


@router.post("/takedown/requests", response_model=schemas.TakedownRequestOut, status_code=201)
async def create_request(body: schemas.TakedownCreate, account: Account = Depends(get_current_account),
                         db: AsyncSession = Depends(get_session)):
    req = await service.create_request(
        db, account, url=body.url, note=body.note, service=body.service, warranty_hours=body.warranty_hours,
    )
    return service.buyer_view(req)


@router.get("/takedown/requests/{code}", response_model=schemas.TakedownRequestOut)
async def my_request(code: str, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.get_for_buyer(db, account.id, code)


@router.post("/takedown/requests/{code}/accept", response_model=schemas.TakedownRequestOut)
async def accept(code: str, account: Account = Depends(require_verified_email), db: AsyncSession = Depends(get_session)):
    return service.buyer_view(await service.accept_quote(db, account, code))


@router.post("/takedown/requests/{code}/decline", response_model=schemas.TakedownRequestOut)
async def decline(code: str, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return service.buyer_view(await service.decline_quote(db, account, code))


@router.post("/takedown/requests/{code}/cancel", response_model=schemas.TakedownRequestOut)
async def cancel(code: str, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return service.buyer_view(await service.cancel_request(db, account, code))


@router.post("/takedown/requests/{code}/warranty", response_model=schemas.TakedownRequestOut)
async def warranty(code: str, body: schemas.TakedownWarranty, account: Account = Depends(get_current_account),
                   db: AsyncSession = Depends(get_session)):
    return service.buyer_view(await service.claim_warranty(db, account, code, body.note))


@router.get("/takedown/requests/{code}/evidence/{kind}", include_in_schema=False)
async def evidence(code: str, kind: str, account: Account = Depends(get_current_account),
                   db: AsyncSession = Depends(get_session)):
    return _image(*await service.evidence_image(db, code, kind, buyer_id=account.id))


# ------------------------------------------------------------------ admin

@router.get("/admin/takedown/status", response_model=schemas.TakedownStatusOut)
async def admin_status(_: Account = Depends(require_role("admin"))):
    return {
        "configured": client.is_configured(),
        "webhook_secret_set": bool(settings.takedown_webhook_secret),
        "seller_set": bool(settings.takedown_seller_email),
        "partner_reachable": await client.health(),
    }


@router.get("/admin/takedown/requests", response_model=list[schemas.TakedownAdminOut])
async def admin_list(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_for_admin(db)


@router.get("/admin/takedown/requests/{code}", response_model=schemas.TakedownAdminDetailOut)
async def admin_detail(code: str, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.get_for_admin(db, code)


@router.get("/admin/takedown/requests/{code}/evidence/{kind}", include_in_schema=False)
async def admin_evidence(code: str, kind: str, _: Account = Depends(require_role("admin")),
                         db: AsyncSession = Depends(get_session)):
    return _image(*await service.evidence_image(db, code, kind, buyer_id=None))


@router.post("/admin/takedown/requests/{code}/price", response_model=schemas.TakedownAdminDetailOut)
async def admin_price(code: str, body: schemas.TakedownPrice, admin: Account = Depends(require_role("admin")),
                      db: AsyncSession = Depends(get_session)):
    await service.set_price(db, admin, code, body.price)
    return await service.get_for_admin(db, code)


@router.post("/admin/takedown/requests/{code}/sync", response_model=schemas.TakedownAdminDetailOut)
async def admin_sync(code: str, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    req = await service._get_any(db, code)
    request_id = req.id
    await db.rollback()
    await service.sync_request(request_id)
    return await service.get_for_admin(db, code)


# ------------------------------------------------------------------ partner webhook

def _peer_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/webhooks/takedown")
async def partner_webhook(request: Request):
    """Signed like SePay: X-Webhook-Signature = sha256=HMAC(secret, "<X-Webhook-Timestamp>.<raw body>")."""
    if not await check_rate_limit(
        f"takedown-webhook-ip:{_peer_ip(request)}", limit=settings.provider_webhook_ip_limit,
        window_seconds=60, fail_open=False,
    ):
        raise HTTPException(status_code=429, detail="Quá nhiều yêu cầu webhook", headers={"Retry-After": "60"})
    raw = await request.body()
    if not client.verify_webhook(raw, request.headers.get("X-Webhook-Signature"), request.headers.get("X-Webhook-Timestamp")):
        raise HTTPException(status_code=401, detail="Chữ ký webhook không hợp lệ")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Body phải là JSON hợp lệ") from None
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body phải là JSON object")
    return await service.handle_webhook(payload)
