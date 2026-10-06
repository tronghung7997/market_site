"""Deliver a seller's notifications to their Telegram chats.

Source of truth is what the marketplace already records for the seller:
``notifications`` rows (new order, dispute, withdrawal, buyer chat) and
``alerts`` rows (late order, low stock, broken stock, a supplier out of
credit). Both are written inside the transaction that caused them, so a
rolled-back change is never announced. Each bot keeps an id cursor per table.

Ids are allocated before commit, so a row can become visible after a higher
id was already sent. A cursor therefore only passes rows older than
``SETTLE``; rows above it that were already sent are remembered in
``recent_sent`` so they are not sent twice. A transaction longer than
``SETTLE`` could still be skipped — accepted, the bell keeps the full record.

Delivery is at-least-once: a message that reached one chat before another
chat failed transiently is sent again on the next tick.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import and_, exists, func, literal_column, not_, or_, select
from sqlalchemy.dialects.postgresql import JSONB

from src.database import SessionLocal
from src.mail.service import enqueue_mail, frontend_url
from src.chat.enums import ConversationKind
from src.models.account import Account
from src.models.alert import Alert
from src.models.chat import ChatConversation, ChatMessage, ChatParticipant
from src.models.notification import Notification
from src.models.order import Dispute, DisputeStatus, Order
from src.models.product import Product, ProductVariant
from src.models.provider import Provider
from src.models.seller_telegram import SellerTelegramBot, SellerTelegramChat
from src.notifications.history import notify

from . import client, texts
from .client import TelegramError
from .service import enabled_events
from .texts import Message

logger = structlog.get_logger()

SETTLE = timedelta(minutes=5)
BATCH = 100
# More than this many events in one tick go out as one summary message.
SUMMARY_OVER = 4
SUMMARY_LINES = 10
CHAT_DIGEST_EVERY = timedelta(minutes=10)
# Telegram caps one message at 4096 characters.
CHAT_TEXT_BUDGET = 3300
CHAT_MESSAGE_MAX = 600
CHAT_FETCH = 200
PAUSE_AFTER = 3
_SEND_GAP_SECONDS = 1.0  # Telegram: about one message per second per chat
# Every bot gets a full pass this often even when the work probe finds nothing:
# it moves the alert cursor past other sellers' alerts (keeps the probe's range
# scan short) and is the safety net for the probe itself.
FULL_PASS_EVERY = 600.0  # seconds

_SELLER_ALERTS = {"sla_breach": "order_sla", "resource_low": "stock_low", "resource_error": "supply_error"}
_PROVIDER_ALERT = "provider_out_of_credit"
# Notification kinds notification_event() can send (the probe's prefilter).
_NOTIFICATION_KINDS = ("order_new", "dispute_opened", "dispute_buyer_message",
                       "withdrawal_approved", "withdrawal_paid", "withdrawal_rejected")
_CHAT_KINDS = (ConversationKind.PRODUCT_INQUIRY.value, ConversationKind.ORDER.value)

_last_full_pass: float | None = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def notification_event(kind: str, params: dict) -> str | None:
    """Which Telegram switch a seller notification belongs to (None = never sent)."""
    if kind == "order_new":
        # An instant order was delivered from stock: nothing to hand over.
        return None if params.get("auto") else "order_pending"
    if kind in {"dispute_opened", "dispute_buyer_message"}:
        return "dispute"
    if kind in {"withdrawal_approved", "withdrawal_paid", "withdrawal_rejected"}:
        return "withdrawal"
    return None


@dataclass
class _Item:
    source: str  # "n" notification · "a" alert
    id: int
    message: Message


@dataclass
class _Outgoing:
    keys: list[tuple[str, int]]
    message: Message
    digest_until: datetime | None = None


@dataclass
class _Outcome:
    sent: set[tuple[str, int]] = field(default_factory=set)
    digest_until: datetime | None = None
    delivered_any: bool = False
    unauthorized: bool = False
    retry_after: int | None = None
    chat_ok: set[int] = field(default_factory=set)
    chat_failed: dict[int, int] = field(default_factory=dict)
    chat_moved: dict[int, int] = field(default_factory=dict)


def _full_pass_due() -> bool:
    return _last_full_pass is None or time.monotonic() - _last_full_pass >= FULL_PASS_EVERY


def _has_work(now: datetime):
    """SQL condition: this bot may have something for ``deliver`` to do.

    It may say yes when ``deliver`` then finds nothing, never no when it
    would send or move a cursor: a notification above the cursor that is
    settled (the cursor can pass it) or of a sendable kind and not sent yet;
    the same for the seller's alerts; and, once a round-up is due, buyer chat
    the seller has not read that is newer than the watermark.
    """
    bot = SellerTelegramBot
    settled = now - SETTLE

    def not_sent(key: str, row_id):
        sent = func.coalesce(bot.recent_sent[key], literal_column("'[]'::jsonb", JSONB))
        return not_(sent.contains(func.to_jsonb(row_id)))

    note = exists().where(
        Notification.account_id == bot.seller_id,
        Notification.id > bot.last_notification_id,
        or_(
            Notification.created_at < settled,
            and_(
                Notification.kind.in_(_NOTIFICATION_KINDS),
                func.coalesce(Notification.params["auto"].astext, "") != "true",
                not_sent("n", Notification.id),
            ),
        ),
    )
    alert = exists().where(
        Alert.id > bot.last_alert_id,
        or_(
            and_(Alert.target_type == "seller", Alert.target_id == bot.seller_id,
                 Alert.type.in_(list(_SELLER_ALERTS))),
            and_(Alert.target_type == "provider", Alert.type == _PROVIDER_ALERT,
                 Alert.target_id.in_(
                     select(Provider.id).where(Provider.seller_id == bot.seller_id).correlate(bot).scalar_subquery()
                 )),
        ),
        or_(Alert.created_at < settled, not_sent("a", Alert.id)),
    )
    chat = exists().where(
        ChatConversation.seller_id == bot.seller_id,
        ChatConversation.kind.in_(_CHAT_KINDS),
        ChatParticipant.conversation_id == ChatConversation.id,
        ChatParticipant.account_id == bot.seller_id,
        ChatMessage.conversation_id == ChatConversation.id,
        ChatMessage.sender_id == ChatConversation.buyer_id,
        ChatMessage.created_at > func.coalesce(bot.chat_watermark_at, now),
        ChatMessage.id > func.coalesce(ChatParticipant.last_read_message_id, 0),
    )
    digest_due = or_(bot.chat_digest_sent_at.is_(None), bot.chat_digest_sent_at <= now - CHAT_DIGEST_EVERY)
    return or_(note, alert, and_(digest_due, chat))


async def telegram_dispatch_job() -> None:
    """Scheduler tick. One query picks the bots that have work; an idle tick
    costs that query only. Every ``FULL_PASS_EVERY`` all ready bots get a pass."""
    global _last_full_pass
    now = _now()
    full = _full_pass_due()
    active_chat = exists().where(
        SellerTelegramChat.bot_row_id == SellerTelegramBot.id, SellerTelegramChat.status == "active",
    )
    ready = [
        SellerTelegramBot.status == "active",
        or_(SellerTelegramBot.retry_after_at.is_(None), SellerTelegramBot.retry_after_at <= now),
        active_chat,
    ]
    if not full:
        ready.append(_has_work(now))
    async with SessionLocal() as db:
        bot_ids = list((await db.scalars(
            select(SellerTelegramBot.id).where(*ready).order_by(SellerTelegramBot.id)
        )).all())
    if full:
        _last_full_pass = time.monotonic()
    for bot_row_id in bot_ids:
        try:
            await deliver(bot_row_id)
        except Exception:  # one seller's failure must not stop the others
            logger.exception("telegram_dispatch_failed", bot_row_id=bot_row_id)


async def _order_lines(codes: set[str], seller_id: int, db) -> dict[str, dict]:
    if not codes:
        return {}
    rows = (await db.execute(
        select(Order.id, Order.order_code, Order.quantity, Order.total_amount, Product.title, ProductVariant.name)
        .outerjoin(Product, Product.id == Order.product_id)
        .outerjoin(ProductVariant, ProductVariant.id == Order.variant_id)
        .where(Order.order_code.in_(codes), Order.seller_id == seller_id)
    )).all()
    info = {
        code: {"id": oid, "summary": " · ".join(p for p in (
            code, " · ".join(x for x in (title, name) if x) + (f" ×{qty}" if qty else ""), texts.money(total),
        ) if p)}
        for oid, code, qty, total, title, name in rows
    }
    deadlines = (await db.execute(
        select(Dispute.order_id, func.max(Dispute.seller_deadline_at))
        .where(Dispute.order_id.in_([v["id"] for v in info.values()]), Dispute.status == DisputeStatus.open)
        .group_by(Dispute.order_id)
    )).all()
    by_id = dict(deadlines)
    for value in info.values():
        value["deadline"] = by_id.get(value["id"])
    return info


def _notification_message(kind: str, params: dict, href: str | None, orders: dict, locale: str) -> Message:
    code = str(params.get("order_code") or "")
    order = orders.get(code, {})
    order_line = order.get("summary") or code
    if kind == "order_new":
        return Message("action", texts.t("order_new", locale), [order_line], "order", href)
    if kind == "dispute_opened":
        lines = [order_line]
        if order.get("deadline"):
            lines.append(texts.line("deadline", locale, when=texts.when(order["deadline"], locale)))
        return Message("urgent", texts.t("dispute_opened", locale), lines, "dispute", href)
    if kind == "dispute_buyer_message":
        return Message("action", texts.t("dispute_buyer_message", locale), [order_line], "dispute", href)
    lines = [texts.line("amount", locale, amount=texts.money(params.get("amount") or 0))]
    if kind == "withdrawal_rejected" and params.get("reason"):
        lines.append(texts.line("reason", locale, reason=str(params["reason"])[:300]))
    return Message("info", texts.t(kind, locale), lines, "withdrawals", href or "/seller/withdrawals")


def _alert_message(alert: Alert, provider_names: dict[int, str], locale: str) -> Message:
    if alert.type == _PROVIDER_ALERT:
        name = provider_names.get(alert.target_id, "")
        return Message("urgent", texts.t("provider_out_of_credit", locale),
                       [texts.line("provider_paused", locale, name=name)], "providers", "/seller/providers")
    if alert.type == "sla_breach":
        return Message("urgent", texts.t("order_sla", locale), [alert.message], "order", alert.href or "/seller/orders")
    if alert.type == "resource_low":
        return Message("action", texts.t("stock_low", locale), [alert.message], "inventory",
                       alert.href or "/seller/inventory")
    return Message("action", texts.t("resource_error", locale), [alert.message], "inventory",
                   alert.href or "/seller/inventory")


async def _chat_digest(seller_id: int, since: datetime, locale: str, db) -> _Outgoing | None:
    """Every buyer message the seller has not read yet, newer than ``since``,
    quoted in full (up to Telegram's size) and grouped by conversation."""
    rows = (await db.execute(
        select(ChatMessage.body, ChatMessage.attachments, ChatMessage.created_at, ChatConversation.id,
               ChatConversation.order_id, ChatConversation.product_id, Account.public_key)
        .join(ChatConversation, ChatConversation.id == ChatMessage.conversation_id)
        .join(ChatParticipant, and_(ChatParticipant.conversation_id == ChatConversation.id,
                                    ChatParticipant.account_id == seller_id))
        .join(Account, Account.id == ChatMessage.sender_id)
        .where(
            ChatConversation.seller_id == seller_id,
            ChatConversation.kind.in_([ConversationKind.PRODUCT_INQUIRY.value, ConversationKind.ORDER.value]),
            ChatMessage.sender_id == ChatConversation.buyer_id,
            ChatMessage.created_at > since,
            ChatMessage.id > func.coalesce(ChatParticipant.last_read_message_id, 0),
        )
        .order_by(ChatMessage.id).limit(CHAT_FETCH)
    )).all()
    if not rows:
        return None
    order_ids = {row.order_id for row in rows if row.order_id}
    product_ids = {row.product_id for row in rows if row.product_id}
    codes = dict((await db.execute(select(Order.id, Order.order_code).where(Order.id.in_(order_ids)))).all()) \
        if order_ids else {}
    titles = dict((await db.execute(select(Product.id, Product.title).where(Product.id.in_(product_ids)))).all()) \
        if product_ids else {}

    threads: dict = {}
    for row in rows:
        threads.setdefault(row.id, []).append(row)
    lines = [texts.line("chat_count", locale, messages=len(rows), threads=len(threads))]
    bold: set[int] = set()
    used, shown = len(lines[0]), 0
    for conversation_rows in threads.values():
        first = conversation_rows[0]
        context = codes.get(first.order_id) or (
            texts.line("chat_about", locale, title=titles[first.product_id]) if first.product_id in titles else ""
        )
        header = " · ".join(p for p in (texts.line("chat_customer", locale, code=first.public_key), context) if p)
        if used + len(header) > CHAT_TEXT_BUDGET and shown:
            break
        lines.append("")
        lines.append(header)
        bold.add(len(lines) - 1)
        used += len(header) + 2
        for row in conversation_rows:
            body = (row.body or "").strip()
            if len(body) > CHAT_MESSAGE_MAX:
                body = body[:CHAT_MESSAGE_MAX].rstrip() + "…"
            if row.attachments:
                body = " ".join(p for p in (body, texts.line("chat_images", locale, count=len(row.attachments))) if p)
            text = f"› {body} ({texts.clock(row.created_at)})"
            if used + len(text) > CHAT_TEXT_BUDGET and shown:
                break
            lines.append(text)
            used += len(text) + 1
            shown += 1
        else:
            continue
        break
    if shown < len(rows):
        lines.append("")
        lines.append(texts.line("chat_more", locale, count=len(rows) - shown))
    path = f"/messages/{first.id}" if len(threads) == 1 else "/messages"
    return _Outgoing([], Message("info", texts.t("chat_digest", locale), lines, "messages", path, bold_lines=bold),
                     digest_until=max(row.created_at for row in rows))


def _advance(cursor: int, floor: int, rows: list[tuple[int, bool]], sent: set[int], full: bool) -> int:
    """New cursor: past every settled row (id ≤ floor) unless a row that
    should be sent has not been; never past the rows not examined yet."""
    unsent = [row_id for row_id, relevant in rows if relevant and row_id not in sent]
    target = floor if not unsent else min(floor, min(unsent) - 1)
    if full and rows:
        target = min(target, rows[-1][0])
    return max(cursor, target)


async def deliver(bot_row_id: int) -> None:
    now = _now()
    settled = now - SETTLE
    async with SessionLocal() as db:
        # Bot, the seller's locale and the active chats in one round trip.
        head = (await db.execute(
            select(SellerTelegramBot, Account.preferred_locale, SellerTelegramChat.id, SellerTelegramChat.chat_id)
            .outerjoin(Account, Account.id == SellerTelegramBot.seller_id)
            .outerjoin(SellerTelegramChat, and_(SellerTelegramChat.bot_row_id == SellerTelegramBot.id,
                                                SellerTelegramChat.status == "active"))
            .where(SellerTelegramBot.id == bot_row_id)
            .order_by(SellerTelegramChat.id)
        )).all()
        if not head:
            return
        bot = head[0][0]
        if bot.status != "active":
            return
        chats = {chat_row_id: chat_id for _, _, chat_row_id, chat_id in head if chat_row_id is not None}
        if not chats:
            return
        seller_id, token, bot_id = bot.seller_id, bot.token, bot.bot_id
        events = enabled_events(bot)
        locale = texts.loc(head[0][1])
        recent = bot.recent_sent or {}
        sent_n, sent_a = set(recent.get("n", [])), set(recent.get("a", []))
        cursor_n, cursor_a = bot.last_notification_id, bot.last_alert_id

        notes = (await db.execute(
            select(Notification.id, Notification.kind, Notification.params, Notification.href)
            .where(Notification.account_id == seller_id, Notification.id > cursor_n)
            .order_by(Notification.id).limit(BATCH)
        )).all()
        note_rows: list[tuple[int, bool]] = []
        wanted_notes = []
        for row_id, kind, params, href in notes:
            event = notification_event(kind, params or {})
            relevant = bool(event and events[event])
            note_rows.append((row_id, relevant))
            if relevant and row_id not in sent_n:
                wanted_notes.append((row_id, kind, params or {}, href))
        floor_n = int(await db.scalar(select(func.coalesce(func.max(Notification.id), 0)).where(
            Notification.account_id == seller_id, Notification.created_at < settled,
        )) or 0)

        alert_scope = [
            and_(Alert.target_type == "seller", Alert.target_id == seller_id, Alert.type.in_(list(_SELLER_ALERTS))),
            and_(Alert.target_type == "provider", Alert.type == _PROVIDER_ALERT,
                 Alert.target_id.in_(select(Provider.id).where(Provider.seller_id == seller_id))),
        ]
        alerts = list((await db.scalars(
            select(Alert).where(Alert.id > cursor_a, or_(*alert_scope)).order_by(Alert.id).limit(BATCH)
        )).all())
        alert_rows: list[tuple[int, bool]] = []
        wanted_alerts = []
        for alert in alerts:
            event = _SELLER_ALERTS.get(alert.type, "supply_error")
            relevant = events[event]
            alert_rows.append((alert.id, relevant))
            if relevant and alert.id not in sent_a:
                wanted_alerts.append(alert)
        floor_a = int(await db.scalar(
            select(func.coalesce(func.max(Alert.id), 0)).where(Alert.created_at < settled)
        ) or 0)

        orders = await _order_lines({str(p.get("order_code")) for _, _, p, _ in wanted_notes if p.get("order_code")},
                                    seller_id, db)
        provider_names = dict((await db.execute(
            select(Provider.id, Provider.name).where(Provider.id.in_({a.target_id for a in wanted_alerts
                                                                         if a.type == _PROVIDER_ALERT}))
        )).all()) if any(a.type == _PROVIDER_ALERT for a in wanted_alerts) else {}
        items = [_Item("n", row_id, _notification_message(kind, params, href, orders, locale))
                 for row_id, kind, params, href in wanted_notes]
        items += [_Item("a", alert.id, _alert_message(alert, provider_names, locale)) for alert in wanted_alerts]

        digest: _Outgoing | None = None
        due = bot.chat_digest_sent_at is None or now - bot.chat_digest_sent_at >= CHAT_DIGEST_EVERY
        if events["chat_messages"] and due:
            digest = await _chat_digest(seller_id, bot.chat_watermark_at or now, locale, db)
        await db.commit()

    outgoing: list[_Outgoing] = []
    if len(items) > SUMMARY_OVER:
        outgoing.append(_Outgoing([(i.source, i.id) for i in items],
                                  texts.summary([i.message for i in items], locale, SUMMARY_LINES)))
    else:
        outgoing += [_Outgoing([(i.source, i.id)], i.message) for i in items]
    if digest:
        outgoing.append(digest)
    outcome = await _send_all(token, chats, outgoing, locale) if outgoing else _Outcome()

    for source, row_id in outcome.sent:
        (sent_n if source == "n" else sent_a).add(row_id)
    new_cursor_n = _advance(cursor_n, floor_n, note_rows, sent_n, len(notes) == BATCH)
    new_cursor_a = _advance(cursor_a, floor_a, alert_rows, sent_a, len(alerts) == BATCH)
    new_recent = {"n": sorted(i for i in sent_n if i > new_cursor_n),
                  "a": sorted(i for i in sent_a if i > new_cursor_a)}
    if (not outgoing and events["chat_messages"] and (new_cursor_n, new_cursor_a) == (cursor_n, cursor_a)
            and new_recent == {"n": sorted(recent.get("n", [])), "a": sorted(recent.get("a", []))}):
        return  # nothing sent, nothing moved: no write
    await _persist(
        bot_row_id, bot_id, outcome, now=now,
        cursors=(new_cursor_n, new_cursor_a),
        recent=new_recent,
        chat_messages_on=events["chat_messages"],
    )


async def _send_all(token: str, chats: dict[int, int], outgoing: list[_Outgoing], locale: str) -> _Outcome:
    outcome = _Outcome()
    live = dict(chats)
    for index, item in enumerate(outgoing):
        if index:
            await asyncio.sleep(_SEND_GAP_SECONDS)
        url = frontend_url(locale, item.message.path) if item.message.path else None
        html_text, button = texts.render(item.message, locale, url)
        done = True
        for row_id, chat_id in list(live.items()):
            try:
                try:
                    await client.send_message(token, chat_id, html_text, button)
                except TelegramError as exc:
                    if not exc.migrate_to_chat_id:
                        raise
                    # A group became a supergroup and got a new id.
                    live[row_id] = outcome.chat_moved[row_id] = exc.migrate_to_chat_id
                    await client.send_message(token, exc.migrate_to_chat_id, html_text, button)
                outcome.chat_ok.add(row_id)
                outcome.delivered_any = True
            except TelegramError as exc:
                if exc.kind == "unauthorized":
                    outcome.unauthorized = True
                    return outcome
                if exc.kind == "rate_limited":
                    outcome.retry_after = exc.retry_after or 30
                    return outcome
                if exc.kind == "forbidden" or (exc.kind == "bad_request" and "chat not found" in exc.description.lower()):
                    outcome.chat_failed[row_id] = outcome.chat_failed.get(row_id, 0) + 1
                    live.pop(row_id, None)
                elif exc.kind == "bad_request":
                    # The message itself is refused; retrying would block the queue.
                    logger.warning("telegram_message_refused", description=exc.description)
                else:
                    done = False
                    break
        if not done:
            break
        outcome.sent.update(item.keys)
        if item.digest_until:
            outcome.digest_until = item.digest_until
    return outcome


async def _persist(
    bot_row_id: int, bot_id: int, outcome: _Outcome, *, now: datetime,
    cursors: tuple[int, int], recent: dict, chat_messages_on: bool,
) -> None:
    async with SessionLocal() as db:
        bot = await db.scalar(select(SellerTelegramBot).where(SellerTelegramBot.id == bot_row_id).with_for_update())
        if bot is None or bot.bot_id != bot_id or bot.status != "active":
            return  # disconnected, replaced or paused while we were sending
        bot.last_notification_id = max(bot.last_notification_id, cursors[0])
        bot.last_alert_id = max(bot.last_alert_id, cursors[1])
        bot.recent_sent = recent
        if outcome.digest_until:
            bot.chat_watermark_at = outcome.digest_until
            bot.chat_digest_sent_at = now
        elif not chat_messages_on:
            bot.chat_watermark_at = now
        if outcome.retry_after:
            bot.retry_after_at = now + timedelta(seconds=outcome.retry_after)
        if outcome.delivered_any:
            bot.fail_count = 0
        if outcome.unauthorized:
            bot.fail_count += 1

        chats = {chat.id: chat for chat in (await db.scalars(
            select(SellerTelegramChat).where(SellerTelegramChat.bot_row_id == bot.id)
        )).all()}
        for row_id, new_chat_id in outcome.chat_moved.items():
            if row_id in chats:
                chats[row_id].chat_id = new_chat_id
        for row_id in outcome.chat_ok:
            if row_id in chats:
                chats[row_id].fail_count = 0
        for row_id, failures in outcome.chat_failed.items():
            chat = chats.get(row_id)
            if chat is None:
                continue
            chat.fail_count += failures
            if chat.fail_count >= PAUSE_AFTER:
                chat.status = "broken"

        reason = None
        if bot.fail_count >= PAUSE_AFTER:
            reason = "token_rejected"
        elif not any(chat.status == "active" for chat in chats.values()):
            reason = "no_chats"
        if reason:
            await _pause(bot, reason, now, db)
        await db.commit()


_PAUSE_REASON = {
    "token_rejected": {
        "vi": "Telegram từ chối token của bot (token đã bị thu hồi hoặc bot đã bị xoá).",
        "en": "Telegram rejected the bot token (it was revoked or the bot was deleted).",
    },
    "no_chats": {
        "vi": "Bot không gửi được vào chat nào (bị chặn hoặc bị xoá khỏi nhóm).",
        "en": "The bot cannot write to any chat (it was blocked or removed from the group).",
    },
}


async def _pause(bot: SellerTelegramBot, reason: str, now: datetime, db) -> None:
    bot.status, bot.paused_reason, bot.paused_at = "paused", reason, now
    locale = texts.loc(await db.scalar(select(Account.preferred_locale).where(Account.id == bot.seller_id)))
    await notify(db, bot.seller_id, "telegram_paused", category="system", params={"reason": reason},
                 href="/seller/telegram")
    await enqueue_mail(
        db, template="telegram_paused", account_id=bot.seller_id, locale=locale,
        idempotency_key=f"telegram-paused:{bot.id}:{int(now.timestamp())}",
        payload={"reason": _PAUSE_REASON[reason][locale], "action_url": frontend_url(locale, "/seller/telegram")},
    )
    logger.warning("telegram_bot_paused", bot_row_id=bot.id, seller_id=bot.seller_id, reason=reason)
