"""Optional Sentry integration — guarded by SENTRY_DSN."""
from __future__ import annotations

import structlog

from src.config import settings

logger = structlog.get_logger()


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

    def _before_send(event, hint):
        # Never ship request bodies or auth headers.
        request = event.get("request") or {}
        request.pop("data", None)
        headers = request.get("headers") or {}
        for key in list(headers):
            if key.lower() in {"authorization", "cookie", "x-seller-api-key", "x-internal-key"}:
                headers[key] = "[REDACTED]"
        request["headers"] = headers
        event["request"] = request
        return event

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.deployment_environment,
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
        ],
        send_default_pii=False,
        before_send=_before_send,
    )
    logger.info("sentry_initialized", environment=settings.deployment_environment)
