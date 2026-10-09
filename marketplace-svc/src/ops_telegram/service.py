"""The marketplace's ops Telegram bot: admin config, test sends, and the
outbox other modules write to.

Notify operators from any module
--------------------------------
``enqueue_ops_message(session, kind, text, *, dedupe_key=None, level="info",
link=None, low_priority=False)`` adds one message to ``ops_telegram_outbox``
inside the caller's transaction and never commits: a rolled-back change is
never announced. ``text`` is plain text (escaped here); its first line is the
title, the rest the body. ``link`` is an admin path (``/admin/…``; numeric ids
are fine there) or an https URL. ``dedupe_key`` makes the call idempotent (a
second call with the same key adds nothing). ``level`` is ``urgent`` /
``action`` / ``info``; ``low_priority`` messages arrive silently when the admin
turned on quiet mode. Nothing is queued while the bot is off, or when ``kind``
is one of ``EVENT_KEYS`` and the admin switched that event off. Returns
whether a row was added. The dispatcher (``dispatch.ops_telegram_dispatch_job``)
delivers it to the operators' group with retries.

Everything the bot reports on its own (withdrawals, disputes, deposits,
kill-switches, system alerts, seller applications, new products for the
channel) is collected by the dispatcher from rows the marketplace already
writes (``collect``), so the domain services carry no Telegram hooks.

Config rules: the token is write-only (only ``…ab12`` is shown) and never
logged; Telegram is called with no database transaction open; every change is
audited as ``ops_telegram_config_changed`` with old → new per field.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import status
from sqlalchemy import func, literal, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts.service import upsert_incident
from src.audit.service import log_event
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.mail.runtime import load_runtime
from src.models.account import Account
from src.models.alert import Alert
from src.models.log_entry import LogEntry
from src.models.ops_telegram import OpsTelegramConfig, OpsTelegramListedProduct, OpsTelegramOutbox
from src.models.payment import SePayWebhookEvent
from src.models.product import Product, ProductStatus
from src.seller_telegram import client
from src.seller_telegram.client import TelegramError

from . import texts

logger = structlog.get_logger()

_CONFIG_ID = 1
# Ops-group events an admin can switch on/off; absent from `events` = on.
EVENT_KEYS = (
    "withdrawal_requested", "dispute_opened", "dispute_timeout", "deposit_unmatched",
    "deposit_anomaly", "site_switch", "system_alert", "seller_application",
)
LEVELS = ("urgent", "action", "info")
CHANNEL_INTERVAL_RANGE = (5, 1440)
PAUSE_REASONS = ("token_rejected", "ops_chat_unreachable", "channel_unreachable")
PAUSED_ALERT_TYPE = "ops_telegram_paused"
PAUSED_FINGERPRINT = "ops_telegram:1:paused"

_TOKEN_RE = re.compile(r"^\d{5,16}:[A-Za-z0-9_-]{30,64}$")
_CHAT_RE = re.compile(r"^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$")
_SETTINGS_URL = "/admin/display-settings?tab=opsBot"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def token_hint(token: str | None) -> str | None:
    return f"…{token[-4:]}" if token else None


def enabled_events(cfg: OpsTelegramConfig) -> dict[str, bool]:
    stored = cfg.events or {}
    return {key: bool(stored.get(key, True)) for key in EVENT_KEYS}


def _telegram_failure(exc: TelegramError):
    if exc.kind in {"unauthorized", "bad_request"}:
        return api_error(ErrorCode.TELEGRAM_TOKEN_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT)
    return api_error(ErrorCode.TELEGRAM_UNAVAILABLE, status.HTTP_503_SERVICE_UNAVAILABLE)


def chat_ref(value: str) -> int | str:
    """Telegram takes numeric ids as numbers and public channels as @name."""
    return int(value) if value.lstrip("-").isdigit() else value


async def load_config(db: AsyncSession, *, lock: bool = False) -> OpsTelegramConfig | None:
    query = select(OpsTelegramConfig).where(OpsTelegramConfig.id == _CONFIG_ID)
    if lock:
        query = query.with_for_update()
    return await db.scalar(query)


async def _ensure_config(db: AsyncSession) -> OpsTelegramConfig:
    await db.execute(
        pg_insert(OpsTelegramConfig).values(id=_CONFIG_ID).on_conflict_do_nothing(index_elements=["id"])
    )
    row = await load_config(db, lock=True)
    assert row is not None
    return row


# ── outbox ──────────────────────────────────────────────────────────────────

async def add_outbox(
    db: AsyncSession, *, target: str, kind: str, level: str, title: str, body_html: str = "",
    link: str | None = None, dedupe_key: str | None = None, low_priority: bool = False,
) -> bool:
    """Insert one already-escaped message; a repeated ``dedupe_key`` is a no-op."""
    stmt = pg_insert(OpsTelegramOutbox).values(
        target=target, kind=kind[:48], level=level if level in LEVELS else "info", low_priority=low_priority,
        title=texts.clip(title, 200), body=body_html, link=(link or None) and link[:500],
        dedupe_key=dedupe_key[:120] if dedupe_key else None,
    )
    if dedupe_key:
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["dedupe_key"], index_where=OpsTelegramOutbox.dedupe_key.is_not(None),
        )
    result = await db.execute(stmt)
    return bool(result.rowcount)


async def enqueue_ops_message(
    session: AsyncSession, kind: str, text: str, *, dedupe_key: str | None = None,
    level: str = "info", link: str | None = None, low_priority: bool = False,
) -> bool:
    """Queue a message for the operators' group (see the module docstring)."""
    kind = (kind or "").strip()
    lines = [line for line in str(text or "").strip().splitlines()]
    if not kind or not lines:
        raise ValueError("kind and text are required")
    cfg = await load_config(session)
    if cfg is None or not cfg.enabled or not cfg.bot_token or not cfg.ops_chat_id:
        return False
    if kind in EVENT_KEYS and not enabled_events(cfg)[kind]:
        return False
    return await add_outbox(
        session, target="ops", kind=kind, level=level, title=lines[0], body_html=texts.body(*lines[1:]),
        link=link, dedupe_key=dedupe_key, low_priority=low_priority,
    )


