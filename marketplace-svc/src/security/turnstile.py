"""Cloudflare Turnstile server-side verification.

Off unless both the admin site key (auth_runtime_config) and the env secret
are present, so local development and tests never call out.
"""
from __future__ import annotations

import httpx
import structlog

from src.config import settings

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
logger = structlog.get_logger()


def secret_configured() -> bool:
    return bool(settings.turnstile_secret_key.strip())


async def verify_token(token: str | None, *, remote_ip: str | None = None) -> bool:
    """True when Cloudflare accepts the challenge response."""
    if not token:
        return False
    data = {"secret": settings.turnstile_secret_key.strip(), "response": token}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=settings.turnstile_verify_timeout_seconds) as client:
            resp = await client.post(VERIFY_URL, data=data)
            resp.raise_for_status()
            payload = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("turnstile_verify_failed", error=str(exc))
        return False
    return bool(payload.get("success"))
