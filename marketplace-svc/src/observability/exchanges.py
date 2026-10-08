"""Request and response bodies of supplier and payment calls, kept for
reconciliation with the third party.

`upstream_call` (src/observability/outbound.py) logs metadata for every
outbound request. For the integrations where money or goods change hands —
and for any call made inside a provider adapter (`exchange_scope`) — the
transport also captures both bodies and:

- stores them Fernet-encrypted in `upstream_exchanges` (full copy, capped at
  upstream_exchange_max_bytes, pruned after upstream_exchange_retention_days);
- ships them unmasked on the same `upstream_call` event (capped at
  upstream_exchange_log_max_chars) — the log stream is internal by decision of
  2026-10-08, so a dispute can be read straight from O2.

Headers are never captured (API keys, bearer tokens, signatures), and our own
credential parameters (`api_key`, `key`, `token`…) are dropped from the
request body and query. Capture never breaks the call it observes.
"""

from __future__ import annotations

import contextlib
import contextvars
import json
import urllib.parse
from collections.abc import Iterator
from dataclasses import dataclass

import httpx
import structlog

from src.config import settings

logger = structlog.get_logger("upstream")

# Supplier and payment integrations (names from outbound._INTEGRATIONS).
# AI, mail, Telegram, storage and captcha calls are left out on purpose:
# nothing to reconcile, and AI bodies carry what users typed.
CAPTURED_INTEGRATIONS = frozenset({
    "dproxy", "topproxy", "igbm", "ghlab", "payos", "sepay", "nowpayments",
})

_TEXT_TYPES = ("json", "text", "xml", "x-www-form-urlencoded", "javascript")
# Our own credentials sent as a body/query parameter — dropped from what is
# kept. Third-party data (delivered proxies, accounts) is kept as received.
_CREDENTIAL_PARAMS = frozenset({"api_key", "apikey", "key", "token", "access_token", "secret", "client_secret"})


@dataclass(frozen=True)
class ExchangeScope:
    provider_id: int | None
    order_id: int | None
    operation: str | None


_scope_var: contextvars.ContextVar[ExchangeScope | None] = contextvars.ContextVar(
    "upstream_exchange_scope", default=None
)


@contextlib.contextmanager
def exchange_scope(*, provider_id: int | None, order_id: int | None = None, operation: str | None = None) -> Iterator[None]:
    """Tag the HTTP calls made inside the block with the provider/order they
    serve, and capture them whatever host they go to (a seller-owned supplier
    endpoint has no fixed integration name)."""
    token = _scope_var.set(ExchangeScope(provider_id, order_id, operation))
    try:
        yield
    finally:
        _scope_var.reset(token)


def current_scope() -> ExchangeScope | None:
    return _scope_var.get()


def should_capture(integration: str) -> bool:
    return integration in CAPTURED_INTEGRATIONS or _scope_var.get() is not None


def body_text(content: bytes | None, content_type: str | None) -> str | None:
    """Bytes → text for storage; binary payloads become a short placeholder."""
    if not content:
        return None
    ctype = (content_type or "").lower()
    if ctype and not any(t in ctype for t in _TEXT_TYPES):
        return f"<{ctype.split(';')[0]} {len(content)} bytes>"
    return content.decode("utf-8", errors="replace")


def request_body(request: httpx.Request) -> bytes | None:
    try:
        return request.content
    except httpx.RequestNotRead:
        # Streaming upload: reading it here would consume what the transport sends.
        return None


def _is_credential(name: str) -> bool:
    return name.lower() in _CREDENTIAL_PARAMS


def request_text(request: httpx.Request) -> str | None:
    """What we sent, minus our own credentials: igbm posts `api_key` in the
    form body, TopProxy/NowPayments-style clients put `key` in the query."""
    content = request_body(request)
    ctype = (request.headers.get("content-type") or "").lower()
    if content and "x-www-form-urlencoded" in ctype:
        pairs = urllib.parse.parse_qsl(content.decode("utf-8", errors="replace"), keep_blank_values=True)
        return urllib.parse.urlencode([(k, v) for k, v in pairs if not _is_credential(k)])
    if content and "json" in ctype:
        try:
            data = json.loads(content)
        except ValueError:
            data = None
        if isinstance(data, dict) and any(_is_credential(k) for k in data):
            return json.dumps({k: v for k, v in data.items() if not _is_credential(k)}, ensure_ascii=False)
    return body_text(content, ctype)


def request_query(request: httpx.Request) -> str | None:
    if not request.url.query:
        return None
    pairs = urllib.parse.parse_qsl(request.url.query.decode("utf-8", errors="replace"), keep_blank_values=True)
    return urllib.parse.urlencode([(k, v) for k, v in pairs if not _is_credential(k)]) or None


def _cap(text: str | None, limit: int) -> tuple[str | None, bool]:
    if text is None or len(text) <= limit:
        return text, False
    return text[:limit], True


def log_fields(request_text: str | None, response_text: str | None) -> dict:
    """Body fields for the `upstream_call` event, capped for the log stream."""
    limit = settings.upstream_exchange_log_max_chars
    out: dict = {}
    for key, text in (("request_body", request_text), ("response_body", response_text)):
        capped, cut = _cap(text, limit)
        if capped is not None:
            out[key] = capped
            if cut:
                out[f"{key}_truncated"] = True
    return out


async def record_exchange(
    *,
    integration: str,
    method: str,
    host: str,
    path: str,
    url_path: str,
    status_code: int | None,
    outcome: str,
    duration_ms: int,
    request_text: str | None,
    response_text: str | None,
    error: str | None = None,
) -> int | None:
    """Persist one exchange on its own session; returns its id, or None when
    the write failed. Never raises: storage must not be what breaks a call."""
    from src.database import SessionLocal
    from src.models.upstream_exchange import UpstreamExchange
    from src.security.crypto import encrypt_str

    limit = settings.upstream_exchange_max_bytes
    req_capped, req_cut = _cap(request_text, limit)
    resp_capped, resp_cut = _cap(response_text, limit)
    scope = _scope_var.get()
    context = structlog.contextvars.get_contextvars()
    try:
        row = UpstreamExchange(
            integration=integration[:50],
            method=method[:10],
            host=host[:255],
            path=path[:255],
            url_path=encrypt_str(url_path[:2000]) if url_path else None,
            status_code=status_code,
            outcome=outcome[:20],
            duration_ms=duration_ms,
            error=error[:500] if error else None,
            request_id=_short(context.get("request_id")),
            job=_short(context.get("job")),
            provider_id=scope.provider_id if scope else None,
            order_id=scope.order_id if scope else None,
            operation=scope.operation[:50] if scope and scope.operation else None,
            request_body=encrypt_str(req_capped) if req_capped is not None else None,
            response_body=encrypt_str(resp_capped) if resp_capped is not None else None,
            request_bytes=len(request_text.encode()) if request_text else 0,
            response_bytes=len(response_text.encode()) if response_text else 0,
            truncated=req_cut or resp_cut,
        )
        async with SessionLocal() as session:
            session.add(row)
            await session.commit()
            return row.id
    except Exception as e:  # noqa: BLE001
        logger.warning("upstream_exchange_store_failed", integration=integration, error_type=type(e).__name__)
        return None


def _short(value) -> str | None:
    return str(value)[:64] if value else None
