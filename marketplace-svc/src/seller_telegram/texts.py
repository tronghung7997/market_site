"""What a seller reads in Telegram (vi/en), as Bot API HTML.

Messages carry public identifiers only — order codes, product/package names,
amounts, deadlines — never delivered goods or anything about the buyer.
"""
from __future__ import annotations

import html
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

from src.mail.templates import format_vnd

_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

LEVELS = {
    "urgent": {"vi": "KHẨN", "en": "URGENT"},
    "action": {"vi": "CẦN XỬ LÝ", "en": "ACTION NEEDED"},
    "info": {"vi": "THÔNG TIN", "en": "INFO"},
}

_T = {
    "order_new": {"vi": "Đơn mới cần giao", "en": "New order to deliver"},
    "order_sla": {"vi": "Đơn bị huỷ vì trễ hạn giao", "en": "Order cancelled: delivery deadline missed"},
    "dispute_opened": {"vi": "Khiếu nại mới", "en": "New dispute"},
    "dispute_buyer_message": {"vi": "Buyer trả lời khiếu nại", "en": "The buyer replied to a dispute"},
    "stock_low": {"vi": "Sắp hết hàng", "en": "Stock running low"},
    "resource_error": {"vi": "Tài nguyên trong kho bị báo lỗi", "en": "A stock item was reported broken"},
    "provider_out_of_credit": {"vi": "Nguồn hàng hết tiền", "en": "Supplier out of credit"},
    "withdrawal_approved": {"vi": "Yêu cầu rút tiền đã được duyệt", "en": "Withdrawal approved"},
    "withdrawal_paid": {"vi": "Đã chuyển tiền rút", "en": "Withdrawal paid out"},
    "withdrawal_rejected": {"vi": "Yêu cầu rút tiền bị từ chối", "en": "Withdrawal rejected"},
    "chat_digest": {"vi": "Tin nhắn mới từ buyer", "en": "New messages from buyers"},
    "summary": {"vi": "Thông báo mới của shop", "en": "New shop notifications"},
}

_LINE = {
    "deadline": {"vi": "Hạn phản hồi: {when}", "en": "Respond by: {when}"},
    "amount": {"vi": "Số tiền: {amount}", "en": "Amount: {amount}"},
    "reason": {"vi": "Lý do: {reason}", "en": "Reason: {reason}"},
    "provider_paused": {
        "vi": "{name} — đã tạm dừng bán. Nạp tiền cho nguồn hàng rồi bật lại.",
        "en": "{name} — sales paused. Top up the supplier account, then turn it back on.",
    },
    "chat_count": {
        "vi": "{messages} tin chưa đọc trong {threads} cuộc trò chuyện",
        "en": "{messages} unread messages in {threads} conversations",
    },
    "chat_customer": {"vi": "Khách hàng #{code}", "en": "Customer #{code}"},
    "chat_about": {"vi": "hỏi về {title}", "en": "about {title}"},
    "chat_images": {"vi": "[{count} ảnh]", "en": "[{count} image(s)]"},
    "chat_more": {
        "vi": "… và {count} tin nữa — mở trên sàn để đọc tiếp",
        "en": "… and {count} more — open GMMO to read on",
    },
    "more": {"vi": "… và {count} thông báo khác", "en": "… and {count} more"},
    "open_link": {"vi": "Mở: {url}", "en": "Open: {url}"},
}

BUTTON = {
    "order": {"vi": "Xem đơn", "en": "View order"},
    "dispute": {"vi": "Xem khiếu nại", "en": "View dispute"},
    "inventory": {"vi": "Mở kho hàng", "en": "Open inventory"},
    "providers": {"vi": "Mở nguồn hàng", "en": "Open suppliers"},
    "withdrawals": {"vi": "Xem rút tiền", "en": "View withdrawals"},
    "messages": {"vi": "Mở tin nhắn", "en": "Open messages"},
    "seller": {"vi": "Mở kênh người bán", "en": "Open seller console"},
    "settings": {"vi": "Cài đặt thông báo", "en": "Notification settings"},
}


def loc(locale: str | None) -> str:
    return "en" if locale == "en" else "vi"


def t(key: str, locale: str) -> str:
    return _T[key][loc(locale)]


def line(key: str, locale: str, **values) -> str:
    return _LINE[key][loc(locale)].format(**values)


def when(value: datetime, locale: str) -> str:
    local = value.astimezone(_TZ)
    return local.strftime("%H:%M %d/%m") + (" (GMT+7)" if loc(locale) == "en" else "")


def clock(value: datetime) -> str:
    return value.astimezone(_TZ).strftime("%H:%M")


def money(amount) -> str:
    return format_vnd(amount)


@dataclass
class Message:
    """One notification before it becomes Bot API HTML."""
    level: str
    title: str
    lines: list[str] = field(default_factory=list)
    button: str | None = None  # key into BUTTON
    path: str | None = None  # site path without locale, e.g. /seller/orders/ORD-…
    bold_lines: set[int] = field(default_factory=set)  # indexes into `lines` shown in bold


def render(message: Message, locale: str, url: str | None) -> tuple[str, tuple[str, str] | None]:
    """(html, inline button). Telegram refuses URL buttons that point at
    localhost or plain http, so such links go into the text instead."""
    level = LEVELS[message.level][loc(locale)]
    parts = [f"<b>[{level}] {html.escape(message.title)}</b>"]
    parts.extend(
        f"<b>{html.escape(text)}</b>" if index in message.bold_lines else html.escape(text)
        for index, text in enumerate(message.lines) if text
    )
    button = None
    if url:
        if url.startswith("https://") and "localhost" not in url and "127.0.0.1" not in url:
            button = (BUTTON[message.button or "seller"][loc(locale)], url)
        else:
            parts.append(html.escape(line("open_link", locale, url=url)))
    return "\n".join(parts), button


def summary(messages: list[Message], locale: str, limit: int) -> Message:
    """Many events in one tick become one message instead of a burst."""
    shown = messages[:limit]
    lines = [f"• {m.title}" + (f" — {m.lines[0]}" if m.lines else "") for m in shown]
    if len(messages) > limit:
        lines.append(line("more", locale, count=len(messages) - limit))
    level = "urgent" if any(m.level == "urgent" for m in messages) else "action"
    return Message(level=level, title=t("summary", locale), lines=lines, button="seller", path="/seller")


def test_message(brand: str, bot_username: str, locale: str) -> str:
    if loc(locale) == "en":
        return (
            f"<b>{html.escape(brand)} · Connected</b>\n"
            f"Your shop's notifications will arrive here via @{html.escape(bot_username)}: "
            "new orders, late orders, disputes, low stock, supplier problems and withdrawals, "
            "plus a round-up of buyer messages."
        )
    return (
        f"<b>{html.escape(brand)} · Kết nối thành công</b>\n"
        f"Thông báo của shop sẽ về đây qua @{html.escape(bot_username)}: đơn mới, đơn trễ hạn, "
        "khiếu nại, sắp hết hàng, lỗi nguồn hàng, rút tiền và tin nhắn buyer (gộp)."
    )
