"""Resolve and persist display FX rate + UI money/locale prefs.

Precedence (effective rate):
  1. DB row (display_money_config id=1) if present and valid rate
  2. DISPLAY_FX_RATE from ENV if valid
  3. None → FE falls back to VND-only display

UI prefs (default currency, currency toggle, locale toggle) prefer DB row
when present; ENV is seed/fallback only. ENV never overwrites DB on restart.

Hot public reads (public_config / get_effective_rate) use a process-local
TTL cache; writers hard-invalidate so this worker sees the next read fresh.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.config import settings
from src.models.display_money_config import DisplayMoneyConfig
from src.runtime_config import ProcessConfigCache

_CONFIG_ID = 1

# Public payload cache (dict). Admin views always hit DB for env_* + metadata.
_public_cache: ProcessConfigCache[dict] = ProcessConfigCache("display_money_public")


def _rate_in_range(rate: int | None) -> bool:
    if rate is None:
        return False
    if not isinstance(rate, int) or isinstance(rate, bool):
        return False
    return settings.display_fx_rate_min <= rate <= settings.display_fx_rate_max


def env_rate() -> int | None:
    rate = settings.display_fx_rate
    return rate if _rate_in_range(rate) else None


def env_currency_default() -> str:
    default = (settings.display_currency_default or "USD").upper()
    return default if default in ("VND", "USD") else "USD"


def env_allow_user_toggle() -> bool:
    return bool(settings.display_allow_user_toggle)


def env_allow_locale_toggle() -> bool:
    return bool(settings.display_allow_locale_toggle)


def env_show_fx_hints() -> bool:
    return bool(settings.display_show_fx_hints)


async def get_config_row(db: AsyncSession) -> DisplayMoneyConfig | None:
    return await db.get(DisplayMoneyConfig, _CONFIG_ID)


def _seed_rate() -> int:
    """Rate for first-time DB seed; always a valid integer in range."""
    rate = env_rate()
    if rate is not None:
        return rate
    # Mid of allowed band if ENV is invalid — still creates a row so UI prefs can live in DB.
    return max(settings.display_fx_rate_min, min(settings.display_fx_rate_max, 25_500))


async def ensure_seeded(db: AsyncSession) -> DisplayMoneyConfig:
    """Seed singleton from ENV once if DB empty. Always returns a row.

    Concurrent first requests are safe: INSERT … ON CONFLICT DO NOTHING, then
    re-read so only one writer wins and the other sees the existing row.
    """
    row = await get_config_row(db)
    if row is not None:
        return row

    stmt = (
        pg_insert(DisplayMoneyConfig)
        .values(
            id=_CONFIG_ID,
            display_fx_rate=_seed_rate(),
            display_currency_default=env_currency_default(),
            allow_user_toggle=env_allow_user_toggle(),
            allow_locale_toggle=env_allow_locale_toggle(),
            show_fx_hints=env_show_fx_hints(),
            updated_by_id=None,
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.execute(stmt)
    await db.flush()

    row = await get_config_row(db)
    if row is None:
        # Extremely unlikely: race deleted the row mid-flight.
        raise HTTPException(status_code=500, detail="display_money_config seed failed")
    return row


def _ui_from_row(row: DisplayMoneyConfig | None) -> dict:
    if row is None:
        return {
            "display_currency_default": env_currency_default(),
            "allow_user_toggle": env_allow_user_toggle(),
            "allow_locale_toggle": env_allow_locale_toggle(),
            "show_fx_hints": env_show_fx_hints(),
        }
    default = (row.display_currency_default or "USD").upper()
    if default not in ("VND", "USD"):
        default = env_currency_default()
    return {
        "display_currency_default": default,
        "allow_user_toggle": bool(row.allow_user_toggle),
        "allow_locale_toggle": bool(row.allow_locale_toggle),
        "show_fx_hints": bool(getattr(row, "show_fx_hints", True)),
    }


def _public_payload(row: DisplayMoneyConfig) -> dict:
    rate = row.display_fx_rate if _rate_in_range(row.display_fx_rate) else env_rate()
    return {
        "ledger_currency": "VND",
        "display_fx_rate": rate,
        **_ui_from_row(row),
    }


async def get_effective_rate(db: AsyncSession) -> int | None:
    """Rate for live display and new-order snapshots (process-cached)."""
    cached = _public_cache.get()
    if cached is not None:
        rate = cached.get("display_fx_rate")
        return rate if isinstance(rate, int) else None

    row = await ensure_seeded(db)
    payload = _public_payload(row)
    _public_cache.set(payload)
    rate = payload.get("display_fx_rate")
    return rate if isinstance(rate, int) else None


async def public_config(db: AsyncSession) -> dict:
    cached = _public_cache.get()
    if cached is not None:
        return cached

    row = await ensure_seeded(db)
    # Persist first-time seed (INSERT was flushed, not committed).
    await db.commit()
    payload = _public_payload(row)
    _public_cache.set(payload)
    return payload


async def admin_config(db: AsyncSession) -> dict:
    row = await ensure_seeded(db)
    await db.commit()
    row = await get_config_row(db)

    if row is not None and _rate_in_range(row.display_fx_rate):
        source = "db"
        rate = row.display_fx_rate
    else:
        rate = env_rate()
        source = "env" if rate is not None else "none"

    ui = _ui_from_row(row)
    return {
        "ledger_currency": "VND",
        "display_fx_rate": rate,
        **ui,
        "rate_min": settings.display_fx_rate_min,
        "rate_max": settings.display_fx_rate_max,
        "env_rate": env_rate(),
        "env_currency_default": env_currency_default(),
        "env_allow_user_toggle": env_allow_user_toggle(),
        "env_allow_locale_toggle": env_allow_locale_toggle(),
        "env_show_fx_hints": env_show_fx_hints(),
        "updated_at": row.updated_at if row else None,
        "updated_by_id": row.updated_by_id if row else None,
        "source": source,
    }


def _validate_rate(rate: int) -> int:
    if not isinstance(rate, int) or isinstance(rate, bool):
        raise HTTPException(status_code=422, detail="display_fx_rate must be an integer")
    if rate <= 0:
        raise HTTPException(status_code=422, detail="display_fx_rate must be positive")
    if not _rate_in_range(rate):
        raise HTTPException(
            status_code=422,
            detail=(
                f"display_fx_rate must be between {settings.display_fx_rate_min} "
                f"and {settings.display_fx_rate_max}"
            ),
        )
    return rate


async def update_config(
    db: AsyncSession,
    *,
    actor_id: int,
    display_fx_rate: int | None = None,
    display_currency_default: str | None = None,
    allow_user_toggle: bool | None = None,
    allow_locale_toggle: bool | None = None,
    show_fx_hints: bool | None = None,
) -> dict:
    row = await ensure_seeded(db)
    old = {
        "display_fx_rate": row.display_fx_rate,
        "display_currency_default": row.display_currency_default,
        "allow_user_toggle": row.allow_user_toggle,
        "allow_locale_toggle": row.allow_locale_toggle,
        "show_fx_hints": bool(getattr(row, "show_fx_hints", True)),
    }

    if display_fx_rate is not None:
        row.display_fx_rate = _validate_rate(display_fx_rate)
    if display_currency_default is not None:
        cur = display_currency_default.upper()
        if cur not in ("VND", "USD"):
            raise HTTPException(status_code=422, detail="display_currency_default must be VND or USD")
        row.display_currency_default = cur
    if allow_user_toggle is not None:
        row.allow_user_toggle = bool(allow_user_toggle)
    if allow_locale_toggle is not None:
        row.allow_locale_toggle = bool(allow_locale_toggle)
    if show_fx_hints is not None:
        row.show_fx_hints = bool(show_fx_hints)

    row.updated_by_id = actor_id
    await db.flush()
    await log_event(
        db, "info", "Display money config updated",
        metadata={
            "event": "display_money_config_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "display_money_config",
            "subject_id": _CONFIG_ID,
            "old": old,
            "new": {
                "display_fx_rate": row.display_fx_rate,
                "display_currency_default": row.display_currency_default,
                "allow_user_toggle": row.allow_user_toggle,
                "allow_locale_toggle": row.allow_locale_toggle,
                "show_fx_hints": bool(row.show_fx_hints),
            },
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    # Hard invalidate so this worker's next public/rate read reloads from DB.
    _public_cache.invalidate()
    # Warm cache with post-write public view (same worker, zero lag).
    _public_cache.set(_public_payload(row))
    return {
        "display_fx_rate": row.display_fx_rate,
        "display_currency_default": row.display_currency_default,
        "allow_user_toggle": row.allow_user_toggle,
        "allow_locale_toggle": row.allow_locale_toggle,
        "show_fx_hints": bool(row.show_fx_hints),
        "old_rate": old["display_fx_rate"] if display_fx_rate is not None else None,
        "updated_at": row.updated_at,
        "updated_by_id": actor_id,
    }


async def set_rate(db: AsyncSession, *, rate: int, actor_id: int) -> dict:
    """Backward-compatible rate-only update."""
    return await update_config(db, actor_id=actor_id, display_fx_rate=rate)


async def reset_to_env(db: AsyncSession, *, actor_id: int) -> dict:
    """Reset FX rate only from ENV. UI prefs (default currency / switchers) stay as set."""
    rate = env_rate()
    if rate is None:
        raise HTTPException(
            status_code=400,
            detail="DISPLAY_FX_RATE is missing or out of range — cannot reset",
        )
    return await update_config(
        db,
        actor_id=actor_id,
        display_fx_rate=rate,
    )