# ── admin view ──────────────────────────────────────────────────────────────

async def _outbox_stats(db: AsyncSession) -> dict:
    since = _now() - timedelta(hours=24)
    row = (await db.execute(select(
        func.count().filter(OpsTelegramOutbox.status == "pending"),
        func.count().filter(OpsTelegramOutbox.status == "failed", OpsTelegramOutbox.created_at >= since),
        func.max(OpsTelegramOutbox.sent_at),
    ))).one()
    return {"pending": int(row[0] or 0), "failed_24h": int(row[1] or 0), "last_sent_at": row[2]}


def _payload(cfg: OpsTelegramConfig | None) -> dict:
    if cfg is None:
        cfg = OpsTelegramConfig(id=_CONFIG_ID, enabled=False, ops_chat_id="", channel_chat_id="",
                                channel_enabled=False, channel_interval_minutes=30, events={},
                                quiet_low_priority=False, status="active")
    return {
        "enabled": bool(cfg.enabled),
        "token_set": bool(cfg.bot_token),
        "token_hint": token_hint(cfg.bot_token),
        "bot_username": cfg.bot_username,
        "ops_chat_id": cfg.ops_chat_id or "",
        "channel_chat_id": cfg.channel_chat_id or "",
        "channel_enabled": bool(cfg.channel_enabled),
        "channel_interval_minutes": int(cfg.channel_interval_minutes or 30),
        "events": enabled_events(cfg),
        "quiet_low_priority": bool(cfg.quiet_low_priority),
        "status": cfg.status or "active",
        "paused_reason": cfg.paused_reason,
        "paused_at": cfg.paused_at,
        "updated_at": cfg.updated_at,
        "updated_by_id": cfg.updated_by_id,
    }


async def get_config(db: AsyncSession) -> dict:
    return {**_payload(await load_config(db)), "outbox": await _outbox_stats(db)}


# ── admin writes ────────────────────────────────────────────────────────────

def _audit_view(cfg: OpsTelegramConfig) -> dict:
    """The audited fields (``ops_``-prefixed: the readable audit log keys
    labels by field name); the token only as its hint."""
    view = {
        "ops_enabled": bool(cfg.enabled),
        "ops_bot_token": token_hint(cfg.bot_token),
        "ops_bot_username": cfg.bot_username,
        "ops_chat_id": cfg.ops_chat_id or "",
        "ops_channel_chat_id": cfg.channel_chat_id or "",
        "ops_channel_enabled": bool(cfg.channel_enabled),
        "ops_channel_interval_minutes": int(cfg.channel_interval_minutes or 30),
        "ops_quiet_low_priority": bool(cfg.quiet_low_priority),
        "ops_status": cfg.status,
    }
    view.update({f"ops_event.{key}": value for key, value in enabled_events(cfg).items()})
    return view


async def reset_cursors(cfg: OpsTelegramConfig, db: AsyncSession) -> None:
    """Start from now: what happened while the bot was off or paused is not
    replayed into the group."""
    cfg.last_alert_id = int(await db.scalar(select(func.coalesce(func.max(Alert.id), 0))) or 0)
    cfg.last_log_id = int(await db.scalar(select(func.coalesce(func.max(LogEntry.id), 0))) or 0)
    cfg.last_sepay_event_id = int(await db.scalar(select(func.coalesce(func.max(SePayWebhookEvent.id), 0))) or 0)
    cfg.retry_after_at = None


