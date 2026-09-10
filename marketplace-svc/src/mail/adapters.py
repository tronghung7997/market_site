from __future__ import annotations

import asyncio
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr

import httpx
import structlog

from src.config import settings

logger = structlog.get_logger()

_SEND_TIMEOUT_SECONDS = 15.0
_RESEND_URL = "https://api.resend.com/emails"


def _from_header(message: "MailMessage") -> str:
    name = (message.from_name or settings.mail_from_name).strip()
    email = (message.from_email or settings.mail_from).strip()
    return formataddr((name, email)) if name else email


@dataclass(frozen=True)
class MailMessage:
    to: str
    subject: str
    text: str
    html: str | None = None
    template: str = ""
    idempotency_key: str = ""
    from_email: str = ""
    from_name: str = ""
    headers: dict[str, str] = field(default_factory=dict)


class MailAdapter:
    async def send(self, message: MailMessage) -> None:
        raise NotImplementedError


class MailSendError(Exception):
    """Transient or provider error. Worker retries."""


class PermanentMailSendError(MailSendError):
    """Provider rejected the message/configuration; retrying cannot fix it."""


class LogMailAdapter(MailAdapter):
    """Development/test default: log metadata, never the reset URL/body."""

    async def send(self, message: MailMessage) -> None:
        logger.info(
            "mail_sent_log",
            provider="log",
            template=message.template,
            to_domain=message.to.rsplit("@", 1)[-1] if "@" in message.to else "unknown",
            subject=message.subject,
        )


class RecordingMailAdapter(MailAdapter):
    """In-memory capture for tests."""

    def __init__(self) -> None:
        self.sent: list[MailMessage] = []
        self.fail_times: int = 0

    async def send(self, message: MailMessage) -> None:
        if self.fail_times > 0:
            self.fail_times -= 1
            raise MailSendError("recording adapter forced failure")
        self.sent.append(message)


class SmtpMailAdapter(MailAdapter):
    async def send(self, message: MailMessage) -> None:
        await asyncio.to_thread(self._send_sync, message)

    def _send_sync(self, message: MailMessage) -> None:
        msg = EmailMessage()
        msg["From"] = _from_header(message)
        msg["To"] = message.to
        msg["Subject"] = message.subject
        msg.set_content(message.text)
        if message.html:
            msg.add_alternative(message.html, subtype="html")
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=_SEND_TIMEOUT_SECONDS) as smtp:
                if settings.smtp_starttls:
                    smtp.starttls()
                if settings.smtp_username:
                    smtp.login(settings.smtp_username, settings.smtp_password)
                smtp.send_message(msg)
        except smtplib.SMTPResponseException as exc:
            error = f"smtp_{exc.smtp_code}"
            if 500 <= exc.smtp_code < 600:
                raise PermanentMailSendError(error) from exc
            raise MailSendError(error) from exc
        except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused) as exc:
            raise PermanentMailSendError(type(exc).__name__) from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise MailSendError(str(exc)) from exc


class ResendMailAdapter(MailAdapter):
    async def send(self, message: MailMessage) -> None:
        payload: dict[str, object] = {
            "from": _from_header(message),
            "to": [message.to],
            "subject": message.subject,
            "text": message.text,
        }
        if message.html:
            payload["html"] = message.html
        headers = {"Authorization": f"Bearer {settings.resend_api_key}"}
        if message.idempotency_key:
            headers["Idempotency-Key"] = message.idempotency_key
        try:
            async with httpx.AsyncClient(timeout=_SEND_TIMEOUT_SECONDS) as client:
                response = await client.post(_RESEND_URL, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise MailSendError(str(exc)) from exc
        if response.status_code >= 500 or response.status_code in {408, 429}:
            raise MailSendError(f"resend_http_{response.status_code}")
        if response.status_code >= 400:
            raise PermanentMailSendError(f"resend_http_{response.status_code}")
