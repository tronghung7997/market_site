"""Transactional mail catalog (vi/en). User-provided strings are escaped in HTML."""

from __future__ import annotations

import html
import re
from typing import Any

KNOWN_TEMPLATES = frozenset({
    "email_verify",
    "email_change_confirm",
    "email_change_notice",
    "password_reset",
    "password_changed",
    "seller_application_approved",
    "seller_application_rejected",
    "provider_approved",
    "provider_rejected",
    "withdrawal_approved",
    "withdrawal_rejected",
    "dispute_opened",
    "dispute_resolved",
    "admin_test",
})

PLACEHOLDERS: dict[str, tuple[str, ...]] = {
    "email_verify": ("action_url",),
    "email_change_confirm": ("action_url",),
    "email_change_notice": ("new_email", "action_url"),
    "password_reset": ("action_url",),
    "password_changed": ("action_url",),
    "seller_application_approved": ("action_url",),
    "seller_application_rejected": ("reason", "action_url"),
    "provider_approved": ("provider_name", "action_url"),
    "provider_rejected": ("provider_name", "reason", "action_url"),
    "withdrawal_approved": ("amount", "action_url"),
    "withdrawal_rejected": ("amount", "reason", "action_url"),
    "dispute_opened": ("order_id", "reason", "deadline", "action_url"),
    "dispute_resolved": ("order_id", "outcome", "admin_note", "action_url"),
    "admin_test": ("action_url",),
}

_CONTEXT_KEYS = (
    "action_url",
    "new_email",
    "reason",
    "order_id",
    "amount",
    "outcome",
    "admin_note",
    "provider_name",
)

_PLACEHOLDER_RE = re.compile(r"\{([a-z_]+)\}")

_OUTCOMES = {
    "refund": {"vi": "Hoàn toàn bộ tiền", "en": "Full refund"},
    "reject": {"vi": "Từ chối khiếu nại", "en": "Dispute rejected"},
    "partial_refund": {"vi": "Hoàn một phần", "en": "Partial refund"},
    "replace": {"vi": "Đổi hàng", "en": "Replacement issued"},
    "extend_warranty": {"vi": "Gia hạn bảo hành", "en": "Warranty extended"},
    "timeout": {"vi": "Tự hoàn tất vì buyer không phản hồi", "en": "Completed after buyer timeout"},
    "withdrawn": {"vi": "Buyer đã rút khiếu nại", "en": "Withdrawn by buyer"},
    "abandoned": {"vi": "Tự hoàn tất vì không ai thao tác sau hạn ký quỹ", "en": "Completed after the case was abandoned"},
}

