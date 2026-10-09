"""What operators (and channel readers) read in Telegram, as Bot API HTML.

Vietnamese only: the ops group is internal and the channel is the
marketplace's Vietnamese audience. Every value that comes from a row is
escaped here (``esc``); outbox bodies are stored already escaped.
"""
from __future__ import annotations

import html
from datetime import datetime
from zoneinfo import ZoneInfo

from src.mail.templates import format_vnd

_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
# Telegram caps one message at 4096 characters (after entity parsing).
MAX_MESSAGE = 4000
BODY_LINE_MAX = 600

LEVEL_TAG = {"urgent": "KHẨN", "action": "CẦN XỬ LÝ", "info": "THÔNG TIN"}

# Readable names for the alert types an operator may get.
ALERT_TYPE_LABEL = {
    "config_change_pending": "Cấu hình chờ admin khác duyệt",
    "provider_down": "Nguồn hàng ngừng phản hồi",
    "provider_out_of_credit": "Nguồn hàng hết tiền",
    "provider_low_credit": "Nguồn hàng sắp hết tiền",
    "supplier_sync_failed": "Đồng bộ nguồn cung bị lỗi",
    "supplier_auto_paused": "Nguồn cung tự tạm dừng (ngắt mạch)",
    "supplier_reported_empty": "Nguồn cung báo hết hàng",
    "supplier_sku_delisted": "Nguồn cung gỡ mã hàng",
    "supplier_low_margin": "Biên lợi nhuận nguồn cung thấp",
    "ledger_mismatch": "Lệch sổ cái",
    "escrow_release_failed": "Giải ngân tiền giữ bị lỗi",
    "sla_refund_failed": "Hoàn tiền đơn trễ hạn bị lỗi",
    "provision_stuck": "Đơn kẹt khi cấp hàng",
    "provision_operational": "Cấp hàng gặp sự cố",
    "upstream_revoke_failed": "Thu hồi phía nhà cung cấp bị lỗi",
    "task_webhook_timeout": "Webhook tác vụ quá hạn",
    "dproxy_auth_error": "DProxy từ chối xác thực",
    "dproxy_contract_error": "DProxy trả dữ liệu sai hợp đồng",
    "dproxy_unavailable": "DProxy không phản hồi",
    "dproxy_duplicate_external_id": "DProxy trùng mã cấp phát",
    "dproxy_allocation_disappeared": "DProxy mất proxy đã cấp",
    "deposit_anomaly": "Nạp tiền bất thường",
}

SWITCH_LABEL = {
    "maintenance_enabled": "Chế độ bảo trì",
    "withdrawals_frozen": "Khoá rút tiền",
    "deposits_frozen": "Khoá nạp tiền",
    "orders_frozen": "Khoá đặt hàng",
}


def esc(value) -> str:
    return html.escape(str(value if value is not None else ""), quote=False)


def clip(value: str, limit: int = BODY_LINE_MAX) -> str:
    value = " ".join(str(value or "").split())
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def money(amount) -> str:
    return format_vnd(int(amount or 0))


def when(value: datetime | None) -> str:
    return value.astimezone(_TZ).strftime("%H:%M %d/%m") if value else ""


def mask_tail(value: str | None, keep: int = 4) -> str:
    """Bank account / token: only the last ``keep`` characters."""
    raw = "".join(str(value or "").split())
    if not raw:
        return ""
    return f"••••{raw[-keep:]}" if len(raw) > keep else "••••"


def mask_email(email: str | None) -> str:
    local, _, domain = str(email or "").partition("@")
    if not domain:
        return mask_tail(local, 2)
    return f"{local[:2]}•••@{domain}"


def body(*lines: str) -> str:
    """Escaped, clipped, non-empty lines joined for an outbox body."""
    return "\n".join(esc(clip(line)) for line in lines if line)


def _usable_button(url: str | None) -> bool:
    # Telegram refuses URL buttons on localhost or plain http.
    return bool(url) and url.startswith("https://") and "localhost" not in url and "127.0.0.1" not in url


def render(target: str, level: str, title: str, body_html: str, url: str | None,
           button_label: str = "Mở trên sàn") -> tuple[str, tuple[str, str] | None]:
    """(html, inline button) for one outbox row."""
    head = f"<b>{esc(title)}</b>" if target == "channel" else f"<b>[{LEVEL_TAG.get(level, 'THÔNG TIN')}] {esc(title)}</b>"
    parts = [head]
    if body_html:
        parts.append(body_html)
    button = None
    if url:
        if _usable_button(url):
            button = (button_label, url)
        else:
            parts.append(f"Mở: {esc(url)}")
    text = "\n".join(parts)
    if len(text) > MAX_MESSAGE:
        # Bodies are built line by line, so cutting at a line break never
        # splits a tag.
        cut = text.rfind("\n", 0, MAX_MESSAGE - 2)
        text = text[: cut if cut > 0 else MAX_MESSAGE - 2] + "\n…"
    return text, button


def test_message(brand: str, bot_username: str, target: str) -> str:
    where = "kênh công khai" if target == "channel" else "nhóm vận hành"
    return (
        f"<b>{esc(brand)} · Bot vận hành đã kết nối</b>\n"
        f"Tin thử gửi tới {where} qua @{esc(bot_username)}. "
        + ("Sản phẩm mới lên sàn sẽ được đăng ở đây." if target == "channel"
           else "Rút tiền, khiếu nại, nạp tiền chưa khớp, bảo trì/khoá và cảnh báo hệ thống sẽ về đây.")
    )
