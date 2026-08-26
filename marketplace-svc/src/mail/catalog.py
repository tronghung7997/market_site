"""Persist and cache admin-editable mail template copy.

Code defaults in templates.DEFAULT_TEMPLATES are the seed and reset source.
Admin may change subject/body; they cannot add or remove template ids.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.models.mail_template import MailTemplate
from src.runtime_config import ProcessConfigCache

from .errors import MailConfigError
from .templates import (
    DEFAULT_TEMPLATES,
    KNOWN_TEMPLATES,
    PLACEHOLDERS,
    SAMPLE_PAYLOAD,
    default_copy,
    render,
)

_SUBJECT_MAX = 200
_BODY_MAX = 8000
_LOCALES = ("vi", "en")

_cache: ProcessConfigCache[dict] = ProcessConfigCache("mail_templates")


def _key(template: str, locale: str) -> str:
    return f"{template}:{locale}"


def _snapshot_from_rows(rows: list[MailTemplate]) -> dict:
    data: dict[str, dict[str, str]] = {}
    for row in rows:
        data[_key(row.template, row.locale)] = {"subject": row.subject, "body": row.body}
    return data


def lookup_copy(template: str, locale: str) -> tuple[str, str]:
    loc = locale if locale in _LOCALES else "vi"
    cached = _cache.get()
    if cached is not None:
        row = cached.get(_key(template, loc))
        if row:
            return row["subject"], row["body"]
    return default_copy(template, loc)


async def ensure_seeded(db: AsyncSession) -> None:
    existing = list((await db.execute(select(MailTemplate))).scalars().all())
    have = {(row.template, row.locale) for row in existing}
    missing = [
        {
            "template": template,
            "locale": loc,
            "subject": copy["subject"],
            "body": copy["body"],
            "updated_by_id": None,
        }
        for template, locales in DEFAULT_TEMPLATES.items()
        for loc, copy in locales.items()
        if (template, loc) not in have
    ]
    if missing:
        await db.execute(pg_insert(MailTemplate).values(missing).on_conflict_do_nothing())
        await db.flush()
        existing = list((await db.execute(select(MailTemplate))).scalars().all())
    _cache.set(_snapshot_from_rows(existing))


def _row_public(row: MailTemplate) -> dict:
    default_subject, default_body = default_copy(row.template, row.locale)
    return {
        "template": row.template,
        "locale": row.locale,
        "subject": row.subject,
        "body": row.body,
        "placeholders": list(PLACEHOLDERS.get(row.template, ())),
        "default_subject": default_subject,
        "default_body": default_body,
        "customized": row.subject != default_subject or row.body != default_body,
        "updated_at": row.updated_at,
        "updated_by_id": row.updated_by_id,
    }


async def list_templates(db: AsyncSession) -> dict:
    await ensure_seeded(db)
    await db.commit()
    rows = list(
        (await db.execute(
            select(MailTemplate).order_by(MailTemplate.template, MailTemplate.locale)
        )).scalars().all()
    )
    return {"items": [_row_public(row) for row in rows]}


async def _get_row(db: AsyncSession, template: str, locale: str) -> MailTemplate:
    if template not in KNOWN_TEMPLATES:
        raise MailConfigError("unknown mail template")
    if locale not in _LOCALES:
        raise MailConfigError("locale must be vi or en")
    await ensure_seeded(db)
    row = await db.get(MailTemplate, (template, locale))
    if row is None:
        raise MailConfigError("mail template row missing")
    return row


def _validate_copy(subject: str, body: str) -> tuple[str, str]:
    sub = subject.strip()
    text = body.strip()
    if not sub:
        raise MailConfigError("subject cannot be empty")
    if not text:
        raise MailConfigError("body cannot be empty")
    if len(sub) > _SUBJECT_MAX:
        raise MailConfigError(f"subject must be at most {_SUBJECT_MAX} characters")
    if len(text) > _BODY_MAX:
        raise MailConfigError(f"body must be at most {_BODY_MAX} characters")
    return sub, text


async def update_template(
    db: AsyncSession,
    *,
    actor_id: int,
    template: str,
    locale: str,
    subject: str,
    body: str,
) -> dict:
    row = await _get_row(db, template, locale)
    sub, text = _validate_copy(subject, body)
    old = {"subject": row.subject, "body": row.body}
    row.subject = sub
    row.body = text
    row.updated_by_id = actor_id
    await db.flush()
    await log_event(
        db, "info", "Mail template updated",
        metadata={
            "event": "mail_template_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "mail_template",
            "template": template,
            "locale": locale,
            "old_subject": old["subject"],
            "new_subject": sub,
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    existing = list((await db.execute(select(MailTemplate))).scalars().all())
    _cache.invalidate()
    _cache.set(_snapshot_from_rows(existing))
    return _row_public(row)


async def reset_template(
    db: AsyncSession,
    *,
    actor_id: int,
    template: str,
    locale: str,
) -> dict:
    await _get_row(db, template, locale)
    subject, body = default_copy(template, locale)
    return await update_template(
        db,
        actor_id=actor_id,
        template=template,
        locale=locale,
        subject=subject,
        body=body,
    )


def preview(template: str, locale: str, subject: str, body: str) -> dict:
    if template not in KNOWN_TEMPLATES:
        raise MailConfigError("unknown mail template")
    sub, text = _validate_copy(subject, body)
    rendered_subject, rendered_text, _html = render(
        template, locale, SAMPLE_PAYLOAD, copy=(sub, text),
    )
    return {
        "template": template,
        "locale": locale if locale in _LOCALES else "vi",
        "subject": rendered_subject,
        "body": rendered_text,
        "placeholders": list(PLACEHOLDERS.get(template, ())),
    }