# Default subject/body. `{name}` is replaced from the safe context at send time.
DEFAULT_TEMPLATES: dict[str, dict[str, dict[str, str]]] = {
    "email_verify": {
        "en": {
            "subject": "Confirm your GMMO email address",
            "body": (
                "Welcome to GMMO. Confirm this email address to unlock buying, "
                "deposits and withdrawals.\n\n"
                "The link is valid for 24 hours.\n\nConfirm email:\n{action_url}\n\n"
                "If you did not create this account, ignore this email."
            ),
        },
        "vi": {
            "subject": "Xác nhận email tài khoản GMMO",
            "body": (
                "Chào mừng bạn đến với GMMO. Xác nhận địa chỉ email này để mua hàng, "
                "nạp và rút tiền.\n\n"
                "Liên kết có hiệu lực trong 24 giờ.\n\nXác nhận email:\n{action_url}\n\n"
                "Nếu bạn không tạo tài khoản này, hãy bỏ qua email."
            ),
        },
    },
    "email_change_confirm": {
        "en": {
            "subject": "Confirm your new GMMO email address",
            "body": (
                "You asked to use this address for your GMMO account.\n\n"
                "Confirm it with the link below (valid for 24 hours). Nothing changes until you do.\n\n"
                "Confirm new email:\n{action_url}\n\n"
                "If you did not request this, ignore this email."
            ),
        },
        "vi": {
            "subject": "Xác nhận email mới cho tài khoản GMMO",
            "body": (
                "Bạn yêu cầu dùng địa chỉ này cho tài khoản GMMO.\n\n"
                "Bấm link dưới để xác nhận (hiệu lực 24 giờ). Email đăng nhập chỉ đổi sau khi bạn xác nhận.\n\n"
                "Xác nhận email mới:\n{action_url}\n\n"
                "Nếu bạn không yêu cầu, hãy bỏ qua email này."
            ),
        },
    },
    "email_change_notice": {
        "en": {
            "subject": "A new email address was requested for your GMMO account",
            "body": (
                "Someone signed in to your account and asked to change its email to {new_email}.\n\n"
                "If this was you, confirm it from the new mailbox. If not, reset your password now.\n\n"
                "Reset password:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Có yêu cầu đổi email cho tài khoản GMMO của bạn",
            "body": (
                "Ai đó đã đăng nhập tài khoản của bạn và yêu cầu đổi email sang {new_email}.\n\n"
                "Nếu là bạn, hãy xác nhận từ hộp thư mới. Nếu không phải, đặt lại mật khẩu ngay.\n\n"
                "Đặt lại mật khẩu:\n{action_url}"
            ),
        },
    },
    "password_reset": {
        "en": {
            "subject": "Reset your Marketplace password",
            "body": (
                "We received a request to reset your password.\n\n"
                "The link is valid for 30 minutes.\n\nReset password:\n{action_url}\n\n"
                "If you did not request this, ignore this email."
            ),
        },
        "vi": {
            "subject": "Đặt lại mật khẩu Marketplace",
            "body": (
                "Chúng tôi nhận được yêu cầu đặt lại mật khẩu của bạn.\n\n"
                "Liên kết có hiệu lực trong 30 phút.\n\nĐặt lại mật khẩu:\n{action_url}\n\n"
                "Nếu bạn không yêu cầu, hãy bỏ qua email này."
            ),
        },
    },
    "password_changed": {
        "en": {
            "subject": "Your Marketplace password was changed",
            "body": (
                "Your password was changed successfully.\n\n"
                "If this was not you, reset it immediately.\n\nReset password:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Mật khẩu Marketplace đã được đổi",
            "body": (
                "Mật khẩu của bạn đã được đổi thành công.\n\n"
                "Nếu không phải bạn, hãy đặt lại mật khẩu ngay.\n\nĐặt lại mật khẩu:\n{action_url}"
            ),
        },
    },
    "seller_application_approved": {
        "en": {
            "subject": "Your seller application was approved",
            "body": "You can now list products on Marketplace.\n\nOpen seller workspace:\n{action_url}",
        },
        "vi": {
            "subject": "Đơn đăng ký bán hàng đã được duyệt",
            "body": "Bạn có thể bắt đầu đăng sản phẩm trên Marketplace.\n\nMở khu vực người bán:\n{action_url}",
        },
    },
    "seller_application_rejected": {
        "en": {
            "subject": "Your seller application was not approved",
            "body": "Reason: {reason}\n\nYou can review the note and apply again.\n\nView application:\n{action_url}",
        },
        "vi": {
            "subject": "Đơn đăng ký bán hàng chưa được duyệt",
            "body": "Lý do: {reason}\n\nBạn có thể xem ghi chú và nộp lại.\n\nXem đơn đăng ký:\n{action_url}",
        },
    },
    "provider_approved": {
        "en": {
            "subject": "Your provider was approved",
            "body": "“{provider_name}” is approved and can be attached to products.\n\nOpen providers:\n{action_url}",
        },
        "vi": {
            "subject": "Nhà cung cấp đã được duyệt",
            "body": "“{provider_name}” đã được duyệt và có thể gắn vào sản phẩm.\n\nMở nhà cung cấp:\n{action_url}",
        },
    },
    "provider_rejected": {
        "en": {
            "subject": "Your provider was not approved",
            "body": (
                "“{provider_name}” was not approved.\nReason: {reason}\n\n"
                "Fix the configuration and resubmit.\n\nOpen providers:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Nhà cung cấp chưa được duyệt",
            "body": (
                "“{provider_name}” chưa được duyệt.\nLý do: {reason}\n\n"
                "Sửa cấu hình và gửi lại.\n\nMở nhà cung cấp:\n{action_url}"
            ),
        },
    },
    "withdrawal_approved": {
        "en": {
            "subject": "Withdrawal approved",
            "body": (
                "Your withdrawal of {amount} was approved. Payout is processed by the operations team.\n\n"
                "View withdrawals:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Yêu cầu rút tiền đã được duyệt",
            "body": (
                "Yêu cầu rút {amount} đã được duyệt. Đội vận hành sẽ chuyển khoản.\n\n"
                "Xem yêu cầu rút tiền:\n{action_url}"
            ),
        },
    },
    "withdrawal_rejected": {
        "en": {
            "subject": "Withdrawal was not approved",
            "body": (
                "Your withdrawal of {amount} was not approved.\nReason: {reason}\n"
                "The locked amount has been returned to your wallet.\n\n"
                "View withdrawals:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Yêu cầu rút tiền không được duyệt",
            "body": (
                "Yêu cầu rút {amount} không được duyệt.\nLý do: {reason}\n"
                "Số tiền đã khoá đã được trả về ví.\n\n"
                "Xem yêu cầu rút tiền:\n{action_url}"
            ),
        },
    },
    "dispute_opened": {
        "en": {
            "subject": "New dispute on order #{order_id}",
            "body": (
                "A buyer opened a dispute on order #{order_id}.\n"
                "Reason: {reason}\n\n"
                "Please respond in the seller workspace before {deadline}. "
                "If nobody reacts by then, the buyer is refunded automatically.\n\n"
                "Open the order:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Khiếu nại mới trên đơn #{order_id}",
            "body": (
                "Người mua đã mở khiếu nại trên đơn #{order_id}.\n"
                "Lý do: {reason}\n\n"
                "Hãy phản hồi trong khu vực người bán trước {deadline}. "
                "Quá hạn không phản hồi, hệ thống tự hoàn tiền cho người mua.\n\n"
                "Xem đơn hàng:\n{action_url}"
            ),
        },
    },
    "dispute_resolved": {
        "en": {
            "subject": "Dispute on order #{order_id} was resolved",
            "body": (
                "Order #{order_id} was resolved: {outcome}.\n"
                "Admin note: {admin_note}\n\n"
                "View the order:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Khiếu nại đơn #{order_id} đã được xử lý",
            "body": (
                "Đơn #{order_id} đã được xử lý: {outcome}.\n"
                "Ghi chú quản trị: {admin_note}\n\n"
                "Xem đơn hàng:\n{action_url}"
            ),
        },
    },
    "admin_test": {
        "en": {
            "subject": "Test email",
            "body": (
                "This is a test email from the admin mail settings page.\n"
                "If you received it, outbound mail is working.\n\n"
                "Open site:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Email thử nghiệm",
            "body": (
                "Đây là email thử từ trang cài đặt mail quản trị.\n"
                "Nếu bạn nhận được thư này, gửi mail đi đang hoạt động.\n\n"
                "Mở trang web:\n{action_url}"
            ),
        },
    },
}

SAMPLE_PAYLOAD = {
    "action_url": "https://example.com/vi/reset-password?token=sample",
    "reason": "Sample reason",
    "order_id": "42",
    "amount": 150000,
    "outcome": "refund",
    "admin_note": "Sample admin note",
    "provider_name": "Sample provider",
}


class UnknownMailTemplate(ValueError):
    pass


def _s(payload: dict[str, Any], key: str, default: str = "") -> str:
    value = payload.get(key, default)
    return "" if value is None else str(value)


def _locale(locale: str) -> str:
    return locale if locale in {"vi", "en"} else "vi"


def format_vnd(amount: int | str) -> str:
    try:
        n = int(amount)
    except (TypeError, ValueError):
        return str(amount)
    return f"{n:,}".replace(",", ".") + " ₫"


def default_copy(template: str, locale: str) -> tuple[str, str]:
    if template not in KNOWN_TEMPLATES:
        raise UnknownMailTemplate(template)
    loc = _locale(locale)
    row = DEFAULT_TEMPLATES[template][loc]
    return row["subject"], row["body"]


def placeholder_context(locale: str, payload: dict[str, Any] | None) -> dict[str, str]:
    loc = _locale(locale)
    data = dict(payload or {})
    amount = format_vnd(_s(data, "amount", "0")) if data.get("amount") is not None else ""
    outcome = _OUTCOMES.get(_s(data, "outcome"), {}).get(loc, _s(data, "outcome"))
    return {
        "action_url": _s(data, "action_url"),
        "reason": _s(data, "reason"),
        "order_id": _s(data, "order_id"),
        "amount": amount,
        "outcome": outcome,
        "admin_note": _s(data, "admin_note"),
        "provider_name": _s(data, "provider_name"),
        "new_email": _s(data, "new_email"),
    }


def apply_placeholders(text: str, values: dict[str, str]) -> str:
    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in values:
            return values[key]
        return match.group(0)

    return _PLACEHOLDER_RE.sub(_replace, text)


_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
_ACCENT = "#4f46e5"
_INK = "#1f2937"
_MUTED = "#6b7280"
_RULE = "#e5e7eb"

_HTML_COPY = {
    "vi": {
        "cta": "Mở liên kết",
        "fallback": "Nếu nút không hoạt động, dán liên kết này vào trình duyệt:",
        "footer": "Bạn nhận được email này vì có tài khoản tại {brand}. Đây là email tự động, vui lòng không trả lời.",
    },
    "en": {
        "cta": "Open link",
        "fallback": "If the button does not work, paste this link into your browser:",
        "footer": "You received this email because you have an account at {brand}. This is an automated message, please do not reply.",
    },
}


def _paragraph(chunk: str, action_url: str) -> str:
    escaped = html.escape(chunk).replace("\n", "<br>")
    if action_url:
        safe_href = html.escape(action_url, quote=True)
        escaped = escaped.replace(
            html.escape(action_url),
            f'<a href="{safe_href}" style="color:{_ACCENT};">{html.escape(action_url)}</a>',
        )
    return f'<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{_INK};">{escaped}</p>'


def _button(label: str, action_url: str, copy: dict[str, str]) -> str:
    safe_href = html.escape(action_url, quote=True)
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">'
        f'<tr><td style="border-radius:8px;background:{_ACCENT};">'
        f'<a href="{safe_href}" style="display:inline-block;padding:12px 24px;font-family:{_FONT};'
        'font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">'
        f"{html.escape(label)}</a></td></tr></table>"
        f'<p style="margin:0 0 4px;font-size:12px;line-height:1.5;color:{_MUTED};">{copy["fallback"]}</p>'
        f'<p style="margin:0 0 20px;font-size:12px;line-height:1.5;word-break:break-all;">'
        f'<a href="{safe_href}" style="color:{_ACCENT};">{html.escape(action_url)}</a></p>'
    )


def _blocks(text: str, action_url: str, copy: dict[str, str]) -> str:
    """Paragraphs in order; a paragraph whose last line is exactly the action URL becomes a button.

    The line right above the URL (ending with ':') is used as the button label so admins can
    change the label from the plain-text template without any markup.
    """
    out: list[str] = []
    for chunk in re.split(r"\n\s*\n", text.strip("\n")):
        if not chunk.strip():
            continue
        lines = chunk.split("\n")
        if action_url and lines[-1].strip() == action_url:
            label = copy["cta"]
            rest = lines[:-1]
            if rest and rest[-1].strip().endswith(":"):
                label = rest[-1].strip().rstrip(":").strip() or label
                rest = rest[:-1]
            if any(line.strip() for line in rest):
                out.append(_paragraph("\n".join(rest), action_url))
            out.append(_button(label, action_url, copy))
        else:
            out.append(_paragraph(chunk, action_url))
    return "".join(out)


def _to_html(text: str, action_url: str, *, locale: str, brand: str, site_url: str) -> str:
    copy = _HTML_COPY[_locale(locale)]
    safe_brand = html.escape(brand)
    safe_site = html.escape(site_url, quote=True)
    site_label = html.escape(re.sub(r"^https?://", "", site_url).rstrip("/"))
    footer = html.escape(copy["footer"].format(brand=brand))
    return (
        "<!doctype html>"
        '<html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        f'<body style="margin:0;padding:0;background:#f4f5f7;font-family:{_FONT};">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;">'
        '<tr><td align="center" style="padding:32px 16px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">'
        f'<tr><td style="padding:0 8px 16px;">'
        f'<a href="{safe_site}" style="font-size:20px;font-weight:700;color:{_ACCENT};text-decoration:none;letter-spacing:-0.01em;">{safe_brand}</a>'
        "</td></tr>"
        '<tr><td style="background:#ffffff;border:1px solid '
        f'{_RULE};border-radius:12px;padding:32px 32px 16px;">'
        f"{_blocks(text, action_url, copy)}"
        "</td></tr>"
        f'<tr><td style="padding:20px 8px 0;font-size:12px;line-height:1.6;color:{_MUTED};">'
        f'<p style="margin:0 0 6px;">{footer}</p>'
        f'<p style="margin:0;"><a href="{safe_site}" style="color:{_MUTED};">{site_label}</a></p>'
        "</td></tr>"
        "</table></td></tr></table></body></html>"
    )


def render(
    template: str,
    locale: str,
    payload: dict[str, Any] | None,
    copy: tuple[str, str] | None = None,
    *,
    brand: str = "Proxora",
    site_url: str = "http://localhost:3000",
) -> tuple[str, str, str]:
    if template not in KNOWN_TEMPLATES:
        raise UnknownMailTemplate(template)
    loc = _locale(locale)
    subject_src, body_src = copy if copy is not None else default_copy(template, loc)
    values = placeholder_context(loc, payload)
    subject = apply_placeholders(subject_src, values)
    text = apply_placeholders(body_src, values)
    html_body = _to_html(text, values["action_url"], locale=loc, brand=brand, site_url=site_url)
    return subject, text, html_body
