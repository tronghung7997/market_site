import hashlib
import hmac
import json
import re
import time

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from src.adapters.factory import get_adapter
from src.adapters.real_api import RealApiAdapter
from src.adapters.registry import get_spec
from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.gateway.call_history import record_gateway_call_log
from src.gateway.service import mint_gateway_key, resolve_order_by_gateway_key
from src.logging import current_request_id
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.provider import Provider
from src.models.service_task import ServiceTask, ServiceTaskStatus
from src.rate_limit import check_rate_limit
from src.security.crypto import decrypt_str
from src.tasks.service import update_task
from src.usage.service import charge_usage, refund_usage
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024

# Best-effort abuse guard (src/rate_limit.py — Redis fixed-window, fails
# open). Not configurable per-provider yet; a flat default here beats no
# limit at all until a real per-provider throttle is worth building.
_GATEWAY_RATE_LIMIT = 60
_GATEWAY_RATE_WINDOW_SECONDS = 60


def _resolve_seller_path(provider: Provider, endpoint: str) -> str:
    """The generic half of the gateway: translate a NEUTRAL endpoint name
    (what pricing_params.endpoint_rates and buyers both key off) to whatever
    path shape this specific seller's backend actually uses, via
    provider.config.endpoint_map — e.g. {"search": "/api/v2/search",
    "scrape": "/scrape-v3/run"}. A provider with no endpoint_map at all falls
    back to the original /v1/{endpoint} convention (scripts/mock_seller.py's
    shape) so existing providers keep working unchanged. A provider WITH an
    endpoint_map that doesn't list this endpoint is a deliberate "not
    supported" rather than a silent fallback — the seller declared their
    surface, an unlisted name isn't a guess we should make for them."""
    endpoint_map = (provider.config or {}).get("endpoint_map")
    if not endpoint_map:
        return f"/v1/{endpoint}"
    if endpoint not in endpoint_map:
        raise HTTPException(status_code=404, detail=f"Provider không hỗ trợ endpoint '{endpoint}'")
    return endpoint_map[endpoint]


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
    _resolve_seller_path), and refunds the unit if the forward never actually
    landed. Every attempt is traced in provider_call_logs via RealApiAdapter's
    existing retry/logging — nothing new to build there, this route only adds
    the buyer-facing side of it.
    """
    if not _ENDPOINT_RE.match(endpoint):
        raise HTTPException(status_code=400, detail="Endpoint không hợp lệ")

    if not await check_rate_limit(
        f"gw:{gateway_key}", limit=_GATEWAY_RATE_LIMIT, window_seconds=_GATEWAY_RATE_WINDOW_SECONDS,
    ):
        raise HTTPException(status_code=429, detail="Gọi quá nhanh — thử lại sau ít phút")

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

    # Resolve through the SNAPSHOT taken at provisioning time, not the
    # product's current provider_id — re-linking the product to a different
    # provider after the order was sold must not silently redirect an
    # already-sold gateway key to a different seller (see Order.provider_id).
    if not order.provider_id:
        raise HTTPException(status_code=400, detail="Đơn hàng này chưa được cấp phát qua gateway")

    provider = await db.get(Provider, order.provider_id)
    provider_spec = get_spec(provider.adapter_type) if provider else None
    if provider_spec is None or not provider_spec.gateway_forward:
        raise HTTPException(status_code=400, detail="Sản phẩm này không hỗ trợ gọi qua gateway")

    adapter = await get_adapter(order.provider_id, db)
    # Phòng thủ cấu trúc (không phải so tên): forward cần adapter.call() —
    # một spec khai gateway_forward=True cho class không có call() là lỗi
    # đăng ký, chặn ở đây thay vì AttributeError giữa chừng.
    if not isinstance(adapter, RealApiAdapter):
        raise HTTPException(status_code=400, detail="Sản phẩm này không hỗ trợ gọi qua gateway")

    # Path translation happens BEFORE charging — an endpoint this seller
    # doesn't support (404 from _resolve_seller_path) must never cost the
    # buyer a unit.
    seller_path = _resolve_seller_path(provider, endpoint)

    request_id = current_request_id()

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

    # Pre-auth trước khi gọi ra ngoài — seller backend không phải lúc nào cũng
    # đáng tin (chưa được vet kỹ như provider admin-curate), tính tiền trước
    # tránh buyer bị forward miễn phí nếu adapter/router có bug; refund lại
    # nếu request không thực sự tới được seller hoặc trả lời quá khổ (bên dưới).
    # units=None: charge_usage tự tính từ endpoint_rates/default_rate của
    # balance NGAY SAU KHI đã khoá dòng — KHÔNG tách một lệnh đọc riêng
    # trước đó (xem docstring charge_usage: từng làm vậy, phá mất tính đúng
    # của khoá FOR UPDATE).
    charge_result = await charge_usage(order.id, endpoint, None, db, request_id=request_id)
    units = charge_result["units_charged"]

    # Buyer-facing history (src/gateway/call_history.py) — separate call, own
    # session, best-effort. request_payload is what THIS buyer sent for THIS
    # call, safe to show back to them (see GatewayCallLog docstring for why
    # this differs from ProviderCallLog's no-bodies policy).
    request_payload = {"query": dict(request.query_params)} if not body else {"query": dict(request.query_params), "body": body}
    started = time.perf_counter()

    try:
        resp = await adapter.call(
            order.id, seller_path,
            method=request.method,
            params=dict(request.query_params),
            json_body=body,
        )
    except Exception as e:
        latency_ms = int((time.perf_counter() - started) * 1000)
        await refund_usage(order.id, units, db, request_id=request_id, endpoint=endpoint)
        logger.error("gateway_forward_failed", order_id=order.id, endpoint=endpoint, error=str(e))
        await record_gateway_call_log(
            order_id=order.id, endpoint=endpoint, latency_ms=latency_ms,
            request_payload=request_payload, error=str(e),
        )
        raise HTTPException(status_code=502, detail="Không thể kết nối nhà cung cấp") from e

    latency_ms = int((time.perf_counter() - started) * 1000)

    if len(resp.content) > _MAX_RESPONSE_BYTES:
        await refund_usage(order.id, units, db, request_id=request_id, endpoint=endpoint)
        logger.error("gateway_response_too_large", order_id=order.id, endpoint=endpoint, size=len(resp.content))
        await record_gateway_call_log(
            order_id=order.id, endpoint=endpoint, latency_ms=latency_ms, status_code=resp.status_code,
            request_payload=request_payload, error="Phản hồi từ nhà cung cấp quá lớn",
        )
        raise HTTPException(status_code=502, detail="Phản hồi từ nhà cung cấp quá lớn")

    await record_gateway_call_log(
        order_id=order.id, endpoint=endpoint, latency_ms=latency_ms, status_code=resp.status_code,
        request_payload=request_payload, response_body=resp.content,
    )

    # Whitelist header pass-through — không forward Set-Cookie hay header nội
    # bộ của seller ra cho buyer.
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/json"),
    )


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
    raw = await request.body()
    provider = await db.get(Provider, provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhà cung cấp")

    secret_enc = (provider.config or {}).get("webhook_secret")
    if not secret_enc:
        logger.error("webhook_no_secret_configured", provider_id=provider_id)
        raise HTTPException(status_code=401, detail="Provider chưa cấu hình webhook secret")

    secret = decrypt_str(secret_enc)
    signature = request.headers.get("x-signature", "")
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
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
        raise HTTPException(status_code=404, detail="Không tìm thấy tác vụ")

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


@router.post("/orders/{order_id}/gateway-key/rotate")
async def rotate_gateway_key(
    order_id: int,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """Buyer-initiated: mint a fresh key, the old one stops matching
    immediately (lookup is by hash — overwriting it is enough, no separate
    revocation list needed)."""
    order = await db.get(Order, order_id)
    if not order or order.buyer_id != account.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    if order.gateway_key_hash is None:
        raise HTTPException(status_code=400, detail="Đơn hàng này chưa có gateway key")
    new_key = await mint_gateway_key(order)
    await db.commit()
    return {"gateway_key": new_key, "gateway_key_prefix": order.gateway_key_prefix}


@router.post("/admin/orders/{order_id}/gateway-key/revoke")
async def revoke_gateway_key(
    order_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Admin-initiated, no replacement — for abuse response, not routine
    rotation (that's the buyer's own endpoint above). Buyer can always ask
    support to sort it out; there is deliberately no self-service "un-revoke"."""
    order = await db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    order.gateway_key_hash = None
    order.gateway_key_prefix = None
    await db.commit()
    return {"ok": True}
