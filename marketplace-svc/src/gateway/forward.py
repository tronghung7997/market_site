"""One gateway call, shared by the key route (/gw/{key}/{endpoint}) and the
buyer's "Gọi thử" button in the API console (POST /orders/{ref}/gateway/try).

Order of operations is what keeps money right: resolve the endpoint (an
unsupported name or wrong method never costs a request) → per-source rate
limit → charge → forward → refund when the call never landed, the response
is oversized, or — on sources with ``config.charge_only_success`` — the
upstream answered with an error.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import structlog
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.factory import get_adapter
from src.adapters.real_api import RealApiAdapter
from src.adapters.registry import get_spec
from src.gateway.call_history import record_gateway_call_log
from src.models.order import Order
from src.models.provider import Provider
from src.rate_limit import check_rate_limit
from src.usage.service import charge_usage, refund_usage

logger = structlog.get_logger()

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
RATE_WINDOW_SECONDS = 60


@dataclass(frozen=True)
class EndpointRoute:
    path: str
    method: str | None  # None = buyer's method is forwarded as-is


def resolve_endpoint(provider: Provider, endpoint: str) -> EndpointRoute:
    """Translate a NEUTRAL endpoint name to the upstream path via
    provider.config.endpoint_map. A value is either a path string (legacy:
    the buyer's HTTP method is forwarded) or {"path", "method"} (the method
    is fixed and anything else is rejected). No endpoint_map → the original
    /v1/{endpoint} convention. An unlisted name is a deliberate 404."""
    endpoint_map = (provider.config or {}).get("endpoint_map")
    if not endpoint_map:
        return EndpointRoute(path=f"/v1/{endpoint}", method=None)
    if endpoint not in endpoint_map:
        raise HTTPException(status_code=404, detail=f"Provider không hỗ trợ endpoint '{endpoint}'")
    entry = endpoint_map[endpoint]
    if isinstance(entry, dict):
        return EndpointRoute(path=str(entry["path"]), method=(entry.get("method") or "").upper() or None)
    return EndpointRoute(path=str(entry), method=None)


def charge_only_success(provider: Provider) -> bool:
    return bool((provider.config or {}).get("charge_only_success"))


async def load_gateway_adapter(order: Order, db: AsyncSession) -> tuple[Provider, RealApiAdapter]:
    # Resolve through the SNAPSHOT taken at provisioning time, not the
    # product's current provider_id — re-linking the product to a different
    # provider after the order was sold must not silently redirect an
    # already-sold gateway key to a different seller (see Order.provider_id).
    if not order.provider_id:
        raise HTTPException(status_code=400, detail="Đơn hàng này chưa được cấp phát qua gateway")
    provider = await db.get(Provider, order.provider_id)
    spec = get_spec(provider.adapter_type) if provider else None
    if spec is None or not spec.gateway_forward:
        raise HTTPException(status_code=400, detail="Sản phẩm này không hỗ trợ gọi qua gateway")
    try:
        adapter = await get_adapter(order.provider_id, db)
    except ValueError as e:
        # Nguồn bị admin tạm dừng / chờ duyệt lại: trả lỗi rõ ràng TRƯỚC khi
        # trừ request, không để thành 500.
        raise HTTPException(status_code=503, detail="Nguồn đang tạm dừng — thử lại sau") from e
    # Phòng thủ cấu trúc: forward cần adapter.call() — một spec khai
    # gateway_forward=True cho class không có call() là lỗi đăng ký.
    if not isinstance(adapter, RealApiAdapter):
        raise HTTPException(status_code=400, detail="Sản phẩm này không hỗ trợ gọi qua gateway")
    return provider, adapter


@dataclass
class GatewayResult:
    status_code: int
    content: bytes
    media_type: str
    units_charged: int
    units_remaining: int
    latency_ms: int


async def forward_call(
    order: Order,
    endpoint: str,
    *,
    method: str,
    query: dict,
    body: dict | None,
    db: AsyncSession,
    request_id: str | None,
) -> GatewayResult:
    provider, adapter = await load_gateway_adapter(order, db)
    route = resolve_endpoint(provider, endpoint)
    if route.method and method.upper() != route.method:
        raise HTTPException(
            status_code=405, detail=f"Endpoint '{endpoint}' chỉ nhận {route.method}",
            headers={"Allow": route.method},
        )
    per_minute = (provider.config or {}).get("rate_limit_per_minute")
    if per_minute:
        if not await check_rate_limit(
            f"gw-order:{order.id}", limit=int(per_minute), window_seconds=RATE_WINDOW_SECONDS, fail_open=False,
        ):
            raise HTTPException(
                status_code=429, detail="Gọi quá nhanh — thử lại sau ít phút",
                headers={"Retry-After": str(RATE_WINDOW_SECONDS)},
            )

    # units=None: charge_usage tự tính từ endpoint_rates/default_rate NGAY SAU
    # KHI khoá dòng (xem docstring charge_usage).
    charge = await charge_usage(order.id, endpoint, None, db, request_id=request_id)
    units = charge["units_charged"]
    remaining = charge["units_remaining"]
    request_payload = {"query": dict(query), **({"body": body} if body is not None else {})}
    started = time.perf_counter()

    async def refund(reason: str) -> None:
        nonlocal remaining
        await refund_usage(order.id, units, db, request_id=request_id, endpoint=endpoint)
        remaining += units
        logger.info("gateway_call_refunded", order_id=order.id, endpoint=endpoint, reason=reason)

    try:
        resp = await adapter.call(order.id, route.path, method=method.upper(), params=dict(query), json_body=body)
    except Exception as e:
        latency_ms = int((time.perf_counter() - started) * 1000)
        await refund("transport")
        # Do not log raw exception text to structlog — may contain host secrets.
        logger.error("gateway_forward_failed", order_id=order.id, endpoint=endpoint, error_type=type(e).__name__)
        await record_gateway_call_log(
            order_id=order.id, endpoint=endpoint, latency_ms=latency_ms, request_payload=request_payload,
            error=str(e), units_charged=0, units_remaining=remaining,
        )
        raise HTTPException(status_code=502, detail="Không thể kết nối nhà cung cấp") from e

    latency_ms = int((time.perf_counter() - started) * 1000)
    if len(resp.content) > MAX_RESPONSE_BYTES:
        await refund("too_large")
        logger.error("gateway_response_too_large", order_id=order.id, endpoint=endpoint, size=len(resp.content))
        await record_gateway_call_log(
            order_id=order.id, endpoint=endpoint, latency_ms=latency_ms, status_code=resp.status_code,
            request_payload=request_payload, error="Phản hồi từ nhà cung cấp quá lớn",
            units_charged=0, units_remaining=remaining,
        )
        raise HTTPException(status_code=502, detail="Phản hồi từ nhà cung cấp quá lớn")

    charged = units
    if resp.status_code >= 400 and charge_only_success(provider):
        await refund(f"upstream_{resp.status_code}")
        charged = 0

    await record_gateway_call_log(
        order_id=order.id, endpoint=endpoint, latency_ms=latency_ms, status_code=resp.status_code,
        request_payload=request_payload, response_body=resp.content,
        units_charged=charged, units_remaining=remaining,
    )
    return GatewayResult(
        status_code=resp.status_code, content=resp.content,
        media_type=resp.headers.get("content-type", "application/json"),
        units_charged=charged, units_remaining=remaining, latency_ms=latency_ms,
    )
