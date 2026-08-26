from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.account import Account
from src.models.mail import MailOutbox, MailOutboxStatus

from .templates import KNOWN_TEMPLATES, UnknownMailTemplate


def frontend_url(locale: str, path: str) -> str:
    base = settings.frontend_base_url.rstrip("/")
    loc = locale if locale in {"vi", "en"} else "vi"
    rel = path if path.startswith("/") else f"/{path}"
    return f"{base}/{loc}{rel}"


def reset_password_url(locale: str, raw_token: str) -> str:
    return frontend_url(locale, f"/reset-password?token={quote(raw_token, safe='')}")


def forgot_password_url(locale: str) -> str:
    return frontend_url(locale, "/forgot-password")


async def enqueue_mail(
    db: AsyncSession,
    *,
    template: str,
    idempotency_key: str,
    payload: dict[str, Any] | None = None,
    account_id: int | None = None,
    to_email: str | None = None,
    locale: str = "vi",
) -> MailOutbox | None:
    """Insert an outbox row in the caller's transaction. Does not commit.

    Duplicate idempotency_key is a no-op. Inactive accounts are skipped.
    Unknown templates raise — the owning action must not commit a silent miss.
    """
    if template not in KNOWN_TEMPLATES:
        raise UnknownMailTemplate(template)

    loc = locale if locale in {"vi", "en"} else "vi"
    resolved_email = to_email
    resolved_account_id = account_id
    if account_id is not None:
        account = await db.get(Account, account_id)
        if account is None:
            raise ValueError(f"mail enqueue: account {account_id} not found")
        if not account.is_active:
            return None
        resolved_email = account.email
        resolved_account_id = account.id
    if not resolved_email:
        raise ValueError("mail enqueue requires to_email or account_id")

    now = datetime.now(timezone.utc)
    table = MailOutbox.__table__
    stmt = (
        pg_insert(table)
        .values(
            idempotency_key=idempotency_key,
            template=template,
            to_email=resolved_email,
            account_id=resolved_account_id,
            locale=loc,
            payload=payload or {},
            status=MailOutboxStatus.pending.value,
            attempts=0,
            scheduled_at=now,
        )
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
        .returning(table.c.id)
    )
    result = await db.execute(stmt)
    row_id = result.scalar_one_or_none()
    await db.flush()
    if row_id is None:
        return None
    return await db.get(MailOutbox, row_id)
