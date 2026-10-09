"""Scheduler tick for the ops bot: collect new events into the outbox, then
deliver due outbox rows to Telegram.

Stops entirely while the bot is switched off or paused (nothing collected,
nothing sent; switching it back on starts from that moment). It is not tied to
maintenance mode on purpose: maintenance is exactly when operators need the
group. Delivery is at-least-once per row:

- 429: nothing more this tick, the bot waits ``retry_after`` seconds.
- 401 (token revoked) / 403 or "chat not found" (bot removed from the group
  or not admin of the channel): the bot pauses and an admin alert is raised.
- Network / 5xx: the row is retried with exponential back-off, and marked
  ``failed`` after ``MAX_ATTEMPTS``.
- Any other 400: the message itself is refused; it is marked ``failed`` so it
  does not block the queue.
- More than ``SUMMARY_OVER`` due ops rows in one tick go out as one summary.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import delete, select

from src.database import SessionLocal
from src.mail.service import frontend_url
from src.models.ops_telegram import OpsTelegramOutbox
from src.seller_telegram import client
from src.seller_telegram.client import TelegramError

from . import texts
from .collect import collect
from .service import EVENT_KEYS, chat_ref, enabled_events, load_config, pause

logger = structlog.get_logger()

SEND_BATCH = 12
SUMMARY_OVER = 5
SUMMARY_LINES = 15
MAX_ATTEMPTS = 8
MAX_AGE = timedelta(hours=24)  # a message older than this is stale news
RETENTION = timedelta(days=30)
PURGE_EVERY = 3600.0  # seconds
_SEND_GAP_SECONDS = 1.5  # Telegram: about 20 messages a minute per group

_last_purge: float | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(30 * 2 ** max(attempts - 1, 0), 3600))


@dataclass
class _Send:
    ids: list[int]
    target: str
    html: str
    button: tuple[str, str] | None
    silent: bool


@dataclass
class _Outcome:
    sent: list[int] = field(default_factory=list)
    refused: dict[int, str] = field(default_factory=dict)
    retry: dict[int, str] = field(default_factory=dict)
    pause_reason: str | None = None
    retry_after: int | None = None
    moved: dict[str, str] = field(default_factory=dict)  # target -> new chat id


def _url(link: str | None) -> str | None:
    if not link:
        return None
    return link if link.startswith("https://") or link.startswith("http://") else frontend_url("vi", link)


def _batch(rows: list[OpsTelegramOutbox], quiet: bool) -> list[_Send]:
    """One message per row, or one summary for a burst of ops rows."""
    sends: list[_Send] = []
    ops = [row for row in rows if row.target == "ops"]
    if len(ops) > SUMMARY_OVER:
        lines = [f"• [{texts.LEVEL_TAG.get(r.level, 'THÔNG TIN')}] {texts.esc(r.title)}" for r in ops[:SUMMARY_LINES]]
        if len(ops) > SUMMARY_LINES:
            lines.append(texts.esc(f"… và {len(ops) - SUMMARY_LINES} sự kiện khác"))
        level = "urgent" if any(r.level == "urgent" for r in ops) else "action"
        html, button = texts.render("ops", level, f"{len(ops)} sự kiện vận hành mới", "\n".join(lines),
                                    _url("/admin/alerts"))
        sends.append(_Send([r.id for r in ops], "ops", html, button, quiet and all(r.low_priority for r in ops)))
        rows = [row for row in rows if row.target != "ops"]
    for row in rows:
        label = "Xem sản phẩm" if row.target == "channel" else "Mở trang quản trị"
        html, button = texts.render(row.target, row.level, row.title, row.body, _url(row.link), label)
        sends.append(_Send([row.id], row.target, html, button, quiet and row.low_priority))
    sends.sort(key=lambda s: min(s.ids))
    return sends


async def ops_telegram_dispatch_job() -> None:
    """Scheduler tick (30 s). An idle or switched-off bot costs one read."""
    now = _now()
    async with SessionLocal() as db:
        cfg = await load_config(db, lock=True)
        if cfg is None or not cfg.enabled or cfg.status != "active" or not cfg.bot_token:
            await db.commit()
            return
        await collect(db, cfg, now)
        await _purge_old(db, now)
        waiting = bool(cfg.retry_after_at and cfg.retry_after_at > now)
        await db.commit()
    if not waiting:
        await deliver()  # fresh clock: rows queued in this tick are due now


async def _purge_old(db, now: datetime) -> None:
    global _last_purge
    if _last_purge is not None and time.monotonic() - _last_purge < PURGE_EVERY:
        return
    _last_purge = time.monotonic()
    old = select(OpsTelegramOutbox.id).where(
        OpsTelegramOutbox.status != "pending", OpsTelegramOutbox.created_at < now - RETENTION,
    ).limit(5000)
    await db.execute(delete(OpsTelegramOutbox).where(OpsTelegramOutbox.id.in_(old)))


async def deliver(now: datetime | None = None) -> None:
    now = now or _now()
    async with SessionLocal() as db:
        cfg = await load_config(db)
        if cfg is None or not cfg.enabled or cfg.status != "active" or not cfg.bot_token:
            return
        token, quiet = cfg.bot_token, bool(cfg.quiet_low_priority)
        chats = {"ops": cfg.ops_chat_id or "", "channel": cfg.channel_chat_id if cfg.channel_enabled else ""}
        events = enabled_events(cfg)
        rows = list((await db.scalars(
            select(OpsTelegramOutbox)
            .where(OpsTelegramOutbox.status == "pending", OpsTelegramOutbox.next_attempt_at <= now)
            .order_by(OpsTelegramOutbox.id).limit(SEND_BATCH)
        )).all())
        due: list[OpsTelegramOutbox] = []
        for row in rows:
            reason = None
            if row.created_at and row.created_at < now - MAX_AGE:
                reason = "expired"
            elif not chats.get(row.target):
                reason = "target_off"
            elif row.kind in EVENT_KEYS and not events[row.kind]:
                reason = "event_off"
            if reason:
                row.status, row.last_error = "skipped", reason
            else:
                due.append(row)
        sends = _batch(due, quiet)
        attempts = {row.id: row.attempts for row in due}
        await db.commit()  # no transaction held while talking to Telegram
    if not sends:
        return
    outcome = await _send_all(token, chats, sends)
    await _persist(outcome, attempts, now)


async def _send_all(token: str, chats: dict[str, str], sends: list[_Send]) -> _Outcome:
    outcome = _Outcome()
    for index, item in enumerate(sends):
        if index:
            await asyncio.sleep(_SEND_GAP_SECONDS)
        chat = outcome.moved.get(item.target) or chats[item.target]
        try:
            try:
                await client.send_message(token, chat_ref(chat), item.html, item.button, silent=item.silent)
            except TelegramError as exc:
                if not exc.migrate_to_chat_id:
                    raise
                # A group became a supergroup and got a new id.
                outcome.moved[item.target] = str(exc.migrate_to_chat_id)
                await client.send_message(token, exc.migrate_to_chat_id, item.html, item.button, silent=item.silent)
            outcome.sent.extend(item.ids)
        except TelegramError as exc:
            if exc.kind == "unauthorized":
                outcome.pause_reason = "token_rejected"
                return outcome
            if exc.kind == "forbidden" or (exc.kind == "bad_request" and "chat not found" in exc.description.lower()):
                outcome.pause_reason = "channel_unreachable" if item.target == "channel" else "ops_chat_unreachable"
                return outcome
            if exc.kind == "rate_limited":
                outcome.retry_after = exc.retry_after or 30
                return outcome
            if exc.kind == "bad_request":
                logger.warning("ops_telegram_message_refused", description=exc.description, target=item.target)
                outcome.refused.update({row_id: exc.description[:200] for row_id in item.ids})
                continue
            # Network / 5xx: retry later, and stop hammering for this tick.
            outcome.retry.update({row_id: exc.description[:200] for row_id in item.ids})
            return outcome
    return outcome


async def _persist(outcome: _Outcome, attempts: dict[int, int], now: datetime) -> None:
    async with SessionLocal() as db:
        touched = set(outcome.sent) | set(outcome.refused) | set(outcome.retry)
        rows = {row.id: row for row in (await db.scalars(
            select(OpsTelegramOutbox).where(OpsTelegramOutbox.id.in_(touched))
        )).all()} if touched else {}
        for row_id in outcome.sent:
            if row_id in rows:
                rows[row_id].status, rows[row_id].sent_at, rows[row_id].last_error = "sent", now, None
                rows[row_id].attempts = attempts.get(row_id, 0) + 1
        for row_id, error in outcome.refused.items():
            if row_id in rows:
                rows[row_id].status, rows[row_id].last_error = "failed", error
                rows[row_id].attempts = attempts.get(row_id, 0) + 1
        for row_id, error in outcome.retry.items():
            row = rows.get(row_id)
            if row is None:
                continue
            row.attempts = attempts.get(row_id, 0) + 1
            row.last_error = error
            if row.attempts >= MAX_ATTEMPTS:
                row.status = "failed"
            else:
                row.next_attempt_at = now + backoff(row.attempts)
        if outcome.pause_reason or outcome.retry_after or outcome.moved:
            cfg = await load_config(db, lock=True)
            if cfg is not None and cfg.status == "active":
                if outcome.retry_after:
                    cfg.retry_after_at = now + timedelta(seconds=outcome.retry_after)
                if outcome.moved.get("ops"):
                    cfg.ops_chat_id = outcome.moved["ops"]
                if outcome.moved.get("channel"):
                    cfg.channel_chat_id = outcome.moved["channel"]
                if outcome.pause_reason:
                    await pause(db, cfg, outcome.pause_reason)
        await db.commit()
