"""Telegram Bot API — the only place a bot token (a seller's bot, or the
marketplace's ops bot in ``src.ops_telegram``) is put on the wire.

The token is part of every request URL, so nothing here logs a URL or an
httpx exception text; failures surface as ``TelegramError`` with a kind the
callers act on. Tests swap the transport through ``set_transport``.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from src.config import settings

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
_transport: httpx.AsyncBaseTransport | None = None

# httpx logs every request line at INFO — with the token in it.
logging.getLogger("httpx").setLevel(logging.WARNING)


def set_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    """Test seam: route every call through ``transport`` (None = network)."""
    global _transport
    _transport = transport


class TelegramError(Exception):
    """kind: unauthorized (token revoked/invalid) · forbidden (blocked, kicked)
    · bad_request · conflict (a webhook owns the bot's updates) · rate_limited
    · unavailable (network, 5xx, unreadable answer)."""

    def __init__(
        self,
        kind: str,
        *,
        description: str = "",
        retry_after: int | None = None,
        migrate_to_chat_id: int | None = None,
    ) -> None:
        super().__init__(kind)
        self.kind = kind
        self.description = description[:200]
        self.retry_after = retry_after
        self.migrate_to_chat_id = migrate_to_chat_id


@dataclass(frozen=True)
class BotInfo:
    id: int
    username: str
    name: str


_KIND_BY_STATUS = {401: "unauthorized", 403: "forbidden", 400: "bad_request", 404: "unauthorized", 409: "conflict", 429: "rate_limited"}


async def _call(token: str, method: str, payload: dict | None = None):
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, transport=_transport) as client:
            base = settings.telegram_api_base.rstrip("/")
            response = await client.post(f"{base}/bot{token}/{method}", json=payload or {})
    except httpx.HTTPError:
        # str(exc) can carry the request URL, i.e. the token.
        raise TelegramError("unavailable", description=f"{method}: network error") from None
    try:
        body = response.json()
    except ValueError:
        raise TelegramError("unavailable", description=f"{method}: HTTP {response.status_code}") from None
    if isinstance(body, dict) and body.get("ok") is True:
        return body.get("result")
    status = response.status_code
    body = body if isinstance(body, dict) else {}
    code = body.get("error_code") if isinstance(body.get("error_code"), int) else status
    parameters = body.get("parameters") if isinstance(body.get("parameters"), dict) else {}
    kind = _KIND_BY_STATUS.get(code, "unavailable")
    raise TelegramError(
        kind,
        description=str(body.get("description") or f"HTTP {status}"),
        retry_after=parameters.get("retry_after") if isinstance(parameters.get("retry_after"), int) else None,
        migrate_to_chat_id=(
            parameters.get("migrate_to_chat_id") if isinstance(parameters.get("migrate_to_chat_id"), int) else None
        ),
    )


async def get_me(token: str) -> BotInfo:
    result = await _call(token, "getMe")
    if not isinstance(result, dict) or not result.get("is_bot") or not result.get("username"):
        raise TelegramError("unavailable", description="getMe: unexpected answer")
    return BotInfo(id=int(result["id"]), username=str(result["username"]), name=str(result.get("first_name") or ""))


async def webhook_url(token: str) -> str:
    result = await _call(token, "getWebhookInfo")
    return str((result or {}).get("url") or "") if isinstance(result, dict) else ""


async def delete_webhook(token: str) -> None:
    await _call(token, "deleteWebhook", {"drop_pending_updates": False})


async def get_updates(token: str, offset: int | None) -> list[dict]:
    """Pending message updates from ``offset`` on, without waiting. Asking
    with an offset confirms (drops) every older update on Telegram's side."""
    payload: dict = {"timeout": 0, "limit": 100, "allowed_updates": ["message"]}
    if offset is not None:
        payload["offset"] = offset
    result = await _call(token, "getUpdates", payload)
    return [u for u in result if isinstance(u, dict)] if isinstance(result, list) else []


async def latest_update_id(token: str) -> int | None:
    result = await _call(token, "getUpdates", {"offset": -1, "limit": 1, "timeout": 0})
    if isinstance(result, list) and result and isinstance(result[-1], dict):
        return int(result[-1].get("update_id", 0))
    return None


async def send_message(
    token: str, chat_id: int | str, html_text: str, button: tuple[str, str] | None = None, *, silent: bool = False,
) -> None:
    """``chat_id`` is a numeric id or a public ``@channel`` handle; ``silent``
    delivers without sound (``disable_notification``)."""
    payload: dict = {
        "chat_id": chat_id,
        "text": html_text,
        "parse_mode": "HTML",
        "link_preview_options": {"is_disabled": True},
    }
    if silent:
        payload["disable_notification"] = True
    if button:
        payload["reply_markup"] = {"inline_keyboard": [[{"text": button[0], "url": button[1]}]]}
    await _call(token, "sendMessage", payload)
