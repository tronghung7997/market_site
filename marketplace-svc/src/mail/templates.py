"""Transactional mail catalog (vi/en). User-provided strings are escaped in HTML."""

from __future__ import annotations

import html
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

_OUTCOMES = {
    "refund": {"vi": "Hoàn toàn bộ tiền", "en": "Full refund"},
    "reject": {"vi": "Từ chối khiếu nại", "en": "Dispute rejected"},
    "partial_refund": {"vi": "Hoàn một phần", "en": "Partial refund"},
    "replace": {"vi": "Đổi hàng", "en": "Replacement issued"},
    "extend_warranty": {"vi": "Gia hạn bảo hành", "en": "Warranty extended"},
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


def _copy(locale: str, template: str, payload: dict[str, Any]) -> tuple[str, str]:
    loc = _locale(locale)
    action_url = _s(payload, "action_url")
    reason = _s(payload, "reason")
    order_id = _s(payload, "order_id")
    amount = format_vnd(_s(payload, "amount", "0")) if payload.get("amount") is not None else ""
    outcome = _OUTCOMES.get(_s(payload, "outcome"), {}).get(loc, _s(payload, "outcome"))

    if template == "password_reset":
        if loc == "en":
            return (
                "Reset your Marketplace password",
                "We received a request to reset your password.\n\n"
                f"Use this link within 30 minutes:\n{action_url}\n\n"
                "If you did not request this, ignore this email.",
            )
        return (
            "Đặt lại mật khẩu Marketplace",
            "Chúng tôi nhận được yêu cầu đặt lại mật khẩu của bạn.\n\n"
            f"Dùng liên kết này trong 30 phút:\n{action_url}\n\n"
            "Nếu bạn không yêu cầu, hãy bỏ qua email này.",
        )
    if template == "password_changed":
        if loc == "en":
            return (
                "Your Marketplace password was changed",
                "Your password was changed successfully.\n\n"
                f"If this was not you, reset it immediately:\n{action_url}",
            )
        return (
            "Mật khẩu Marketplace đã được đổi",
            "Mật khẩu của bạn đã được đổi thành công.\n\n"
            f"Nếu không phải bạn, hãy đặt lại ngay:\n{action_url}",
        )
    if template == "seller_application_approved":
        if loc == "en":
            return (
                "Your seller application was approved",
                "You can now list products on Marketplace.\n\n"
                f"Open the seller workspace:\n{action_url}",
            )
        return (
            "Đơn đăng ký bán hàng đã được duyệt",
            "Bạn có thể bắt đầu đăng sản phẩm trên Marketplace.\n\n"
            f"Mở khu vực người bán:\n{action_url}",
        )
    if template == "seller_application_rejected":
        if loc == "en":
            return (
                "Your seller application was not approved",
                f"Reason: {reason}\n\n"
                f"You can review the note and apply again:\n{action_url}",
            )
        return (
            "Đơn đăng ký bán hàng chưa được duyệt",
            f"Lý do: {reason}\n\n"
            f"Bạn có thể xem ghi chú và nộp lại:\n{action_url}",
        )
    if template == "provider_approved":
        name = _s(payload, "provider_name")
        if loc == "en":
            return (
                "Your provider was approved",
                f"“{name}” is approved and can be attached to products.\n\n"
                f"Open providers:\n{action_url}",
            )
        return (
            "Nhà cung cấp đã được duyệt",
            f"“{name}” đã được duyệt và có thể gắn vào sản phẩm.\n\n"
            f"Mở nhà cung cấp:\n{action_url}",
        )
    if template == "provider_rejected":
        name = _s(payload, "provider_name")
        if loc == "en":
            return (
                "Your provider was not approved",
                f"“{name}” was not approved.\nReason: {reason}\n\n"
                f"Fix the configuration and resubmit:\n{action_url}",
            )
        return (
            "Nhà cung cấp chưa được duyệt",
            f"“{name}” chưa được duyệt.\nLý do: {reason}\n\n"
            f"Sửa cấu hình và gửi lại:\n{action_url}",
        )
    if template == "withdrawal_approved":
        if loc == "en":
            return (
                "Withdrawal approved",
                f"Your withdrawal of {amount} was approved. Payout is processed by the operations team.\n\n"
                f"View withdrawals:\n{action_url}",
            )
        return (
            "Yêu cầu rút tiền đã được duyệt",
            f"Yêu cầu rút {amount} đã được duyệt. Đội vận hành sẽ chuyển khoản.\n\n"
            f"Xem yêu cầu rút tiền:\n{action_url}",
        )
    if template == "withdrawal_rejected":
        if loc == "en":
            return (
                "Withdrawal was not approved",
                f"Your withdrawal of {amount} was not approved.\nReason: {reason}\n"
                "The locked amount has been returned to your wallet.\n\n"
                f"View withdrawals:\n{action_url}",
            )
        return (
            "Yêu cầu rút tiền không được duyệt",
            f"Yêu cầu rút {amount} không được duyệt.\nLý do: {reason}\n"
            "Số tiền đã khoá đã được trả về ví.\n\n"
            f"Xem yêu cầu rút tiền:\n{action_url}",
        )
    if template == "dispute_opened":
        if loc == "en":
            return (
                f"New dispute on order #{order_id}",
                f"A buyer opened a dispute on order #{order_id}.\n"
                f"Reason: {reason}\n\n"
                "Please respond in the seller workspace. Silence can be decided against you.\n\n"
                f"Open orders:\n{action_url}",
            )
        return (
            f"Khiếu nại mới trên đơn #{order_id}",
            f"Người mua đã mở khiếu nại trên đơn #{order_id}.\n"
            f"Lý do: {reason}\n\n"
            "Hãy phản hồi trong khu vực người bán. Im lặng có thể bất lợi cho bạn.\n\n"
            f"Mở đơn hàng:\n{action_url}",
        )
    if template == "dispute_resolved":
        note = _s(payload, "admin_note")
        if loc == "en":
            return (
                f"Dispute on order #{order_id} was resolved",
                f"Order #{order_id} was resolved: {outcome}.\n"
                f"Admin note: {note}\n\n"
                f"View the order:\n{action_url}",
            )
        return (
            f"Khiếu nại đơn #{order_id} đã được xử lý",
            f"Đơn #{order_id} đã được xử lý: {outcome}.\n"
            f"Ghi chú quản trị: {note}\n\n"
            f"Xem đơn hàng:\n{action_url}",
        )
    if template == "admin_test":
        if loc == "en":
            return (
                "Proxora mail test",
                "This is a test email from the admin mail settings page.\n"
                "If you received it, outbound mail is working.\n\n"
                f"Open the site:\n{action_url}",
            )
        return (
            "Mail thử Proxora",
            "Đây là email thử từ trang cài đặt mail quản trị.\n"
            "Nếu bạn nhận được thư này, gửi mail đi đang hoạt động.\n\n"
            f"Mở trang:\n{action_url}",
        )
    raise UnknownMailTemplate(template)


def render(template: str, locale: str, payload: dict[str, Any] | None) -> tuple[str, str, str]:
    if template not in KNOWN_TEMPLATES:
        raise UnknownMailTemplate(template)
    data = dict(payload or {})
    subject, text = _copy(locale, template, data)
    action_url = _s(data, "action_url")
    escaped = html.escape(text).replace("\n", "<br>\n")
    if action_url:
        safe_href = html.escape(action_url, quote=True)
        escaped = escaped.replace(html.escape(action_url), f'<a href="{safe_href}">{html.escape(action_url)}</a>')
    html_body = (
        "<!doctype html><html><body "
        'style="font-family:Georgia,serif;background:#f6f5f1;color:#16151a;padding:24px;">'
        '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e6e4dc;padding:24px;">'
        f"{escaped}"
        "</div></body></html>"
    )
    return subject, text, html_body
