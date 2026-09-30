"""One `upstream_call` log event per outbound HTTP request.

Every adapter, payment client and SDK here talks HTTP through httpx, so the
transport is the single place that sees each call — including the ones that
never get a response (timeout, DNS, refused connection). The event carries the
current request_id / job context, so one filter shows a buyer request and every
third-party call it made.

Only metadata is logged: host, a templated path (ids and key-like segments
replaced), status, duration, outcome. Never query strings or bodies — gateway
keys, bot tokens and delivered credentials travel there.
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


def install() -> None:
    """Wrap httpx's async transport once per process."""
    global _installed
    if _installed:
        return
    original = httpx.AsyncHTTPTransport.handle_async_request

    async def handle_async_request(self: httpx.AsyncHTTPTransport, request: httpx.Request) -> httpx.Response:
        start = time.monotonic()
        try:
            response = await original(self, request)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:
            fields = _fields(request, int((time.monotonic() - start) * 1000))
            fields["outcome"] = _outcome_for(exc)
            fields["error_type"] = type(exc).__name__
            fields["error_message"] = (str(exc) or repr(exc))[:500]
            logger.warning("upstream_call", **fields)
            raise
        fields = _fields(request, int((time.monotonic() - start) * 1000))
        fields["status"] = response.status_code
        if response.status_code >= 500:
            fields["outcome"] = "server_error"
            logger.warning("upstream_call", **fields)
        elif response.status_code >= 400:
            fields["outcome"] = "client_error"
            logger.warning("upstream_call", **fields)
        else:
            fields["outcome"] = "ok"
            if fields["duration_ms"] >= _SLOW_MS:
                fields["slow"] = True
                logger.warning("upstream_call", **fields)
            else:
                logger.info("upstream_call", **fields)
        return response

    httpx.AsyncHTTPTransport.handle_async_request = handle_async_request  # type: ignore[method-assign]
    _installed = True
