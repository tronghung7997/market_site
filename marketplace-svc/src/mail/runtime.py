"""Admin-tunable mail runtime config.

Secrets stay in env. Operational knobs (provider, from, worker) live in
mail_runtime_config; env is bootstrap/reset only.

The process cache is the snapshot adapters/worker read. Admin writes
hard-invalidate it.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.config import settings
from src.models.mail import MailOutbox, MailOutboxStatus
from src.models.mail_runtime_config import MailRuntimeConfig
from src.runtime_config import ProcessConfigCache

from .errors import (
    MailConfigError,
    MailNotReady,
    MailOutboxConflict,
    MailOutboxNotFound,
    MailTestCooldown,
)
from .service import enqueue_mail

_CONFIG_ID = 1
_PROVIDERS = ("log", "smtp", "resend")
_TEST_COOLDOWN = timedelta(seconds=15)
_FROM_NAME_MAX = 80

_cache: ProcessConfigCache[dict] = ProcessConfigCache("mail_runtime")


@dataclass(frozen=True)
class MailRuntime:
    provider: Literal["log", "smtp", "resend"]
    mail_from: str
    mail_from_name: str
    worker_enabled: bool


def env_seed_values() -> dict[str, Any]:
    provider = settings.mail_provider if settings.mail_provider in _PROVIDERS else "log"
    return {
        "provider": provider,
        "mail_from": settings.mail_from.strip(),
        "mail_from_name": (settings.mail_from_name.strip() or "Proxora")[:_FROM_NAME_MAX],
        "worker_enabled": bool(settings.mail_worker_enabled),
    }


def env_runtime() -> MailRuntime:
    seed = env_seed_values()
    return MailRuntime(
        provider=seed["provider"],
        mail_from=seed["mail_from"],
        mail_from_name=seed["mail_from_name"],
        worker_enabled=seed["worker_enabled"],
    )


def runtime_from_mapping(data: dict) -> MailRuntime:
    provider = data.get("provider", "log")
    if provider not in _PROVIDERS:
        provider = "log"
    return MailRuntime(
        provider=provider,
        mail_from=str(data.get("mail_from") or "").strip(),
        mail_from_name=str(data.get("mail_from_name") or "Proxora").strip()[:_FROM_NAME_MAX],
        worker_enabled=bool(data.get("worker_enabled", True)),
    )


def current_runtime() -> MailRuntime:
    cached = _cache.get()
    if cached is not None:
        return runtime_from_mapping(cached)
    return env_runtime()


def _row_snapshot(row: MailRuntimeConfig) -> dict:
    return {
        "provider": row.provider,
        "mail_from": row.mail_from,
        "mail_from_name": row.mail_from_name,
        "worker_enabled": bool(row.worker_enabled),
    }


async def get_config_row(db: AsyncSession) -> MailRuntimeConfig | None:
    return await db.get(MailRuntimeConfig, _CONFIG_ID)


async def ensure_seeded(db: AsyncSession) -> MailRuntimeConfig:
    row = await get_config_row(db)
    if row is not None:
        _cache.set(_row_snapshot(row))
        return row
    seed = env_seed_values()
    stmt = (
        pg_insert(MailRuntimeConfig)
        .values(id=_CONFIG_ID, updated_by_id=None, **seed)
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.execute(stmt)
    await db.flush()
    row = await get_config_row(db)
    if row is None:
        raise RuntimeError("mail_runtime_config seed failed")
    _cache.set(_row_snapshot(row))
    return row


def smtp_host_configured() -> bool:
    return bool(settings.smtp_host.strip())


def smtp_credentials_configured() -> bool:
    return bool(settings.smtp_username.strip() and settings.smtp_password)


def resend_api_key_configured() -> bool:
    return bool(settings.resend_api_key.strip())


def secrets_present(provider: str) -> bool:
    if provider == "log":
        return True
    if provider == "smtp":
        return smtp_host_configured()
    if provider == "resend":
        return resend_api_key_configured()
    return False


def mail_ready(runtime: MailRuntime) -> bool:
    if runtime.provider == "log":
        return True
    if not runtime.mail_from:
        return False
    return secrets_present(runtime.provider)


def effective_mode(runtime: MailRuntime) -> str:
    if not mail_ready(runtime):
        return "unconfigured"
    return runtime.provider


def _looks_like_email(value: str) -> bool:
    _name, addr = parseaddr(value)
    return "@" in addr and "." in addr.split("@")[-1] and " " not in addr


def row_to_admin(row: MailRuntimeConfig) -> dict:
    runtime = runtime_from_mapping(_row_snapshot(row))
    seed = env_seed_values()
    return {
        "provider": runtime.provider,
        "mail_from": runtime.mail_from,
        "mail_from_name": runtime.mail_from_name,
        "worker_enabled": runtime.worker_enabled,
        "env_provider": seed["provider"],
        "env_mail_from": seed["mail_from"],
        "env_mail_from_name": seed["mail_from_name"],
        "env_worker_enabled": seed["worker_enabled"],
        "resend_api_key_configured": resend_api_key_configured(),
        "smtp_host_configured": smtp_host_configured(),
        "smtp_credentials_configured": smtp_credentials_configured(),
        "smtp_host": settings.smtp_host.strip() or None,
        "smtp_port": settings.smtp_port,
        "effective_ready": mail_ready(runtime),
        "effective_mode": effective_mode(runtime),
        "frontend_base_url": settings.frontend_base_url.rstrip("/"),
        "updated_at": row.updated_at,
        "updated_by_id": row.updated_by_id,
        "source": "db",
    }


async def admin_config(db: AsyncSession) -> dict:
    from .catalog import ensure_seeded as ensure_templates_seeded

    row = await ensure_seeded(db)
    await ensure_templates_seeded(db)
    await db.commit()
    row = await get_config_row(db)
    assert row is not None
    return row_to_admin(row)


def _validate_provider(value: str) -> str:
    if value not in _PROVIDERS:
        raise MailConfigError("provider must be log, smtp, or resend")
    return value


def _validate_from(value: str, *, provider: str) -> str:
    cleaned = value.strip()
    if provider == "log" and not cleaned:
        return ""
    if not cleaned:
        raise MailConfigError("mail_from is required for smtp and resend")
    if len(cleaned) > 255 or not _looks_like_email(cleaned):
        raise MailConfigError("mail_from must be a valid email address")
    return cleaned


def _validate_from_name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise MailConfigError("mail_from_name cannot be empty")
    if len(cleaned) > _FROM_NAME_MAX:
        raise MailConfigError(f"mail_from_name must be at most {_FROM_NAME_MAX} characters")
    return cleaned


async def update_config(db: AsyncSession, *, actor_id: int, **fields: Any) -> dict:
    row = await ensure_seeded(db)
    old = _row_snapshot(row)
    provided = {k: v for k, v in fields.items() if v is not None}
    if not provided:
        raise MailConfigError("At least one field is required")

    if "provider" in provided:
        row.provider = _validate_provider(str(provided["provider"]))
    if "mail_from" in provided:
        row.mail_from = _validate_from(str(provided["mail_from"]), provider=row.provider)
    elif row.provider != "log":
        row.mail_from = _validate_from(row.mail_from, provider=row.provider)
    if "mail_from_name" in provided:
        row.mail_from_name = _validate_from_name(str(provided["mail_from_name"]))
    if "worker_enabled" in provided:
        row.worker_enabled = bool(provided["worker_enabled"])

    row.updated_by_id = actor_id
    await db.flush()
    await log_event(
        db, "info", "Mail runtime config updated",
        metadata={
            "event": "mail_runtime_config_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "mail_runtime_config",
            "subject_id": _CONFIG_ID,
            "old": old,
            "new": _row_snapshot(row),
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    snapshot = _row_snapshot(row)
    _cache.invalidate()
    _cache.set(snapshot)
    return row_to_admin(row)


async def reset_to_env(db: AsyncSession, *, actor_id: int) -> dict:
    seed = env_seed_values()
    return await update_config(db, actor_id=actor_id, **seed)


def _outbox_public(row: MailOutbox) -> dict:
    return {
        "id": row.id,
        "template": row.template,
        "to_email": row.to_email,
        "account_id": row.account_id,
        "locale": row.locale,
        "status": row.status,
        "attempts": row.attempts,
        "last_error": row.last_error,
        "scheduled_at": row.scheduled_at,
        "sent_at": row.sent_at,
        "created_at": row.created_at,
    }


async def list_outbox(
    db: AsyncSession,
    *,
    status: str | None = None,
    template: str | None = None,
    limit: int = 25,
    offset: int = 0,
) -> dict:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    filters = []
    if status:
        allowed = {item.value for item in MailOutboxStatus}
        if status not in allowed:
            raise MailConfigError("status must be pending, sending, sent, or failed")
        filters.append(MailOutbox.status == status)
    if template:
        filters.append(MailOutbox.template == template.strip()[:100])

    count_stmt = select(func.count()).select_from(MailOutbox)
    list_stmt = select(MailOutbox).order_by(MailOutbox.created_at.desc(), MailOutbox.id.desc())
    if filters:
        count_stmt = count_stmt.where(*filters)
        list_stmt = list_stmt.where(*filters)
    total = int(await db.scalar(count_stmt) or 0)
    rows = list((await db.execute(list_stmt.limit(limit).offset(offset))).scalars().all())
    return {"items": [_outbox_public(row) for row in rows], "total": total, "limit": limit, "offset": offset}


async def retry_outbox(db: AsyncSession, *, outbox_id: int, actor_id: int) -> dict:
    row = await db.get(MailOutbox, outbox_id)
    if row is None:
        raise MailOutboxNotFound()
    if row.status == MailOutboxStatus.sent.value:
        raise MailOutboxConflict("sent mail cannot be retried")
    if row.status == MailOutboxStatus.sending.value:
        raise MailOutboxConflict("mail is already sending")
    now = datetime.now(timezone.utc)
    row.status = MailOutboxStatus.pending.value
    row.scheduled_at = now
    row.updated_at = now
    row.last_error = None
    await db.flush()
    await log_event(
        db, "info", "Mail outbox retry requested",
        metadata={
            "event": "mail_outbox_retry",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "mail_outbox",
            "subject_id": outbox_id,
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    return _outbox_public(row)


async def send_test(
    db: AsyncSession,
    *,
    actor_id: int,
    actor_email: str,
    to_email: str,
    locale: str = "vi",
) -> dict:
    from .worker import deliver_now

    row = await ensure_seeded(db)
    runtime = runtime_from_mapping(_row_snapshot(row))
    if not mail_ready(runtime):
        raise MailNotReady("mail is not ready — set from-address and provider secrets")

    loc = locale if locale in {"vi", "en"} else "vi"
    dest = to_email.strip().lower()
    if not _looks_like_email(dest):
        raise MailConfigError("to_email must be a valid email address")

    now = datetime.now(timezone.utc)
    last = await db.scalar(
        select(MailOutbox.created_at)
        .where(
            MailOutbox.template == "admin_test",
            MailOutbox.to_email == dest,
        )
        .order_by(MailOutbox.id.desc())
        .limit(1)
    )
    if last is not None:
        last_dt = last if last.tzinfo else last.replace(tzinfo=timezone.utc)
        elapsed = now - last_dt
        if elapsed < _TEST_COOLDOWN:
            raise MailTestCooldown(int((_TEST_COOLDOWN - elapsed).total_seconds()) + 1)

    key = f"admin-test:{actor_id}:{int(now.timestamp())}"
    queued = await enqueue_mail(
        db,
        template="admin_test",
        idempotency_key=key,
        to_email=dest,
        locale=loc,
        payload={"actor_email": actor_email, "action_url": settings.frontend_base_url},
    )
    if queued is None:
        raise MailConfigError("could not enqueue test mail")
    queued.status = MailOutboxStatus.sending.value
    queued.updated_at = now
    await log_event(
        db, "info", "Mail send-test requested",
        metadata={
            "event": "mail_send_test",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "mail_outbox",
            "subject_id": queued.id,
            "to_domain": dest.rsplit("@", 1)[-1],
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    outbox_id = queued.id

    status = await deliver_now(outbox_id, runtime=runtime)
    db.expire_all()
    refreshed = await db.get(MailOutbox, outbox_id)
    if refreshed is None:
        raise MailOutboxNotFound()
    return {
        "id": outbox_id,
        "status": status,
        "to_email": dest,
        "effective_mode": effective_mode(runtime),
        "logged_only": runtime.provider == "log",
        "last_error": refreshed.last_error,
    }
