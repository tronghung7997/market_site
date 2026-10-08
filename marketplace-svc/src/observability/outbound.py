"""One `upstream_call` log event per outbound HTTP request.

Every adapter, payment client and SDK here talks HTTP through httpx, so the
transport is the single place that sees each call — including the ones that
never get a response (timeout, DNS, refused connection). The event carries the
current request_id / job context, so one filter shows a buyer request and every
third-party call it made.

Every event carries metadata: host, a templated path (ids and key-like
segments replaced), status, duration, outcome. Supplier and payment calls also
carry their request/response bodies and an `exchange_id` pointing at the
encrypted copy in `upstream_exchanges` (src/observability/exchanges.py). Never
headers or query strings — gateway keys, bot tokens and signatures travel there.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import re
import time
from collections.abc import Iterator

import httpx
import structlog

from src.observability import exchanges

logger = structlog.get_logger("upstream")

# Host suffix → integration name shown in logs. Unknown hosts log the host.
_INTEGRATIONS: tuple[tuple[str, str], ...] = (
    ("payos.vn", "payos"),
    ("topproxy.vn", "topproxy"),
    ("proxyxoay.shop", "topproxy"),
    ("dproxy.info", "dproxy"),
    ("igbm.net", "igbm"),
    ("ghlab.info", "ghlab"),
    ("resend.com", "resend"),
    ("openrouter.ai", "openrouter"),
    ("x.ai", "xai"),
    ("together.xyz", "together"),
    ("groq.com", "groq"),
    ("deepseek.com", "deepseek"),
    ("sepay.vn", "sepay"),
    ("nowpayments.io", "nowpayments"),
    ("api.telegram.org", "telegram"),
    ("challenges.cloudflare.com", "turnstile"),
    ("r2.cloudflarestorage.com", "r2"),
    ("amazonaws.com", "aws"),
    ("googleapis.com", "gemini"),
    ("openai.com", "openai"),
)

_integration_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "upstream_integration", default=None
)

_NUMERIC_RE = re.compile(r"^\d+$")
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
# Long opaque segments are ids, tokens or keys (`bot123:AA…`, `/gw/<key>/`).
_OPAQUE_RE = re.compile(r"[:=]|^[A-Za-z0-9_\-.]{24,}$")
_SLOW_MS = 5000

_installed = False


@contextlib.contextmanager
def integration(name: str) -> Iterator[None]:
    """Name the integration for calls made inside this block (e.g. a seller's
    supplier source whose host says nothing)."""
    token = _integration_var.set(name)
    try:
        yield
    finally:
        _integration_var.reset(token)


def integration_for_host(host: str) -> str:
    named = _integration_var.get()
    if named:
        return named
    host = host.lower()
    for suffix, name in _INTEGRATIONS:
        if host == suffix or host.endswith("." + suffix):
            return name
    return host


def path_template(path: str) -> str:
    """Low-cardinality, secret-free path: `/v2/orders/123/bot1:AA` → `/v2/orders/{id}/{key}`."""
    parts = []
    for segment in path.split("/"):
        if not segment:
            parts.append(segment)
        elif _NUMERIC_RE.match(segment) or _UUID_RE.match(segment):
            parts.append("{id}")
        elif _OPAQUE_RE.search(segment):
            parts.append("{key}")
        else:
            parts.append(segment[:64])
    return "/".join(parts)[:255]


def _outcome_for(exc: BaseException) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if isinstance(exc, httpx.ConnectError):
        return "connect_error"
    if isinstance(exc, httpx.TransportError):
        return "transport_error"
    return "error"


def _fields(request: httpx.Request, duration_ms: int) -> dict:
    host = request.url.host or ""
    return {
        "integration": integration_for_host(host),
        "upstream_host": host,
        "upstream_method": request.method,
        "upstream_path": path_template(request.url.path),
        "duration_ms": duration_ms,
    }


async def _attach_exchange(
    fields: dict, request: httpx.Request, request_text: str | None, response_text: str | None,
    *, error: str | None = None,
) -> None:
    """Store the bodies (encrypted, src/observability/exchanges.py) and put
    them, with the stored row's id, on the `upstream_call` event."""
    query = exchanges.request_query(request)
    exchange_id = await exchanges.record_exchange(
        integration=fields["integration"], method=fields["upstream_method"], host=fields["upstream_host"],
        path=fields["upstream_path"], url_path=request.url.path + (f"?{query}" if query else ""),
        status_code=fields.get("status"),
        outcome=fields["outcome"], duration_ms=fields["duration_ms"],
        request_text=request_text, response_text=response_text, error=error,
    )
    if exchange_id is not None:
        fields["exchange_id"] = exchange_id
    scope = exchanges.current_scope()
    if scope is not None:
        fields.update({k: v for k, v in (("provider_id", scope.provider_id), ("order_id", scope.order_id),
                                         ("operation", scope.operation)) if v is not None})
    if query:
        fields["request_query"] = query[:2000]
    fields.update(exchanges.log_fields(request_text, response_text))


def install() -> None:
    """Wrap httpx's async transport once per process."""
    global _installed
    if _installed:
        return
    original = httpx.AsyncHTTPTransport.handle_async_request

    async def handle_async_request(self: httpx.AsyncHTTPTransport, request: httpx.Request) -> httpx.Response:
        start = time.monotonic()
        capture = exchanges.should_capture(integration_for_host(request.url.host or ""))
        request_text = exchanges.request_text(request) if capture else None
        try:
            response = await original(self, request)
            if capture:
                # Read here so the body can be kept; the client gets the same
                # bytes from the response's cache when it reads it.
                await response.aread()
        except asyncio.CancelledError:
            raise
        except BaseException as exc:
            fields = _fields(request, int((time.monotonic() - start) * 1000))
            fields["outcome"] = _outcome_for(exc)
            fields["error_type"] = type(exc).__name__
            fields["error_message"] = (str(exc) or repr(exc))[:500]
            if capture:
                await _attach_exchange(fields, request, request_text, None, error=fields["error_message"])
            logger.warning("upstream_call", **fields)
            raise
        fields = _fields(request, int((time.monotonic() - start) * 1000))
        fields["status"] = response.status_code
        if response.status_code >= 500:
            fields["outcome"] = "server_error"
        elif response.status_code >= 400:
            fields["outcome"] = "client_error"
        else:
            fields["outcome"] = "ok"
            if fields["duration_ms"] >= _SLOW_MS:
                fields["slow"] = True
        if capture:
            response_text = exchanges.body_text(response.content, response.headers.get("content-type"))
            await _attach_exchange(fields, request, request_text, response_text)
        if fields["outcome"] != "ok" or fields.get("slow"):
            logger.warning("upstream_call", **fields)
        else:
            logger.info("upstream_call", **fields)
        return response

    httpx.AsyncHTTPTransport.handle_async_request = handle_async_request  # type: ignore[method-assign]
    _installed = True
