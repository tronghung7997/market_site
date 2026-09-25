import hashlib
import hmac
import json
import re

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from src.auth.dependencies import get_current_account, require_role
from src.config import settings
from src.database import get_session
from src.gateway.forward import forward_call, load_gateway_adapter, resolve_endpoint
from src.gateway.service import mint_gateway_key, replace_gateway_key, resolve_order_by_gateway_key
from src.logging import current_request_id
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.provider import Provider
from src.models.service_task import ServiceTask, ServiceTaskStatus
from src.rate_limit import check_rate_limit
from src.security.client_ip import client_ip
from src.security.crypto import decrypt_str
from src.tasks.service import update_task
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.orders.refs import OrderRef

logger = structlog.get_logger()

router = APIRouter(tags=["gateway"])

# Single path segment — the NEUTRAL endpoint name a buyer calls
# (/gw/{key}/search), never the seller's real path directly. Anything else —
# "..", extra "/", query-string tricks — gets rejected before it ever reaches
# adapter.call(): {endpoint:path} in the route below happily captures
# "../../provision" or "a/b/c", and forwarding that verbatim (or through a
# misconfigured endpoint_map) would let a buyer holding nothing but a gateway
# key reach endpoints on the seller's backend that were never meant to be
# buyer-facing.
_ENDPOINT_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_MAX_REQUEST_BODY_BYTES = 256 * 1024
_TRY_PREVIEW_BYTES = 64 * 1024

# Best-effort abuse guard (src/rate_limit.py — Redis fixed-window, fails
# open). Not configurable per-provider yet; a flat default here beats no
# limit at all until a real per-provider throttle is worth building.
_GATEWAY_RATE_WINDOW_SECONDS = 60


def _peer_ip(request: Request) -> str:
    # Callers hit the API host directly (no BFF), so honour X-Forwarded-For
    # from TRUSTED_PROXY_CIDRS; with none configured this is the TCP peer.
    return client_ip(request)


