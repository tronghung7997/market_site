"""Application interface for AI text generation.

Owns everything that must be consistent no matter which feature is calling:
provider resolution, the kill-switch, the daily token ceiling, prompt
rendering from the admin-editable catalog, and spend logging.

Feature code calls :func:`run_task` and never imports an adapter.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import Integer, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.ai.defaults import PROMPT_CATALOG, default_prompt
from src.ai.gemini import GeminiAdapter
from src.ai.mock import MockAiAdapter
from src.ai.openai_compatible import OpenAiCompatibleAdapter
from src.ai.port import AiError, AiProviderSettings, AiRequest, AiResult, AiTextPort
from src.ai.tasks import is_known_task
from src.audit.service import log_event
from src.config import settings as app_settings
from src.models.ai_config import AiPromptTemplate, AiProviderConfig, AiUsageLog
from src.runtime_config import ProcessConfigCache
from src.security.crypto import decrypt_str, encrypt_str

logger = structlog.get_logger()

_CONFIG_ID = 1
_config_cache: ProcessConfigCache[dict] = ProcessConfigCache("ai_provider_config")

_ADAPTERS: dict[str, AiTextPort] = {
    "gemini_native": GeminiAdapter(),
    "openai_compatible": OpenAiCompatibleAdapter(),
}

# Verified-good defaults, used when the singleton row is missing entirely.
DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-flash-lite-latest"
DEFAULT_FALLBACKS = ["gemini-3.1-flash-lite", "gemini-3-flash-preview"]


def _adapter_for(provider_kind: str) -> AiTextPort:
    # The suite must never depend on a live vendor or an API key.
    if app_settings.deployment_environment == "test":
        return MockAiAdapter()
    adapter = _ADAPTERS.get(provider_kind)
    if adapter is None:
        raise AiError("upstream_error", f"Nhà cung cấp AI không hỗ trợ: {provider_kind}")
    return adapter


async def ensure_seeded(db: AsyncSession) -> AiProviderConfig:
    row = await db.get(AiProviderConfig, _CONFIG_ID)
    if row is not None:
        return row
    await db.execute(
        pg_insert(AiProviderConfig)
        .values(
            id=_CONFIG_ID,
            provider_kind="gemini_native",
            base_url=DEFAULT_BASE_URL,
            model=DEFAULT_MODEL,
            fallback_models=DEFAULT_FALLBACKS,
            temperature=1.15,
            is_enabled=False,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.flush()
    row = await db.get(AiProviderConfig, _CONFIG_ID)
    assert row is not None
    return row


def _admin_payload(row: AiProviderConfig) -> dict:
    """Admin-visible config. The API key is never returned — only whether one
    is stored, exactly like the mail provider secrets."""
    return {
        "provider_kind": row.provider_kind,
        "base_url": row.base_url,
        "model": row.model,
        "fallback_models": list(row.fallback_models or []),
        "api_key_configured": bool(row.api_key_encrypted),
        "temperature": row.temperature,
        "timeout_seconds": row.timeout_seconds,
        "max_retries": row.max_retries,
        "daily_token_budget": row.daily_token_budget,
        "is_enabled": row.is_enabled,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by_id": row.updated_by_id,
    }


async def admin_config(db: AsyncSession) -> dict:
    row = await ensure_seeded(db)
    await db.commit()
    return _admin_payload(row)


async def update_config(db: AsyncSession, *, actor_id: int, changes: dict[str, Any]) -> dict:
    """Apply a partial update. ``api_key`` is write-only: a non-empty string
    replaces the stored secret, an empty string clears it, absence keeps it."""
    row = await ensure_seeded(db)
    tracked = ("provider_kind", "base_url", "model", "fallback_models", "temperature",
               "timeout_seconds", "max_retries", "daily_token_budget", "is_enabled")
    old = {k: getattr(row, k) for k in tracked}

    for field in tracked:
        if field in changes and changes[field] is not None:
            setattr(row, field, changes[field])

    key_changed = False
    if "api_key" in changes and changes["api_key"] is not None:
        raw = str(changes["api_key"]).strip()
        row.api_key_encrypted = encrypt_str(raw) if raw else None
        key_changed = True

    row.updated_by_id = actor_id
    await db.flush()

    new = {k: getattr(row, k) for k in tracked}
    await log_event(
        db, "warning", "AI provider config updated",
        metadata={
            "event": "ai_provider_config_changed",
            "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "ai_provider_config", "subject_id": _CONFIG_ID,
            # Never log the key itself, only that it moved.
            "old": old, "new": new, "api_key_changed": key_changed,
            "outcome": "success", "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    _config_cache.invalidate()
    return _admin_payload(row)


async def _resolve_settings(db: AsyncSession) -> AiProviderSettings:
    row = await ensure_seeded(db)
    if not row.is_enabled:
        raise AiError("disabled", "Tính năng AI đang tắt")

    api_key = ""
    if row.api_key_encrypted:
        try:
            api_key = decrypt_str(row.api_key_encrypted)
        except Exception as exc:  # noqa: BLE001 - key rotation leaves unreadable values
            raise AiError("not_configured", "Không giải mã được API key AI") from exc

    return AiProviderSettings(
        provider_kind=row.provider_kind,
        base_url=row.base_url,
        model=row.model,
        api_key=api_key,
        fallback_models=tuple(row.fallback_models or ()),
        temperature=row.temperature,
        timeout_seconds=row.timeout_seconds,
        max_retries=row.max_retries,
    )


async def _check_budget(db: AsyncSession, provider: AiProviderConfig) -> None:
    if not provider.daily_token_budget:
        return
    since = datetime.now(timezone.utc) - timedelta(days=1)
    spent = await db.scalar(
        select(func.coalesce(func.sum(AiUsageLog.prompt_tokens + AiUsageLog.completion_tokens), 0))
        .where(AiUsageLog.created_at >= since, AiUsageLog.ok.is_(True))
    )
    if int(spent or 0) >= provider.daily_token_budget:
        raise AiError(
            "budget_exceeded",
            f"Đã dùng hết hạn mức {provider.daily_token_budget} token trong 24 giờ",
        )


async def get_prompt(db: AsyncSession, task: str, locale: str) -> tuple[str, str]:
    """(system_prompt, user_prompt) for a task, admin edits taking precedence.

    Falls back to the Vietnamese row, then to the code catalog, so generation
    still works when the table is empty (fresh test database, or a release that
    adds a task ahead of its data migration).
    """
    row = await db.get(AiPromptTemplate, (task, locale))
    if row is None and locale != "vi":
        row = await db.get(AiPromptTemplate, (task, "vi"))
    if row is not None:
        return row.system_prompt, row.user_prompt

    fallback = default_prompt(task, locale)
    if fallback is None:
        raise AiError("upstream_error", f"Chưa có mẫu prompt cho tác vụ {task}/{locale}")
    return fallback


async def run_task(
    db: AsyncSession,
    *,
    task: str,
    context: dict[str, Any],
    schema: dict[str, Any] | None = None,
    locale: str = "vi",
    actor_id: int | None = None,
    system_override: str | None = None,
    user_override: str | None = None,
    temperature: float | None = None,
) -> AiResult:
    """Render the task prompt, call the configured provider, log the spend.

    ``*_override`` let an admin supply a free-form prompt for one call without
    editing the saved template. Usage is recorded on both success and failure
    in its own committed transaction, so a failed generation still shows up in
    spend and diagnostics.
    """
    if not is_known_task(task):
        raise AiError("upstream_error", f"Tác vụ AI không hợp lệ: {task}")

    provider = await ensure_seeded(db)
    provider_kind = provider.provider_kind
    provider_settings = await _resolve_settings(db)
    await _check_budget(db, provider)

    if user_override:
        system_prompt = (system_override or "").strip()
        user_prompt = user_override
    else:
        template_system, template_user = await get_prompt(db, task, locale)
        system_prompt = (system_override or template_system).strip()
        try:
            user_prompt = template_user.format(**context)
        except KeyError as exc:
            raise AiError("upstream_error", f"Mẫu prompt thiếu biến {exc}") from exc

    request = AiRequest(
        task=task,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        schema=schema,
        temperature=temperature,
    )

    adapter = _adapter_for(provider_kind)
    try:
        result = await adapter.complete(request, provider_settings)
    except AiError as exc:
        await _record_usage(
            db, task=task, provider_kind=provider_kind, model=provider_settings.model,
            actor_id=actor_id, ok=False, error_kind=exc.kind,
        )
        raise

    await _record_usage(
        db, task=task, provider_kind=provider_kind, model=result.model,
        actor_id=actor_id, ok=True, result=result,
    )
    return result


async def _record_usage(
    db: AsyncSession,
    *,
    task: str,
    provider_kind: str,
    model: str,
    actor_id: int | None,
    ok: bool,
    result: AiResult | None = None,
    error_kind: str | None = None,
) -> None:
    db.add(AiUsageLog(
        task=task, provider_kind=provider_kind, model=model,
        used_fallback=bool(result and result.used_fallback),
        prompt_tokens=result.prompt_tokens if result else 0,
        completion_tokens=result.completion_tokens if result else 0,
        latency_ms=result.latency_ms if result else 0,
        ok=ok, error_kind=error_kind, actor_id=actor_id,
    ))
    await db.commit()


async def test_connection(db: AsyncSession, *, actor_id: int) -> dict:
    """Admin "Test connection" button: one real, minimal call.

    Reports which model actually answered — the configured one or a fallback —
    because that difference is the early warning that a default has been
    retired or is being throttled.
    """
    provider = await ensure_seeded(db)
    provider_settings = await _resolve_settings(db)
    adapter = _adapter_for(provider.provider_kind)
    request = AiRequest(
        task="connection_test",
        system_prompt="Trả lời đúng một từ.",
        user_prompt="Trả lời đúng chữ: ok",
        temperature=0,
        max_output_tokens=16,
    )
    try:
        result = await adapter.complete(request, provider_settings)
    except AiError as exc:
        return {"ok": False, "error_kind": exc.kind, "message": str(exc),
                "model": None, "latency_ms": None, "used_fallback": False}
    return {
        "ok": True, "error_kind": None, "message": result.text.strip()[:200],
        "model": result.model, "latency_ms": result.latency_ms,
        "used_fallback": result.used_fallback,
    }


async def list_prompts(db: AsyncSession) -> list[dict]:
    """Every task in the catalog, showing the stored row where one exists and
    the code default otherwise — so the console never hides an editable task
    just because its row has not been written yet."""
    rows = (await db.execute(
        select(AiPromptTemplate).order_by(AiPromptTemplate.task, AiPromptTemplate.locale)
    )).scalars().all()
    stored = {(r.task, r.locale): r for r in rows}

    out: list[dict] = []
    for (task, locale), (system_prompt, user_prompt) in sorted(PROMPT_CATALOG.items()):
        row = stored.get((task, locale))
        out.append({
            "task": task, "locale": locale,
            "system_prompt": row.system_prompt if row else system_prompt,
            "user_prompt": row.user_prompt if row else user_prompt,
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
            "updated_by_id": row.updated_by_id if row else None,
        })
    return out


async def update_prompt(
    db: AsyncSession, *, task: str, locale: str, system_prompt: str, user_prompt: str, actor_id: int,
) -> dict:
    """Edit copy for an existing task. Unknown task ids are rejected so the
    catalog cannot grow orphans from the UI."""
    if not is_known_task(task):
        raise AiError("upstream_error", f"Tác vụ AI không hợp lệ: {task}")
    row = await db.get(AiPromptTemplate, (task, locale))
    if row is None:
        # First edit of a catalog task whose row was never materialised.
        if default_prompt(task, locale) is None:
            raise AiError("upstream_error", f"Chưa có mẫu prompt {task}/{locale}")
        row = AiPromptTemplate(task=task, locale=locale, system_prompt=system_prompt, user_prompt=user_prompt)
        db.add(row)
    row.system_prompt = system_prompt
    row.user_prompt = user_prompt
    row.updated_by_id = actor_id
    await db.flush()
    await log_event(
        db, "info", "AI prompt template updated",
        metadata={
            "event": "ai_prompt_template_changed", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "ai_prompt_template", "subject_id": 0,
            "task": task, "locale": locale, "outcome": "success", "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    return {
        "task": row.task, "locale": row.locale,
        "system_prompt": row.system_prompt, "user_prompt": row.user_prompt,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by_id": row.updated_by_id,
    }


async def tokens_used_today(db: AsyncSession) -> int:
    """Successful tokens over the trailing 24h — the same window the budget
    check uses, so the console shows the number that actually gates calls."""
    since = datetime.now(timezone.utc) - timedelta(days=1)
    return int(await db.scalar(
        select(func.coalesce(func.sum(AiUsageLog.prompt_tokens + AiUsageLog.completion_tokens), 0))
        .where(AiUsageLog.created_at >= since, AiUsageLog.ok.is_(True))
    ) or 0)


async def usage_summary(db: AsyncSession, *, days: int = 7) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (await db.execute(
        select(
            AiUsageLog.task,
            func.count().label("calls"),
            func.coalesce(func.sum(AiUsageLog.prompt_tokens + AiUsageLog.completion_tokens), 0).label("tokens"),
            func.coalesce(func.sum(func.cast(~AiUsageLog.ok, Integer)), 0).label("failures"),
        )
        .where(AiUsageLog.created_at >= since)
        .group_by(AiUsageLog.task)
    )).all()
    provider = await ensure_seeded(db)
    return {
        "days": days,
        "items": [
            {"task": r.task, "calls": int(r.calls), "tokens": int(r.tokens), "failures": int(r.failures)}
            for r in rows
        ],
        "daily_token_budget": provider.daily_token_budget,
        "tokens_used_today": await tokens_used_today(db),
    }
