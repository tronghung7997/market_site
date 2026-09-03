"""Transactional mail catalog (vi/en). User-provided strings are escaped in HTML."""

from __future__ import annotations

import html
import re
from typing import Any

KNOWN_TEMPLATES = frozenset({
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
    "password_reset": ("action_url",),
    "password_changed": ("action_url",),
    "seller_application_approved": ("action_url",),
    "seller_application_rejected": ("reason", "action_url"),
    "provider_approved": ("provider_name", "action_url"),
    "provider_rejected": ("provider_name", "reason", "action_url"),
    "withdrawal_approved": ("amount", "action_url"),
    "withdrawal_rejected": ("amount", "reason", "action_url"),
    "dispute_opened": ("order_id", "reason", "action_url"),
    "dispute_resolved": ("order_id", "outcome", "admin_note", "action_url"),
    "admin_test": ("action_url",),
}

_CONTEXT_KEYS = (
    "action_url",
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
    "password_reset": {
        "en": {
            "subject": "Reset your Marketplace password",
            "body": (
                "We received a request to reset your password.\n\n"
                "Use this link within 30 minutes:\n{action_url}\n\n"
                "If you did not request this, ignore this email."
            ),
        },
        "vi": {
            "subject": "Đặt lại mật khẩu Marketplace",
            "body": (
                "Chúng tôi nhận được yêu cầu đặt lại mật khẩu của bạn.\n\n"
                "Dùng liên kết này trong 30 phút:\n{action_url}\n\n"
                "Nếu bạn không yêu cầu, hãy bỏ qua email này."
            ),
        },
    },
    "password_changed": {
        "en": {
            "subject": "Your Marketplace password was changed",
            "body": (
                "Your password was changed successfully.\n\n"
                "If this was not you, reset it immediately:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Mật khẩu Marketplace đã được đổi",
            "body": (
                "Mật khẩu của bạn đã được đổi thành công.\n\n"
                "Nếu không phải bạn, hãy đặt lại ngay:\n{action_url}"
            ),
        },
    },
    "seller_application_approved": {
        "en": {
            "subject": "Your seller application was approved",
            "body": "You can now list products on Marketplace.\n\nOpen the seller workspace:\n{action_url}",
        },
        "vi": {
            "subject": "Đơn đăng ký bán hàng đã được duyệt",
            "body": "Bạn có thể bắt đầu đăng sản phẩm trên Marketplace.\n\nMở khu vực người bán:\n{action_url}",
        },
    },
    "seller_application_rejected": {
        "en": {
            "subject": "Your seller application was not approved",
            "body": "Reason: {reason}\n\nYou can review the note and apply again:\n{action_url}",
        },
        "vi": {
            "subject": "Đơn đăng ký bán hàng chưa được duyệt",
            "body": "Lý do: {reason}\n\nBạn có thể xem ghi chú và nộp lại:\n{action_url}",
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
                "Fix the configuration and resubmit:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Nhà cung cấp chưa được duyệt",
            "body": (
                "“{provider_name}” chưa được duyệt.\nLý do: {reason}\n\n"
                "Sửa cấu hình và gửi lại:\n{action_url}"
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
                "Please respond in the seller workspace. Silence can be decided against you.\n\n"
                "Open orders:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Khiếu nại mới trên đơn #{order_id}",
            "body": (
                "Người mua đã mở khiếu nại trên đơn #{order_id}.\n"
                "Lý do: {reason}\n\n"
                "Hãy phản hồi trong khu vực người bán. Im lặng có thể bất lợi cho bạn.\n\n"
                "Mở đơn hàng:\n{action_url}"
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
            "subject": "Proxora mail test",
            "body": (
                "This is a test email from the admin mail settings page.\n"
                "If you received it, outbound mail is working.\n\n"
                "Open the site:\n{action_url}"
            ),
        },
        "vi": {
            "subject": "Mail thử Proxora",
            "body": (
                "Đây là email thử từ trang cài đặt mail quản trị.\n"
                "Nếu bạn nhận được thư này, gửi mail đi đang hoạt động.\n\n"
                "Mở trang:\n{action_url}"
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
    }


def apply_placeholders(text: str, values: dict[str, str]) -> str:
    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in values:
            return values[key]
        return match.group(0)

    return _PLACEHOLDER_RE.sub(_replace, text)


def _to_html(text: str, action_url: str) -> str:
    escaped = html.escape(text).replace("\n", "<br>\n")
    if action_url:
        safe_href = html.escape(action_url, quote=True)
        escaped = escaped.replace(
            html.escape(action_url),
            f'<a href="{safe_href}">{html.escape(action_url)}</a>',
        )
    return (
        "<!doctype html><html><body "
        'style="font-family:Georgia,serif;background:#f6f5f1;color:#16151a;padding:24px;">'
        '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e4dc;padding:24px;">'
        f"{escaped}"
        "</div></body></html>"
    )


def render(
    template: str,
    locale: str,
    payload: dict[str, Any] | None,
    copy: tuple[str, str] | None = None,
) -> tuple[str, str, str]:
    if template not in KNOWN_TEMPLATES:
        raise UnknownMailTemplate(template)
    loc = _locale(locale)
    subject_src, body_src = copy if copy is not None else default_copy(template, loc)
    values = placeholder_context(loc, payload)
    subject = apply_placeholders(subject_src, values)
    text = apply_placeholders(body_src, values)
    return subject, text, _to_html(text, values["action_url"])
