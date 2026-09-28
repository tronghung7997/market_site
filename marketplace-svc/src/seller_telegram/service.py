"""A seller's own Telegram bot: connect it, link chats, choose events.

Every Telegram call happens with no database transaction open (each function
commits what it read before calling out), and a write that follows re-reads
the bot row under a lock. Delivery lives in ``dispatch``.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.mail.runtime import load_runtime
from src.models.account import Account
from src.models.alert import Alert
from src.models.notification import Notification
from src.models.seller_telegram import SellerTelegramBot, SellerTelegramChat

from . import client, texts
from .client import TelegramError

# What a seller can switch on/off for Telegram; absent from `events` = on.
EVENT_KEYS = ("order_pending", "order_sla", "dispute", "stock_low", "supply_error", "withdrawal", "chat_messages")
MAX_CHATS = 5
LINK_CODE_TTL = timedelta(minutes=10)

_TOKEN_RE = re.compile(r"^\d{5,16}:[A-Za-z0-9_-]{30,64}$")
_START_RE = re.compile(r"^/start(?:@([A-Za-z0-9_]{3,64}))?\s+(\d{6})\s*$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _code_hash(bot_row_id: int, code: str) -> str:
    return hashlib.sha256(f"{bot_row_id}:{code}".encode()).hexdigest()


def _telegram_failure(exc: TelegramError):
    if exc.kind in {"unauthorized", "bad_request"}:
        return api_error(ErrorCode.TELEGRAM_TOKEN_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT)
    if exc.kind == "conflict":
        return api_error(ErrorCode.TELEGRAM_WEBHOOK_IN_USE, status.HTTP_409_CONFLICT)
    return api_error(ErrorCode.TELEGRAM_UNAVAILABLE, status.HTTP_503_SERVICE_UNAVAILABLE)


async def _bot(seller_id: int, db: AsyncSession, *, lock: bool = False) -> SellerTelegramBot:
    query = select(SellerTelegramBot).where(SellerTelegramBot.seller_id == seller_id)
    if lock:
        query = query.with_for_update()
    bot = await db.scalar(query)
    if bot is None:
        raise api_error(ErrorCode.TELEGRAM_NOT_CONNECTED, status.HTTP_404_NOT_FOUND)
    return bot


async def _chats(bot_row_id: int, db: AsyncSession) -> list[SellerTelegramChat]:
    return list((await db.scalars(
        select(SellerTelegramChat).where(SellerTelegramChat.bot_row_id == bot_row_id).order_by(SellerTelegramChat.id)
    )).all())


async def reset_cursors(bot: SellerTelegramBot, db: AsyncSession) -> None:
    """Start delivering from now: whatever happened while the bot was not
    connected (or paused) is not replayed into the chat."""
    bot.last_notification_id = int(await db.scalar(
        select(func.coalesce(func.max(Notification.id), 0)).where(Notification.account_id == bot.seller_id)
    ) or 0)
    bot.last_alert_id = int(await db.scalar(select(func.coalesce(func.max(Alert.id), 0))) or 0)
    bot.recent_sent = {}
    bot.chat_watermark_at = _now()
    bot.chat_digest_sent_at = None
    bot.retry_after_at = None


def _token_hint(bot: SellerTelegramBot) -> str:
    return f"{str(bot.bot_id)[:4]}…{bot.token[-3:]}"


def enabled_events(bot: SellerTelegramBot) -> dict[str, bool]:
    stored = bot.events or {}
    return {key: bool(stored.get(key, True)) for key in EVENT_KEYS}


def _chat_dto(chat: SellerTelegramChat) -> dict:
    return {"key": chat.public_key, "type": chat.chat_type, "title": chat.title, "status": chat.status}


async def get_state(seller_id: int, db: AsyncSession) -> dict:
    bot = await db.scalar(select(SellerTelegramBot).where(SellerTelegramBot.seller_id == seller_id))
    if bot is None:
        return {"connected": False, "events": {key: True for key in EVENT_KEYS}, "chats": [], "max_chats": MAX_CHATS}
    link_active = bool(bot.link_code_hash and bot.link_code_expires_at and bot.link_code_expires_at > _now())
    return {
        "connected": True,
        "bot": {"username": bot.bot_username, "name": bot.bot_name, "token_hint": _token_hint(bot)},
        "status": bot.status,
        "paused_reason": bot.paused_reason,
        "paused_at": bot.paused_at,
        "events": enabled_events(bot),
        "chats": [_chat_dto(chat) for chat in await _chats(bot.id, db)],
        "max_chats": MAX_CHATS,
        "link_expires_at": bot.link_code_expires_at if link_active else None,
    }


async def connect(seller_id: int, token: str, db: AsyncSession, *, replace_webhook: bool = False) -> dict:
    """Validate a BotFather token with Telegram and store it for the shop.
    The same bot pasted again keeps its chats; a different bot starts over."""
    token = (token or "").strip()
    if not _TOKEN_RE.match(token):
        raise api_error(ErrorCode.TELEGRAM_TOKEN_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT)
    await db.commit()  # no transaction held across the Telegram calls
    try:
        info = await client.get_me(token)
        webhook = await client.webhook_url(token)
        if webhook:
            if not replace_webhook:
                raise api_error(ErrorCode.TELEGRAM_WEBHOOK_IN_USE, status.HTTP_409_CONFLICT)
            await client.delete_webhook(token)
    except TelegramError as exc:
        raise _telegram_failure(exc) from None

    bot = await db.scalar(
        select(SellerTelegramBot).where(SellerTelegramBot.seller_id == seller_id).with_for_update()
    )
    replaced = bot is not None and bot.bot_id != info.id
    if bot is None:
        bot = SellerTelegramBot(seller_id=seller_id, token=token, bot_id=info.id, bot_username=info.username,
                                bot_name=info.name[:128], events={})
        db.add(bot)
    else:
        if replaced:
            await db.execute(delete(SellerTelegramChat).where(SellerTelegramChat.bot_row_id == bot.id))
            bot.update_offset = None
        bot.token = token
        bot.bot_id = info.id
        bot.bot_username = info.username
        bot.bot_name = info.name[:128]
    bot.status = "active"
    bot.paused_reason = None
    bot.paused_at = None
    bot.fail_count = 0
    bot.link_code_hash = None
    bot.link_code_expires_at = None
    await reset_cursors(bot, db)
    await log_event(db, "info", "Seller connected a Telegram bot", request_id=current_request_id(), metadata={
        "event": "seller_telegram_connected", "actor_id": seller_id, "actor_type": "seller",
        "subject_type": "seller_telegram_bot", "bot_username": info.username,
        "replaced_bot": replaced, "webhook_removed": bool(webhook),
    })
    await db.commit()
    return await get_state(seller_id, db)


async def start_link(seller_id: int, db: AsyncSession) -> dict:
    """A one-time code the seller sends to their bot (``/start <code>``)."""
    bot = await _bot(seller_id, db)
    linked = sum(1 for chat in await _chats(bot.id, db) if chat.status != "broken")
    if linked >= MAX_CHATS:
        raise api_error(ErrorCode.TELEGRAM_CHAT_LIMIT, status.HTTP_409_CONFLICT, max=MAX_CHATS)
    token, bot_row_id, username = bot.token, bot.id, bot.bot_username
    await db.commit()
    try:
        last = await client.latest_update_id(token)
    except TelegramError as exc:
        raise _telegram_failure(exc) from None

    code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = _now() + LINK_CODE_TTL
    bot = await _bot(seller_id, db, lock=True)
    if bot.id != bot_row_id:
        raise api_error(ErrorCode.TELEGRAM_NOT_CONNECTED, status.HTTP_404_NOT_FOUND)
    bot.link_code_hash = _code_hash(bot.id, code)
    bot.link_code_expires_at = expires_at
    bot.update_offset = (last + 1) if last is not None else None
    await db.commit()
    return {
        "code": code,
        "expires_at": expires_at,
        "deep_link": f"https://t.me/{username}?start={code}",
        "group_command": f"/start@{username} {code}",
    }


def _chat_title(chat: dict) -> str:
    if chat.get("title"):
        return str(chat["title"])[:128]
    name = " ".join(str(part) for part in (chat.get("first_name"), chat.get("last_name")) if part)
    if chat.get("username"):
        name = f"{name} (@{chat['username']})" if name else f"@{chat['username']}"
    return name[:128]


def _find_code(updates: list[dict], username: str, code_hash: str, bot_row_id: int) -> dict | None:
    for update in updates:
        message = update.get("message")
        if not isinstance(message, dict) or not isinstance(message.get("chat"), dict):
            continue
        match = _START_RE.match(str(message.get("text") or "").strip())
        if not match:
            continue
        addressed_to, code = match.groups()
        if addressed_to and addressed_to.lower() != username.lower():
            continue
        if secrets.compare_digest(_code_hash(bot_row_id, code), code_hash):
            return message["chat"]
    return None


async def poll_link(seller_id: int, db: AsyncSession) -> dict:
    """Read the bot's new messages once and link the chat that sent the code.

    Status: ``waiting`` · ``linked`` (with the chat, still to be confirmed by
    the seller) · ``expired`` · ``idle`` (no code issued)."""
    bot = await _bot(seller_id, db)
    if not bot.link_code_hash:
        return {"status": "idle"}
    if not bot.link_code_expires_at or bot.link_code_expires_at <= _now():
        return {"status": "expired"}
    token, offset, code_hash, bot_row_id, username = (
        bot.token, bot.update_offset, bot.link_code_hash, bot.id, bot.bot_username,
    )
    await db.commit()
    try:
        updates = await client.get_updates(token, offset)
    except TelegramError as exc:
        raise _telegram_failure(exc) from None
    found = _find_code(updates, username, code_hash, bot_row_id)
    next_offset = max((int(u.get("update_id", 0)) for u in updates), default=None)

    bot = await _bot(seller_id, db, lock=True)
    if next_offset is not None and bot.id == bot_row_id:
        bot.update_offset = max(bot.update_offset or 0, next_offset + 1)
    if found is None or bot.id != bot_row_id or bot.link_code_hash != code_hash:
        await db.commit()
        return {"status": "waiting"}

    chat = await db.scalar(select(SellerTelegramChat).where(
        SellerTelegramChat.bot_row_id == bot.id, SellerTelegramChat.chat_id == int(found["id"]),
    ))
    if chat is None:
        chat = SellerTelegramChat(
            bot_row_id=bot.id, public_key=secrets.token_hex(8), chat_id=int(found["id"]),
            chat_type=str(found.get("type") or "private")[:16], title=_chat_title(found), status="pending",
        )
        db.add(chat)
    else:
        chat.title = _chat_title(found) or chat.title
        if chat.status == "broken":
            chat.status, chat.fail_count = "pending", 0
    bot.link_code_hash = None
    bot.link_code_expires_at = None
    await db.commit()
    return {"status": "linked", "chat": _chat_dto(chat)}


async def _send_test(token: str, chat_id: int, bot_username: str, locale: str, db: AsyncSession) -> None:
    brand = (await load_runtime(db)).mail_from_name
    await db.commit()
    await client.send_message(token, chat_id, texts.test_message(brand, bot_username, locale))


async def _locale(seller_id: int, db: AsyncSession) -> str:
    return texts.loc(await db.scalar(select(Account.preferred_locale).where(Account.id == seller_id)))


async def confirm_chat(seller_id: int, key: str, db: AsyncSession) -> dict:
    """The seller says the linked chat is theirs: send the test message and
    start delivering there (a paused bot resumes from now)."""
    bot = await _bot(seller_id, db)
    chat = await db.scalar(select(SellerTelegramChat).where(
        SellerTelegramChat.bot_row_id == bot.id, SellerTelegramChat.public_key == key,
    ))
    if chat is None:
        raise api_error(ErrorCode.TELEGRAM_CHAT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    locale = await _locale(seller_id, db)
    try:
        await _send_test(bot.token, chat.chat_id, bot.bot_username, locale, db)
    except TelegramError as exc:
        if exc.kind in {"forbidden", "bad_request"}:
            raise api_error(ErrorCode.TELEGRAM_CHAT_UNREACHABLE, status.HTTP_409_CONFLICT) from None
        raise _telegram_failure(exc) from None

    bot = await _bot(seller_id, db, lock=True)
    chat = await db.scalar(select(SellerTelegramChat).where(
        SellerTelegramChat.bot_row_id == bot.id, SellerTelegramChat.public_key == key,
    ))
    if chat is None:
        raise api_error(ErrorCode.TELEGRAM_CHAT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if chat.status != "active":
        chat.status, chat.fail_count, chat.confirmed_at = "active", 0, _now()
        await log_event(db, "info", "Seller linked a Telegram chat", request_id=current_request_id(), metadata={
            "event": "seller_telegram_chat_linked", "actor_id": seller_id, "actor_type": "seller",
            "subject_type": "seller_telegram_chat", "chat_type": chat.chat_type,
        })
    if bot.status == "paused":
        bot.status, bot.paused_reason, bot.paused_at, bot.fail_count = "active", None, None, 0
        await reset_cursors(bot, db)
    await db.commit()
    return await get_state(seller_id, db)


async def send_test(seller_id: int, db: AsyncSession) -> dict:
    """Send the test message to every active chat; report how many got it."""
    bot = await _bot(seller_id, db)
    chats = [(chat.public_key, chat.chat_id) for chat in await _chats(bot.id, db) if chat.status == "active"]
    token, username = bot.token, bot.bot_username
    locale = await _locale(seller_id, db)
    delivered, failed = [], []
    for key, chat_id in chats:
        try:
            await _send_test(token, chat_id, username, locale, db)
            delivered.append(key)
        except TelegramError as exc:
            if exc.kind == "unauthorized":
                raise _telegram_failure(exc) from None
            failed.append(key)
    return {"delivered": delivered, "failed": failed}


async def remove_chat(seller_id: int, key: str, db: AsyncSession) -> dict:
    bot = await _bot(seller_id, db, lock=True)
    result = await db.execute(delete(SellerTelegramChat).where(
        SellerTelegramChat.bot_row_id == bot.id, SellerTelegramChat.public_key == key,
    ))
    if not result.rowcount:
        raise api_error(ErrorCode.TELEGRAM_CHAT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await db.commit()
    return await get_state(seller_id, db)


async def update_events(seller_id: int, events: dict[str, bool], db: AsyncSession) -> dict:
    unknown = sorted(set(events) - set(EVENT_KEYS))
    if unknown:
        raise api_error(ErrorCode.TELEGRAM_EVENT_UNKNOWN, status.HTTP_422_UNPROCESSABLE_CONTENT, event=unknown[0])
    bot = await _bot(seller_id, db, lock=True)
    bot.events = {**enabled_events(bot), **{key: bool(value) for key, value in events.items()}}
    await db.commit()
    return await get_state(seller_id, db)


async def disconnect(seller_id: int, db: AsyncSession) -> dict:
    """Forget the token and every linked chat (the bot itself stays the
    seller's; revoking it is done in @BotFather)."""
    bot = await _bot(seller_id, db, lock=True)
    await log_event(db, "info", "Seller disconnected their Telegram bot", request_id=current_request_id(), metadata={
        "event": "seller_telegram_disconnected", "actor_id": seller_id, "actor_type": "seller",
        "subject_type": "seller_telegram_bot", "bot_username": bot.bot_username,
    })
    await db.delete(bot)
    await db.commit()
    return await get_state(seller_id, db)