def _opaque_bucket(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@router.api_route("/gw/{gateway_key}/{endpoint:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def gateway_forward(
    gateway_key: str,
    endpoint: str,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    """The buyer-facing side of Giai đoạn 3 part B (see
    docs/superpowers/specs/2026-07-21-seller-connect-gateway-design.md §2):
    buyer holds a platform-minted key (never the seller's real base_url/api_key),
    calls this once per request, platform pre-charges the order's usage
    balance (per-endpoint rate — see resolve_endpoint_units), forwards to the
    seller's real backend through provider.config.endpoint_map (see
    resolve_endpoint in src/gateway/forward.py), and refunds the unit if the forward never actually
    landed. Every attempt is traced in provider_call_logs via RealApiAdapter's
    existing retry/logging — nothing new to build there, this route only adds
    the buyer-facing side of it.
    """
    if not _ENDPOINT_RE.match(endpoint):
        raise HTTPException(status_code=400, detail="Endpoint không hợp lệ")

    peer_ip = _peer_ip(request)
    rate_buckets = (
        (f"gw-ip:{peer_ip}", settings.gateway_ip_rate_limit),
        (f"gw-key:{_opaque_bucket(gateway_key)}", settings.gateway_key_rate_limit),
    )
    for bucket, limit in rate_buckets:
        if not await check_rate_limit(
            bucket,
            limit=limit,
            window_seconds=_GATEWAY_RATE_WINDOW_SECONDS,
            fail_open=False,
        ):
            raise HTTPException(
                status_code=429,
                detail="Gọi quá nhanh — thử lại sau ít phút",
                headers={"Retry-After": str(_GATEWAY_RATE_WINDOW_SECONDS)},
            )

    order = await resolve_order_by_gateway_key(gateway_key, db)
    # A gateway key outlives its order's status — OrderBalance only tracks
    # quota/expiry, never whether the order itself is still "good". Without
    # this check, a buyer who opens a dispute and gets refunded keeps a
    # working key for whatever quota was left: money back AND continued
    # service. Only delivered/completed orders may forward; disputed orders
    # are frozen until resolved, and pending/processing/refunded/cancelled
    # never had (or no longer have) a legitimate reason to forward at all.
    if order.status not in (OrderStatus.delivered, OrderStatus.completed):
        raise HTTPException(status_code=403, detail="Đơn hàng này không còn ở trạng thái dùng được qua gateway")

    body = None
    if request.method in ("POST", "PUT"):
        raw = await request.body()
        if len(raw) > _MAX_REQUEST_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Request body quá lớn")
        if raw:
            try:
                body = json.loads(raw)
            except ValueError:
                raise HTTPException(status_code=400, detail="Body phải là JSON hợp lệ")

    # Endpoint resolution, charge, forward, refund and history live in
    # src/gateway/forward.py so the buyer's "Gọi thử" button runs the exact
    # same path (see try_gateway_call below).
    result = await forward_call(
        order, endpoint, method=request.method, query=dict(request.query_params), body=body,
        db=db, request_id=current_request_id(),
    )
    # Whitelist header pass-through — không forward Set-Cookie hay header nội
    # bộ của seller ra cho buyer.
    return Response(content=result.content, status_code=result.status_code, media_type=result.media_type)


class GatewayTryRequest(BaseModel):
    endpoint: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    body: dict | None = None


@router.post("/orders/{order_ref}/gateway/try")
async def try_gateway_call(
    order_id: OrderRef,
    payload: GatewayTryRequest,
    request: Request,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """The API console's "Gọi thử": the buyer sends one real call from the
    order page (signed-in session, no key needed). Same charge/refund rules
    as /gw/{key}/… — it IS a real request against the buyer's balance."""
    order = await db.get(Order, order_id)
    if not order or order.buyer_id != account.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.status not in (OrderStatus.delivered, OrderStatus.completed):
        raise HTTPException(status_code=403, detail="Đơn hàng này không còn ở trạng thái dùng được qua gateway")
    if not await check_rate_limit(
        f"gw-try:{order.id}", limit=settings.gateway_key_rate_limit,
        window_seconds=_GATEWAY_RATE_WINDOW_SECONDS, fail_open=False,
    ):
        raise HTTPException(status_code=429, detail="Gọi quá nhanh — thử lại sau ít phút")
    raw_body = json.dumps(payload.body or {}).encode()
    if len(raw_body) > _MAX_REQUEST_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body quá lớn")
    provider, _adapter = await load_gateway_adapter(order, db)
    route = resolve_endpoint(provider, payload.endpoint)
    result = await forward_call(
        order, payload.endpoint, method=route.method or "POST", query={}, body=payload.body,
        db=db, request_id=current_request_id(),
    )
    text = result.content[:_TRY_PREVIEW_BYTES].decode("utf-8", errors="replace")
    return {
        "status_code": result.status_code,
        "latency_ms": result.latency_ms,
        "units_charged": result.units_charged,
        "units_remaining": result.units_remaining,
        "content_type": result.media_type,
        "body": text,
        "truncated": len(result.content) > _TRY_PREVIEW_BYTES,
    }


@router.post("/webhooks/providers/{provider_id}/tasks/{external_task_id}")
async def provider_task_webhook(
    provider_id: int,
    external_task_id: str,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    """Seller's own backend calls this when a `seller_task_webhook` task it
    was handed (see adapters/seller_task_webhook.py) finishes — the automated
    counterpart to an admin clicking a status dropdown in /admin/tasks.
    Signed with a per-provider HMAC secret (provider.config.webhook_secret,
    encrypted at rest like api_key) so seller A can't spoof a callback for
    seller B's task.

    Fails CLOSED: a provider row of this adapter_type is required (by
    providers/service.py) to carry a webhook_secret, but this endpoint does
    not trust that invariant blindly — a provider with no secret configured
    (e.g. pre-existing row, or config edited outside the normal path) gets
    every callback rejected rather than silently accepted unsigned."""
    peer_ip = _peer_ip(request)
    if not await check_rate_limit(
        f"provider-webhook-ip:{peer_ip}",
        limit=settings.provider_webhook_ip_limit,
        window_seconds=60,
        fail_open=False,
    ):
        raise HTTPException(
            status_code=429,
            detail="Quá nhiều yêu cầu webhook",
            headers={"Retry-After": "60"},
        )

    raw = await request.body()
    provider = await db.get(Provider, provider_id)
    secret_enc = (provider.config or {}).get("webhook_secret") if provider else None
    if not secret_enc:
        logger.error("webhook_no_secret_configured", provider_id=provider_id)
    secret = decrypt_str(secret_enc) if secret_enc else settings.internal_api_key
    signature = request.headers.get("x-signature", "")
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not secret_enc or not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="Chữ ký webhook không hợp lệ")

    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Body phải là JSON hợp lệ")

    task = await db.scalar(
        select(ServiceTask).where(
            ServiceTask.provider_id == provider_id,
            ServiceTask.external_task_id == external_task_id,
        )
    )
    if not task:
        # Signed callback for an unknown id is usually the contract-test job
        # (order_id=0 creates no ServiceTask). Ack so seller backends stop retrying.
        return {"ok": True, "ignored": True}

    status = body.get("status")
    if status not in ("completed", "failed"):
        raise HTTPException(status_code=400, detail="status phải là 'completed' hoặc 'failed'")

    _, order_status = await update_task(
        task.id,
        {
            "status": ServiceTaskStatus.completed if status == "completed" else ServiceTaskStatus.failed,
            "result_data": body.get("result_data"),
        },
        db,
    )
    return {"ok": True, "task_id": task.id, "order_status": order_status}


# ---------------------------------------------------------------------------
# Gateway key lifecycle — a key that leaked (logged by a buyer's own script,
# pasted into a support ticket, ...) had no way to be invalidated before this
# beyond the order.status check above (which only helps once the whole order
# is refunded/disputed, not for "buyer wants a fresh key, order is still
# fine").
# ---------------------------------------------------------------------------


@router.post("/orders/{order_ref}/gateway-key/rotate")
async def rotate_gateway_key(
    order_id: OrderRef,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """Buyer-initiated: mint a fresh key, the old one stops matching
    immediately (lookup is by hash — overwriting it is enough, no separate
    revocation list needed)."""
    from src.audit.service import log_event

    order = await db.get(Order, order_id)
    if not order or order.buyer_id != account.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.gateway_key_hash is None:
        raise HTTPException(status_code=400, detail="Đơn hàng này chưa có gateway key")
    old_prefix = order.gateway_key_prefix
    new_key = await mint_gateway_key(order)
    new_prefix = order.gateway_key_prefix
    # delivered_data là nơi trang đơn đọc key — không cập nhật thì buyer vẫn
    # thấy (và copy) key cũ đã hết hiệu lực.
    order.delivered_data = replace_gateway_key(order.delivered_data, new_key)
    await log_event(
        db, "info", f"Gateway key rotated for order {order_id}",
        request_id=current_request_id(),
        metadata={
            "event": "gateway_key_rotated",
            "actor_id": account.id,
            "actor_type": "buyer",
            "subject_type": "order",
            "subject_id": order_id,
            "outcome": "success",
            "source": "buyer",
            "order_id": order_id,
            "old_prefix": old_prefix,
            "new_prefix": new_prefix,
        },
    )
    await db.commit()
    return {"gateway_key": new_key, "gateway_key_prefix": order.gateway_key_prefix}


@router.post("/admin/orders/{order_id}/gateway-key/revoke")
async def revoke_gateway_key(
    order_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Admin-initiated, no replacement — for abuse response, not routine
    rotation (that's the buyer's own endpoint above). Buyer can always ask
    support to sort it out; there is deliberately no self-service "un-revoke"."""
    from src.audit.service import log_event

    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    old_prefix = order.gateway_key_prefix
    order.gateway_key_hash = None
    order.gateway_key_prefix = None
    await log_event(
        db, "warning", f"Gateway key revoked for order {order_id}",
        request_id=current_request_id(),
        metadata={
            "event": "gateway_key_revoked",
            "actor_id": admin.id,
            "actor_type": "admin",
            "subject_type": "order",
            "subject_id": order_id,
            "outcome": "success",
            "source": "admin",
            "order_id": order_id,
            "old_prefix": old_prefix,
        },
    )
    await db.commit()
    return {"ok": True}
