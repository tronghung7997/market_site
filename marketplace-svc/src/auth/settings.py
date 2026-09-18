"""Admin-tunable sign-up policy (singleton row, process-cached).

`EMAIL_VERIFICATION_REQUIRED` in env only seeds the first row; admin edits
live in `auth_runtime_config` (Settings › Accounts).
"""
from __future__ import annotations

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.config import settings
from src.logging import current_request_id
from src.models.auth_runtime_config import AuthRuntimeConfig
from src.runtime_config import ProcessConfigCache

_CONFIG_ID = 1
VERIFICATION_LINK_HOURS_RANGE = (1, 168)
_EDITABLE = ("require_email_verification", "verification_link_hours")

_cache: ProcessConfigCache[dict] = ProcessConfigCache("auth_runtime")


def _payload(row: AuthRuntimeConfig) -> dict:
    return {
        "require_email_verification": bool(row.require_email_verification),
        "verification_link_hours": int(row.verification_link_hours),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by_id": row.updated_by_id,
    }


async def ensure_seeded(db: AsyncSession) -> AuthRuntimeConfig:
    row = await db.get(AuthRuntimeConfig, _CONFIG_ID)
    if row is not None:
        return row
    await db.execute(
        pg_insert(AuthRuntimeConfig)
        .values(id=_CONFIG_ID, require_email_verification=bool(settings.email_verification_required))
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.flush()
    row = await db.get(AuthRuntimeConfig, _CONFIG_ID)
    assert row is not None
    return row


async def get_auth_settings(db: AsyncSession) -> dict:
    cached = _cache.get()
    if cached is not None:
        return cached
    payload = _payload(await ensure_seeded(db))
    _cache.set(payload)
    return payload


async def email_verification_required(db: AsyncSession) -> bool:
    return bool((await get_auth_settings(db))["require_email_verification"])


async def verification_link_hours(db: AsyncSession) -> int:
    return int((await get_auth_settings(db))["verification_link_hours"])


async def update_auth_settings(
    db: AsyncSession,
    *,
    actor_id: int,
    require_email_verification: bool | None = None,
    verification_link_hours: int | None = None,
) -> dict:
    row = await ensure_seeded(db)
    old = _payload(row)
    if require_email_verification is not None:
        row.require_email_verification = bool(require_email_verification)
    if verification_link_hours is not None:
        low, high = VERIFICATION_LINK_HOURS_RANGE
        if not (low <= verification_link_hours <= high):
            raise ValueError(f"verification_link_hours must be between {low} and {high}")
        row.verification_link_hours = int(verification_link_hours)
    row.updated_by_id = actor_id
    new = {k: getattr(row, k) for k in _EDITABLE}
    await db.flush()
    await log_event(
        db, "info", "Auth runtime config updated",
        request_id=current_request_id(),
        metadata={
            "event": "auth_runtime_config_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "auth_runtime_config",
            "subject_id": _CONFIG_ID,
            "old": {k: old[k] for k in _EDITABLE},
            "new": new,
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    _cache.invalidate()
    return _payload(row)