async def baseline_listed_products(db: AsyncSession) -> None:
    """Products public when the channel is switched on are not announced."""
    await db.execute(
        pg_insert(OpsTelegramListedProduct)
        .from_select(["product_id", "announced"], select(Product.id, literal(False)).where(
            Product.status == ProductStatus.active,
        ))
        .on_conflict_do_nothing(index_elements=["product_id"])
    )


async def _clear_paused_alert(db: AsyncSession) -> None:
    now = _now()
    await db.execute(
        update(Alert).where(Alert.fingerprint == PAUSED_FINGERPRINT, Alert.is_active.is_(True))
        .values(is_active=False, resolved_at=now, admin_resolved_at=func.coalesce(Alert.admin_resolved_at, now))
    )


async def check_token(db: AsyncSession, token: str | None) -> dict:
    """``getMe`` for a pasted token, or for the stored one when none is given."""
    token = (token or "").strip()
    if not token:
        cfg = await load_config(db)
        token = (cfg.bot_token if cfg else None) or ""
        if not token:
            raise api_error(ErrorCode.TELEGRAM_NOT_CONNECTED, status.HTTP_404_NOT_FOUND)
    elif not _TOKEN_RE.match(token):
        raise api_error(ErrorCode.TELEGRAM_TOKEN_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT)
    await db.commit()  # no transaction held across the Telegram call
    try:
        info = await client.get_me(token)
    except TelegramError as exc:
        raise _telegram_failure(exc) from None
    return {"username": info.username, "name": info.name}


def _clean_chat(value: str | None) -> str:
    value = (value or "").strip()
    if value and not _CHAT_RE.match(value):
        raise api_error(ErrorCode.OPS_TELEGRAM_CHAT_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT)
    return value


async def update_config(db: AsyncSession, *, actor_id: int, changes: dict) -> dict:
    """Apply the fields present in ``changes``: ``enabled``, ``bot_token``
    (``""`` clears it), ``ops_chat_id``, ``channel_chat_id``,
    ``channel_enabled``, ``channel_interval_minutes``, ``events`` (partial),
    ``quiet_low_priority``, ``resume`` (lift a pause)."""
    token = changes.get("bot_token")
    info = None
    if token is not None:
        token = token.strip()
        if token:
            if not _TOKEN_RE.match(token):
                raise api_error(ErrorCode.TELEGRAM_TOKEN_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT)
            await db.commit()  # no transaction held across the Telegram call
            try:
                info = await client.get_me(token)
            except TelegramError as exc:
                raise _telegram_failure(exc) from None
    ops_chat = _clean_chat(changes["ops_chat_id"]) if changes.get("ops_chat_id") is not None else None
    channel_chat = _clean_chat(changes["channel_chat_id"]) if changes.get("channel_chat_id") is not None else None
    interval = changes.get("channel_interval_minutes")
    if interval is not None and not CHANNEL_INTERVAL_RANGE[0] <= int(interval) <= CHANNEL_INTERVAL_RANGE[1]:
        raise ValueError(
            f"channel_interval_minutes must be between {CHANNEL_INTERVAL_RANGE[0]} and {CHANNEL_INTERVAL_RANGE[1]}"
        )
    events = changes.get("events")
    if events is not None:
        unknown = sorted(set(events) - set(EVENT_KEYS))
        if unknown:
            raise api_error(ErrorCode.TELEGRAM_EVENT_UNKNOWN, status.HTTP_422_UNPROCESSABLE_CONTENT, event=unknown[0])

    cfg = await _ensure_config(db)
    old = _audit_view(cfg)
    was_running = bool(cfg.enabled) and cfg.status == "active"
    was_channel = bool(cfg.enabled and cfg.channel_enabled and cfg.channel_chat_id)
    old_bot_id = cfg.bot_id

    if token is not None:
        if token and info is not None:
            cfg.bot_token, cfg.bot_id, cfg.bot_username = token, info.id, info.username
        elif not token:
            cfg.bot_token, cfg.bot_id, cfg.bot_username = None, None, None
    if ops_chat is not None:
        cfg.ops_chat_id = ops_chat
    if channel_chat is not None:
        cfg.channel_chat_id = channel_chat
    if changes.get("enabled") is not None:
        cfg.enabled = bool(changes["enabled"])
    if changes.get("channel_enabled") is not None:
        cfg.channel_enabled = bool(changes["channel_enabled"])
    if interval is not None:
        cfg.channel_interval_minutes = int(interval)
    if events is not None:
        cfg.events = {**enabled_events(cfg), **{key: bool(value) for key, value in events.items()}}
    if changes.get("quiet_low_priority") is not None:
        cfg.quiet_low_priority = bool(changes["quiet_low_priority"])
    if cfg.enabled and (not cfg.bot_token or not (cfg.ops_chat_id or cfg.channel_chat_id)):
        raise api_error(ErrorCode.OPS_TELEGRAM_INCOMPLETE, status.HTTP_422_UNPROCESSABLE_CONTENT)

    # A new bot, or an explicit resume, lifts a pause.
    if cfg.status == "paused" and (changes.get("resume") or (cfg.bot_id and cfg.bot_id != old_bot_id)):
        cfg.status, cfg.paused_reason, cfg.paused_at = "active", None, None
        await _clear_paused_alert(db)
    if cfg.enabled and cfg.status == "active" and (not was_running or (cfg.ops_chat_id and not old["ops_chat_id"])):
        await reset_cursors(cfg, db)
    if cfg.enabled and cfg.channel_enabled and cfg.channel_chat_id and not was_channel:
        await baseline_listed_products(db)
    cfg.updated_at = _now()
    cfg.updated_by_id = actor_id

    new = _audit_view(cfg)
    changed = {key: [old[key], new[key]] for key in new if old[key] != new[key]}
    await log_event(
        db, "warning" if "ops_enabled" in changed or "ops_bot_token" in changed else "info",
        "Ops Telegram bot config updated",
        request_id=current_request_id(),
        metadata={
            "event": "ops_telegram_config_changed",
            "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "ops_telegram_config", "subject_id": _CONFIG_ID,
            "changed": changed, "outcome": "success", "source": "admin",
        },
    )
    await db.commit()
    return await get_config(db)


