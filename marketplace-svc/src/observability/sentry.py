"""Optional Sentry integration — guarded by SENTRY_DSN."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import structlog

from src.config import settings
from src.logging import current_request_id

logger = structlog.get_logger()

_SENSITIVE_HEADERS = {
    "authorization",
    "cookie",
    "x-seller-api-key",
    "x-api-key",
    "x-signature",
    "x-internal-key",
}
_GATEWAY_KEY_PATH_RE = re.compile(r"(/gw/)[^/]+(/)", re.IGNORECASE)


def _scrub_url(raw_url: str) -> str:
    """Remove query/fragment data and redact gateway keys embedded in paths."""
    try:
        parts = urlsplit(raw_url)
        clean_path = _GATEWAY_KEY_PATH_RE.sub(r"\1[REDACTED]\2", parts.path)
        return urlunsplit((parts.scheme, parts.netloc, clean_path, "", ""))
    except (TypeError, ValueError):
        # Malformed SDK input is safer omitted than exported verbatim.
        return "[REDACTED]"


def scrub_sentry_event(event: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any]:
    """Strip request secrets and attach the validated correlation ID."""
    request = dict(event.get("request") or {})
    request.pop("data", None)
    request.pop("query_string", None)
    request.pop("cookies", None)

    raw_url = request.get("url")
    if isinstance(raw_url, str):
        request["url"] = _scrub_url(raw_url)

    headers = request.get("headers")
    if isinstance(headers, dict):
        safe_headers = dict(headers)
        for key in list(safe_headers):
            if str(key).lower() in _SENSITIVE_HEADERS:
                safe_headers[key] = "[REDACTED]"
        request["headers"] = safe_headers
    elif headers is not None:
        # Unknown header containers are omitted rather than risking leakage.
        request.pop("headers", None)

    event["request"] = request
    request_id = current_request_id()
    if request_id:
        tags = dict(event.get("tags") or {})
        tags["request_id"] = request_id
        event["tags"] = tags
    return event


def init_sentry() -> None:
    dsn = (settings.sentry_dsn or "").strip()
    if not dsn:
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        logger.warning("sentry_sdk_missing", detail="SENTRY_DSN set but sentry-sdk not installed")
        return

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.deployment_environment,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
        send_default_pii=False,
        before_send=scrub_sentry_event,
    )
    logger.info("sentry_initialized", environment=settings.deployment_environment)
