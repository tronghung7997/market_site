"""HTTP client for the takedown partner ("Takedown Module", API.vi.md).

GMMO calls as a *member* with its client key (``X-API-Key: tdk_...``), so it
only ever sees its own orders. Every response is wrapped as
``{"status", "message", "data", "meta", "errors"}``; ``status == "error"`` or a
non-2xx code raises :class:`PartnerError`. Timestamps come as naive UTC+7
strings (``YYYY-MM-DD HH:MM:SS``) and are converted to aware UTC here, once.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from src.config import settings
from src.observability.outbound import integration

SERVICES = ("article_copyright", "profile_impersonation", "profile_copyright", "group_copyright")
WARRANTY_HOURS = (24, 72)
PARTNER_TZ = timezone(timedelta(hours=7))


class PartnerError(Exception):
    """The partner answered with an error (status_code set) or could not be reached (None)."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code

    @property
    def unreachable(self) -> bool:
        return self.status_code is None or self.status_code >= 500


def is_configured() -> bool:
    return bool(settings.takedown_api_base_url and settings.takedown_client_key)


def parse_time(value: str | None) -> datetime | None:
    """Partner time (naive, UTC+7) → aware UTC; None stays None."""
    if not value:
        return None
    try:
        naive = datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            parsed = datetime.fromisoformat(value.strip())
        except ValueError:
            return None
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=PARTNER_TZ)).astimezone(timezone.utc)
    return naive.replace(tzinfo=PARTNER_TZ).astimezone(timezone.utc)


async def _call(method: str, path: str, *, json: dict | None = None, params: dict | None = None) -> Any:
    if not is_configured():
        raise PartnerError("Takedown partner is not configured", None)
    base = settings.takedown_api_base_url.rstrip("/")
    headers = {"X-API-Key": settings.takedown_client_key, "Accept": "application/json"}
    try:
        with integration("takedown"):
            async with httpx.AsyncClient(timeout=settings.takedown_request_timeout_seconds) as client:
                response = await client.request(method, f"{base}{path}", json=json, params=params, headers=headers)
    except httpx.HTTPError as exc:
        raise PartnerError(f"{type(exc).__name__}", None) from exc
    try:
        body = response.json()
    except ValueError:
        body = None
    if response.status_code >= 400 or not isinstance(body, dict) or body.get("status") != "success":
        message = body.get("message") if isinstance(body, dict) else None
        raise PartnerError(str(message or f"HTTP {response.status_code}")[:300], response.status_code)
    return body.get("data")


async def create_order(*, service: str, platform: str, target_url: str, reason: str | None, warranty_hours: int) -> dict:
    return await _call("POST", "/orders", json={
        "service": service, "platform": platform, "target_url": target_url,
        "reason": reason, "warranty_hours": warranty_hours,
    })


async def list_orders(status: str | None = None) -> list[dict]:
    data = await _call("GET", "/orders", params={"status": status} if status else None)
    return data if isinstance(data, list) else []


async def get_order(order_id: int) -> dict:
    return await _call("GET", f"/orders/{order_id}")


async def get_evidence(order_id: int) -> dict:
    return await _call("GET", f"/orders/{order_id}/evidence")


async def action(order_id: int, name: str, note: str | None = None) -> dict:
    """Member actions: accept, decline, cancel, warranty (note required)."""
    return await _call("POST", f"/orders/{order_id}/{name}", json={"note": note} if note else {})


IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
IMAGE_MAX_BYTES = 8 * 1024 * 1024


async def fetch_image(url: str) -> tuple[bytes, str]:
    """Download one partner evidence screenshot (raster only, size-capped) so we can serve it ourselves."""
    try:
        with integration("takedown"):
            async with httpx.AsyncClient(timeout=settings.takedown_request_timeout_seconds, follow_redirects=True,
                                         max_redirects=3) as http:
                async with http.stream("GET", url, headers={"Accept": "image/*"}) as response:
                    if response.status_code != 200:
                        raise PartnerError(f"evidence HTTP {response.status_code}", response.status_code)
                    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
                    if content_type not in IMAGE_TYPES:
                        raise PartnerError(f"evidence is not an image ({content_type or 'unknown'})", 422)
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        data += chunk
                        if len(data) > IMAGE_MAX_BYTES:
                            raise PartnerError("evidence image too large", 413)
    except httpx.HTTPError as exc:
        raise PartnerError(f"{type(exc).__name__}", None) from exc
    return bytes(data), content_type


async def health() -> bool:
    if not settings.takedown_api_base_url:
        return False
    base = settings.takedown_api_base_url.rstrip("/")
    root = base.rsplit("/api/", 1)[0] if "/api/" in base else base
    for url in (f"{base}/health", f"{root}/health"):
        try:
            with integration("takedown"):
                async with httpx.AsyncClient(timeout=5) as client:
                    r = await client.get(url)
            if r.status_code == 200:
                return True
        except httpx.HTTPError:
            continue
    return False


def sign_webhook(raw_body: bytes, timestamp: str | int, secret: str | None = None) -> str:
    """``sha256=<hex>`` of HMAC-SHA256(secret, "<timestamp>.<raw body>") — the partner's signature."""
    key = settings.takedown_webhook_secret if secret is None else secret
    digest = hmac.new(key.encode("utf-8"), str(timestamp).encode("ascii") + b"." + raw_body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def verify_webhook(raw_body: bytes, signature: str | None, timestamp: str | None, *, now: float | None = None) -> bool:
    secret = settings.takedown_webhook_secret
    if not secret or not signature or not timestamp:
        return False
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    current = time.time() if now is None else now
    if abs(current - ts) > settings.takedown_webhook_timestamp_tolerance_seconds:
        return False
    return hmac.compare_digest(sign_webhook(raw_body, ts, secret), signature)
