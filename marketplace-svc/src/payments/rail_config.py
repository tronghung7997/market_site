"""Resolve and persist deposit rail operational config (admin-tunable).

Secrets stay in env (NOW credentials / SePay webhook secret and API token).
Operational flags, limits, and the SePay destination live in
deposit_rail_config; env values are only the bootstrap/reset source.

Public methods payload is process-cached (soft TTL + hard invalidate on write)
so wallet deposit method lists avoid a DB round-trip every request.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.config import settings
from src.models.deposit_rail_config import DepositRailConfig
from src.payments import nowpayments_client, sepay_client
from src.runtime_config import ProcessConfigCache

_CONFIG_ID = 1

_public_cache: ProcessConfigCache[dict] = ProcessConfigCache("deposit_rail_public")

# Sanity bounds for admin edits
_MIN_AMOUNT_FLOOR = 1_000
_MAX_AMOUNT_CEIL = 500_000_000
_MIN_MINUTES = 5
_MAX_MINUTES = 7 * 24 * 60
_MIN_RETENTION_H = 1
_MAX_RETENTION_H = 30 * 24


def env_seed_values() -> dict:
    return {
        "sepay_enabled": True,
        "nowpayments_enabled": bool(settings.nowpayments_enabled),
        "sepay_bank_code": settings.sepay_bank_code.strip(),
        "sepay_bank_account_number": settings.sepay_bank_account_number.strip(),
        "sepay_bank_account_name": settings.sepay_bank_account_name.strip(),
        "sepay_bank_account_id": settings.sepay_bank_account_id.strip(),
        "deposit_min_amount": settings.deposit_min_amount,
        "deposit_max_amount": settings.deposit_max_amount,
        "deposit_expire_minutes": settings.deposit_expire_minutes,
        "deposit_reconcile_retention_hours": settings.deposit_reconcile_retention_hours,
        "deposit_usdt_min_vnd": settings.deposit_usdt_min_vnd,
        "deposit_usdt_max_vnd": settings.deposit_usdt_max_vnd,
        "deposit_usdt_local_window_minutes": settings.deposit_usdt_local_window_minutes,
        "deposit_usdt_reconcile_retention_hours": settings.deposit_usdt_reconcile_retention_hours,
        # Kept for DB seed/compat only; hosted checkout trusts NOW coin settings.
        "nowpayments_default_pay_currency": "usdtbsc",
        "nowpayments_allowed_pay_currencies": "usdtbsc",
    }


async def get_config_row(db: AsyncSession) -> DepositRailConfig | None:
    return await db.get(DepositRailConfig, _CONFIG_ID)


async def ensure_seeded(db: AsyncSession) -> DepositRailConfig:
    row = await get_config_row(db)
    if row is not None:
        # Existing installations predate DB-backed SePay destinations. Copy
        # env values once so the migration is safe without a manual SQL step.
        seed = env_seed_values()
        changed = False
        for key in ("sepay_bank_code", "sepay_bank_account_number", "sepay_bank_account_name", "sepay_bank_account_id"):
            if not getattr(row, key).strip() and seed[key]:
                setattr(row, key, seed[key])
                changed = True
        if changed:
            await db.flush()
        return row

    seed = env_seed_values()
    stmt = (
        pg_insert(DepositRailConfig)
        .values(id=_CONFIG_ID, updated_by_id=None, **seed)
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.execute(stmt)
    await db.flush()
    row = await get_config_row(db)
    if row is None:
        raise HTTPException(status_code=500, detail="deposit_rail_config seed failed")
    return row


def row_to_public(row: DepositRailConfig) -> dict:
    """Buyer-facing methods: admin flag AND secrets present."""
    return {
        "sepay_enabled": bool(row.sepay_enabled) and sepay_client.is_configured(
            bank_code=row.sepay_bank_code,
            account_number=row.sepay_bank_account_number,
            account_name=row.sepay_bank_account_name,
            account_id=row.sepay_bank_account_id,
        ),
        "nowpayments_enabled": bool(row.nowpayments_enabled) and nowpayments_client.is_configured(),
        "deposit_min_amount": row.deposit_min_amount,
        "deposit_max_amount": row.deposit_max_amount,
        "deposit_usdt_min_vnd": row.deposit_usdt_min_vnd,
        "deposit_usdt_max_vnd": row.deposit_usdt_max_vnd,
    }


def row_to_admin(row: DepositRailConfig) -> dict:
    seed = env_seed_values()
    return {
        **{
            "sepay_enabled": row.sepay_enabled,
            "nowpayments_enabled": row.nowpayments_enabled,
            "sepay_bank_code": row.sepay_bank_code,
            "sepay_bank_account_number": row.sepay_bank_account_number,
            "sepay_bank_account_name": row.sepay_bank_account_name,
            "sepay_bank_account_id": row.sepay_bank_account_id,
            "deposit_min_amount": row.deposit_min_amount,
            "deposit_max_amount": row.deposit_max_amount,
            "deposit_expire_minutes": row.deposit_expire_minutes,
            "deposit_reconcile_retention_hours": row.deposit_reconcile_retention_hours,
            "deposit_usdt_min_vnd": row.deposit_usdt_min_vnd,
            "deposit_usdt_max_vnd": row.deposit_usdt_max_vnd,
            "deposit_usdt_local_window_minutes": row.deposit_usdt_local_window_minutes,
            "deposit_usdt_reconcile_retention_hours": row.deposit_usdt_reconcile_retention_hours,
        },
        "sepay_secrets_configured": sepay_client.is_configured(
            bank_code=row.sepay_bank_code,
            account_number=row.sepay_bank_account_number,
            account_name=row.sepay_bank_account_name,
            account_id=row.sepay_bank_account_id,
        ),
        "sepay_reconciliation_configured": sepay_client.is_reconciliation_configured(
            bank_code=row.sepay_bank_code,
            account_number=row.sepay_bank_account_number,
            account_name=row.sepay_bank_account_name,
            account_id=row.sepay_bank_account_id,
        ),
        "nowpayments_secrets_configured": nowpayments_client.is_configured(),
        "nowpayments_reconciliation_configured": nowpayments_client.is_reconciliation_configured(),
        "effective_sepay_enabled": bool(row.sepay_enabled) and sepay_client.is_configured(
            bank_code=row.sepay_bank_code,
            account_number=row.sepay_bank_account_number,
            account_name=row.sepay_bank_account_name,
            account_id=row.sepay_bank_account_id,
        ),
        "effective_nowpayments_enabled": (
            bool(row.nowpayments_enabled) and nowpayments_client.is_configured()
        ),
        "env_seed": {
            k: v for k, v in seed.items()
            if k not in ("nowpayments_default_pay_currency", "nowpayments_allowed_pay_currencies")
        },
        "updated_at": row.updated_at,
        "updated_by_id": row.updated_by_id,
        "source": "db",
    }


async def public_methods(db: AsyncSession) -> dict:
    cached = _public_cache.get()
    if cached is not None:
        return cached

    row = await ensure_seeded(db)
    # Don't force-commit here if caller is mid-transaction; flush is enough.
    # Commit only when this is a standalone public GET.
    payload = row_to_public(row)
    _public_cache.set(payload)
    return payload


async def admin_config(db: AsyncSession) -> dict:
    row = await ensure_seeded(db)
    await db.commit()
    row = await get_config_row(db)
    assert row is not None
    return row_to_admin(row)


def _validate_positive_int(name: str, value: int, lo: int, hi: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{name} must be an integer")
    if value < lo or value > hi:
        raise HTTPException(status_code=422, detail=f"{name} must be between {lo} and {hi}")
    return value


async def update_config(db: AsyncSession, *, actor_id: int, **fields) -> dict:
    row = await ensure_seeded(db)
    old = {
        "sepay_enabled": row.sepay_enabled,
        "nowpayments_enabled": row.nowpayments_enabled,
        "sepay_bank_code": row.sepay_bank_code,
        "sepay_bank_account_number": row.sepay_bank_account_number,
        "sepay_bank_account_name": row.sepay_bank_account_name,
        "sepay_bank_account_id": row.sepay_bank_account_id,
        "deposit_min_amount": row.deposit_min_amount,
        "deposit_max_amount": row.deposit_max_amount,
        "deposit_expire_minutes": row.deposit_expire_minutes,
        "deposit_reconcile_retention_hours": row.deposit_reconcile_retention_hours,
        "deposit_usdt_min_vnd": row.deposit_usdt_min_vnd,
        "deposit_usdt_max_vnd": row.deposit_usdt_max_vnd,
        "deposit_usdt_local_window_minutes": row.deposit_usdt_local_window_minutes,
        "deposit_usdt_reconcile_retention_hours": row.deposit_usdt_reconcile_retention_hours,
    }

    # Hosted checkout network selection lives in NOWPayments coin settings.
    # Ignore legacy allowlist fields if a client still sends them.
    fields.pop("nowpayments_allowed_pay_currencies", None)
    fields.pop("nowpayments_default_pay_currency", None)

    provided = {k: v for k, v in fields.items() if v is not None}
    if not provided:
        raise HTTPException(status_code=422, detail="At least one field is required")

    if "sepay_enabled" in provided:
        row.sepay_enabled = bool(provided["sepay_enabled"])
    if "nowpayments_enabled" in provided:
        row.nowpayments_enabled = bool(provided["nowpayments_enabled"])

    for key in ("sepay_bank_code", "sepay_bank_account_number", "sepay_bank_account_name", "sepay_bank_account_id"):
        if key in provided:
            value = str(provided[key] or "").strip()
            if not value:
                raise HTTPException(status_code=422, detail=f"{key} cannot be empty")
            setattr(row, key, value)

    if "deposit_min_amount" in provided:
        row.deposit_min_amount = _validate_positive_int(
            "deposit_min_amount", provided["deposit_min_amount"], _MIN_AMOUNT_FLOOR, _MAX_AMOUNT_CEIL,
        )
    if "deposit_max_amount" in provided:
        row.deposit_max_amount = _validate_positive_int(
            "deposit_max_amount", provided["deposit_max_amount"], _MIN_AMOUNT_FLOOR, _MAX_AMOUNT_CEIL,
        )
    if row.deposit_min_amount > row.deposit_max_amount:
        raise HTTPException(status_code=422, detail="deposit_min_amount cannot exceed deposit_max_amount")

    if "deposit_expire_minutes" in provided:
        row.deposit_expire_minutes = _validate_positive_int(
            "deposit_expire_minutes", provided["deposit_expire_minutes"], _MIN_MINUTES, _MAX_MINUTES,
        )
    if "deposit_reconcile_retention_hours" in provided:
        row.deposit_reconcile_retention_hours = _validate_positive_int(
            "deposit_reconcile_retention_hours",
            provided["deposit_reconcile_retention_hours"],
            _MIN_RETENTION_H,
            _MAX_RETENTION_H,
        )

    if "deposit_usdt_min_vnd" in provided:
        row.deposit_usdt_min_vnd = _validate_positive_int(
            "deposit_usdt_min_vnd", provided["deposit_usdt_min_vnd"], _MIN_AMOUNT_FLOOR, _MAX_AMOUNT_CEIL,
        )
    if "deposit_usdt_max_vnd" in provided:
        row.deposit_usdt_max_vnd = _validate_positive_int(
            "deposit_usdt_max_vnd", provided["deposit_usdt_max_vnd"], _MIN_AMOUNT_FLOOR, _MAX_AMOUNT_CEIL,
        )
    if row.deposit_usdt_min_vnd > row.deposit_usdt_max_vnd:
        raise HTTPException(status_code=422, detail="deposit_usdt_min_vnd cannot exceed deposit_usdt_max_vnd")

    if "deposit_usdt_local_window_minutes" in provided:
        row.deposit_usdt_local_window_minutes = _validate_positive_int(
            "deposit_usdt_local_window_minutes",
            provided["deposit_usdt_local_window_minutes"],
            _MIN_MINUTES,
            _MAX_MINUTES,
        )
    if "deposit_usdt_reconcile_retention_hours" in provided:
        row.deposit_usdt_reconcile_retention_hours = _validate_positive_int(
            "deposit_usdt_reconcile_retention_hours",
            provided["deposit_usdt_reconcile_retention_hours"],
            _MIN_RETENTION_H,
            _MAX_RETENTION_H,
        )

    row.updated_by_id = actor_id
    await db.flush()
    await log_event(
        db, "info", "Deposit rail config updated",
        metadata={
            "event": "deposit_rail_config_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "deposit_rail_config",
            "subject_id": _CONFIG_ID,
            "old": old,
            "new": {
                "sepay_enabled": row.sepay_enabled,
                "nowpayments_enabled": row.nowpayments_enabled,
                "deposit_min_amount": row.deposit_min_amount,
                "deposit_max_amount": row.deposit_max_amount,
                "deposit_usdt_min_vnd": row.deposit_usdt_min_vnd,
                "deposit_usdt_max_vnd": row.deposit_usdt_max_vnd,
            },
            "outcome": "success",
            "source": "admin",
        },
    )
    await db.commit()
    await db.refresh(row)
    _public_cache.invalidate()
    _public_cache.set(row_to_public(row))
    return row_to_admin(row)


async def reset_to_env(db: AsyncSession, *, actor_id: int) -> dict:
    seed = env_seed_values()
    return await update_config(db, actor_id=actor_id, **seed)
