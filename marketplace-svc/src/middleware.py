import re
import time
from typing import Any

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.logging import generate_request_id

# Safe client-supplied correlation IDs: printable, no spaces, fit VARCHAR(36).
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,36}$")


def normalize_request_id(raw: str | None) -> str:
    """Accept a client X-Request-ID only when it is safe to persist.

    log_entries.request_id is VARCHAR(36). An overlong or malformed value
    must never reach an audited business transaction insert.
    """
    if raw is None:
        return generate_request_id()
    candidate = raw.strip()
    if not candidate or not _REQUEST_ID_RE.fullmatch(candidate):
        return generate_request_id()
    return candidate


def _route_template(scope: Scope) -> str:
    """Prefer the low-cardinality route template over a concrete path."""
    route = scope.get("route")
    if route is not None:
        path = getattr(route, "path", None)
        if isinstance(path, str) and path:
            return path
    return scope.get("path") or ""


def _account_id_from_scope(scope: Scope) -> int | None:
    state = scope.get("state")
    if state is None:
        return None
    if isinstance(state, dict):
        value = state.get("account_id")
    else:
        value = getattr(state, "account_id", None)
    if isinstance(value, int):
        return value
    return None


class RequestIdMiddleware:
    """Pure ASGI middleware: validate request IDs and always emit one access event.

    BaseHTTPMiddleware can skip the post-call path on unhandled exceptions.
    A pure ASGI wrapper observes every outcome, including 500s before re-raise.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        request_id = normalize_request_id(headers.get("x-request-id"))

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            service="marketplace-svc",
        )

        start = time.monotonic()
        status_code = 500
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = int(message["status"])
                raw_headers: list[tuple[bytes, bytes]] = list(message.get("headers") or [])
                # Drop any prior value so the validated id is authoritative.
                raw_headers = [
                    (name, value)
                    for name, value in raw_headers
                    if name.lower() != b"x-request-id"
                ]
                raw_headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": raw_headers}
            await send(message)

        logger = structlog.get_logger()
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            duration_ms = int((time.monotonic() - start) * 1000)
            route = _route_template(scope)
            log_kwargs: dict[str, Any] = {
                "method": scope.get("method", ""),
                "route": route,
                "status": 500,
                "duration_ms": duration_ms,
            }
            account_id = _account_id_from_scope(scope)
            if account_id is not None:
                log_kwargs["account_id"] = account_id
            logger.error("http_request", exc_info=True, **log_kwargs)
            try:
                from src.observability.metrics import observe_http_request, observe_unhandled_exception
                observe_http_request(
                    method=scope.get("method", ""),
                    route=route,
                    status=500,
                    duration_ms=duration_ms,
                )
                observe_unhandled_exception()
            except Exception:
                pass
            raise

        duration_ms = int((time.monotonic() - start) * 1000)
        route = _route_template(scope)
        log_kwargs = {
            "method": scope.get("method", ""),
            "route": route,
            "status": status_code,
            "duration_ms": duration_ms,
        }
        account_id = _account_id_from_scope(scope)
        if account_id is not None:
            log_kwargs["account_id"] = account_id
        logger.info("http_request", **log_kwargs)
        try:
            from src.observability.metrics import observe_http_request
            observe_http_request(
                method=scope.get("method", ""),
                route=route,
                status=status_code,
                duration_ms=duration_ms,
            )
        except Exception:
            pass


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Apply browser hardening headers at the application boundary.

    The API normally returns JSON only. Optional local API docs need their own
    less restrictive CSP so their bundled static assets can render.
    """

    def __init__(self, app, *, enable_hsts: bool = False):
        super().__init__(app)
        self.enable_hsts = enable_hsts

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        )
        if request.url.path in {"/docs", "/redoc"}:
            csp = (
                "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                "font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"
            )
        else:
            csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        response.headers.setdefault("Content-Security-Policy", csp)
        if self.enable_hsts:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response