async def send_test(db: AsyncSession) -> dict:
    """Send the test message to the ops group and the channel (when set).
    Result per target: ``ok`` · ``unreachable`` · ``not_set``."""
    cfg = await load_config(db)
    if cfg is None or not cfg.bot_token:
        raise api_error(ErrorCode.TELEGRAM_NOT_CONNECTED, status.HTTP_404_NOT_FOUND)
    token, username = cfg.bot_token, cfg.bot_username or ""
    targets = {"ops": cfg.ops_chat_id or "", "channel": cfg.channel_chat_id or ""}
    brand = (await load_runtime(db)).mail_from_name
    await db.commit()
    result: dict[str, str] = {}
    for target, chat in targets.items():
        if not chat:
            result[target] = "not_set"
            continue
        try:
            await client.send_message(token, chat_ref(chat), texts.test_message(brand, username, target))
            result[target] = "ok"
        except TelegramError as exc:
            if exc.kind == "unauthorized":
                raise _telegram_failure(exc) from None
            if exc.kind in {"rate_limited", "unavailable"}:
                raise api_error(ErrorCode.TELEGRAM_UNAVAILABLE, status.HTTP_503_SERVICE_UNAVAILABLE) from None
            result[target] = "unreachable"
    return result


# ── pause (dispatcher) ──────────────────────────────────────────────────────

_PAUSE_TEXT = {
    "token_rejected": "Telegram từ chối token của bot vận hành (token bị thu hồi hoặc bot bị xoá).",
    "ops_chat_unreachable": "Bot vận hành không gửi được vào nhóm vận hành (bị xoá khỏi nhóm hoặc sai chat id).",
    "channel_unreachable": "Bot vận hành không đăng được lên kênh (chưa là quản trị viên kênh hoặc sai tên kênh).",
}


async def pause(db: AsyncSession, cfg: OpsTelegramConfig, reason: str) -> None:
    """Stop collecting and sending until an admin resumes; tell admins through
    the alert inbox (a critical incident also mails them)."""
    now = _now()
    cfg.status, cfg.paused_reason, cfg.paused_at = "paused", reason, now
    await upsert_incident(
        db, fingerprint=PAUSED_FINGERPRINT, type_=PAUSED_ALERT_TYPE, severity="critical",
        target_type="platform", target_id=0, message=f"{_PAUSE_TEXT[reason]} Sửa trong Cài đặt › Bot vận hành rồi bấm Tiếp tục.",
        href=_SETTINGS_URL,
    )
    await log_event(db, "warning", "Ops Telegram bot paused", metadata={
        "event": "ops_telegram_paused", "actor_type": "system", "subject_type": "ops_telegram_config",
        "subject_id": _CONFIG_ID, "reason": reason, "outcome": "paused", "source": "scheduler",
    })
    logger.warning("ops_telegram_paused", reason=reason)


def masked_account(email: str | None, account_id: int | None) -> str:
    return " · ".join(p for p in (f"#{account_id}" if account_id else "", texts.mask_email(email)) if p)


async def account_emails(db: AsyncSession, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    return dict((await db.execute(select(Account.id, Account.email).where(Account.id.in_(ids)))).all())
