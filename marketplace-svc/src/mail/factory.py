"""Compose the outbound mail adapter.

Sending is always an outbound call (SMTP 587/465 or HTTPS to Resend).
Inbound ports are not required. Prefer Resend when the host blocks SMTP.
"""

from __future__ import annotations

import structlog

from .adapters import LogMailAdapter, MailAdapter, ResendMailAdapter, SmtpMailAdapter
from .runtime import MailRuntime, current_runtime, mail_ready

logger = structlog.get_logger()

_override: MailAdapter | None = None


def set_mail_adapter(adapter: MailAdapter | None) -> None:
    global _override
    _override = adapter


def mail_configured(runtime: MailRuntime | None = None) -> bool:
    return mail_ready(runtime or current_runtime())


def get_mail_adapter(runtime: MailRuntime | None = None) -> MailAdapter | None:
    if _override is not None:
        return _override
    rt = runtime or current_runtime()
    if not mail_ready(rt):
        logger.warning(
            "mail_unconfigured",
            provider=rt.provider,
            detail="MAIL_FROM / provider credentials missing — outbox stays pending",
        )
        return None
    if rt.provider == "smtp":
        return SmtpMailAdapter()
    if rt.provider == "resend":
        return ResendMailAdapter()
    return LogMailAdapter()
