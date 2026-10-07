"""Admin-tunable fee / escrow / withdrawal rules (singleton row, process-cached).

`PLATFORM_FEE_PERCENT` in env only seeds the first row; every later change
happens in Settings › Fees & holds and lands in the audit log with old → new.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.config import settings
from src.logging import current_request_id
from src.models.account import Account
from src.models.category import Category
from src.models.fee_runtime_config import FeeRuntimeConfig
from src.runtime_config import ProcessConfigCache

_CONFIG_ID = 1
PERCENT_RANGE = (0.0, 100.0)
DAYS_RANGE = (0, 90)
AMOUNT_RANGE = (0, 1_000_000_000)
_EDITABLE = (
    "platform_fee_percent", "category_fee_percent", "escrow_default_days", "escrow_min_days",
    "category_escrow_min_days", "withdraw_min_amount", "withdraw_fee_fixed", "withdraw_fee_percent",
    "dispute_seller_response_hours", "dispute_evidence_image_required", "platform_account_id",
)
DEFAULT_PLATFORM_ACCOUNT_ID = 1
HOURS_RANGE = (0, 720)

_cache: ProcessConfigCache[dict] = ProcessConfigCache("fee_runtime")


def _int_keyed(raw: dict | None) -> dict[int, float]:
    # JSON object keys are strings; callers look up by category id.
    out: dict[int, float] = {}
    for k, v in (raw or {}).items():
        try:
            out[int(k)] = float(v)
        except (TypeError, ValueError):
            continue
    return out


def _payload(row: FeeRuntimeConfig) -> dict:
    return {
        "platform_fee_percent": float(row.platform_fee_percent),
        "category_fee_percent": {str(k): v for k, v in _int_keyed(row.category_fee_percent).items()},
        "escrow_default_days": int(row.escrow_default_days),
        "escrow_min_days": int(row.escrow_min_days),
        "category_escrow_min_days": {str(k): int(v) for k, v in _int_keyed(row.category_escrow_min_days).items()},
        "withdraw_min_amount": int(row.withdraw_min_amount),
        "withdraw_fee_fixed": int(row.withdraw_fee_fixed),
        "withdraw_fee_percent": float(row.withdraw_fee_percent),
        "dispute_seller_response_hours": int(row.dispute_seller_response_hours),
        "dispute_evidence_image_required": bool(row.dispute_evidence_image_required),
        "platform_account_id": int(row.platform_account_id or DEFAULT_PLATFORM_ACCOUNT_ID),
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "updated_by_id": row.updated_by_id,
    }


async def ensure_seeded(db: AsyncSession) -> FeeRuntimeConfig:
    row = await db.get(FeeRuntimeConfig, _CONFIG_ID)
    if row is not None:
        return row
    await db.execute(
        pg_insert(FeeRuntimeConfig)
        .values(
            id=_CONFIG_ID, platform_fee_percent=float(settings.platform_fee_percent),
            dispute_seller_response_hours=int(settings.dispute_seller_response_hours),
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )
    await db.flush()
    row = await db.get(FeeRuntimeConfig, _CONFIG_ID)
    assert row is not None
    return row


async def get_fee_settings(db: AsyncSession) -> dict:
    async def load() -> dict:
        return _payload(await ensure_seeded(db))

    # Single flight: concurrent misses after a TTL expiry share one read.
    return await _cache.get_or_load(load)


async def platform_account_id(db: AsyncSession) -> int:
    """Account whose wallet books platform fees (order + withdrawal)."""
    return int((await get_fee_settings(db))["platform_account_id"])


async def platform_account_candidates(db: AsyncSession) -> list[dict]:
    """Active admin accounts that may receive platform fees."""
    rows = (await db.execute(
        select(Account.id, Account.email)
        .where(Account.is_active.is_(True), Account.roles.any("admin"))
        .order_by(Account.id)
    )).all()
    return [{"id": r.id, "email": r.email} for r in rows]


def _check(name: str, value: float, bounds: tuple[float, float]) -> None:
    low, high = bounds
    if not (low <= value <= high):
        raise ValueError(f"{name} must be between {low:g} and {high:g}")


def _check_map(name: str, raw: dict, bounds: tuple[float, float], *, integer: bool) -> dict[str, float | int]:
    clean: dict[str, float | int] = {}
    for key, value in raw.items():
        try:
            cid = int(key)
            num = int(value) if integer else float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name}: invalid entry {key!r}: {value!r}") from exc
        _check(f"{name}[{cid}]", num, bounds)
        clean[str(cid)] = num
    return clean


async def _change_labels(db: AsyncSession, changed: dict) -> dict:
    """Category names for the per-category maps that changed in this save."""
    ids: set[int] = set()
    for key in ("category_fee_percent", "category_escrow_min_days"):
        if key in changed:
            for side in changed[key]:
                ids.update(int(cid) for cid in (side or {}))
    if not ids:
        return {}
    rows = (await db.execute(select(Category.id, Category.name).where(Category.id.in_(ids)))).all()
    return {"categories": {str(r.id): r.name for r in rows}}


async def update_fee_settings(
    db: AsyncSession,
    *,
    actor_id: int,
    platform_fee_percent: float | None = None,
    category_fee_percent: dict | None = None,
    escrow_default_days: int | None = None,
    escrow_min_days: int | None = None,
    category_escrow_min_days: dict | None = None,
    withdraw_min_amount: int | None = None,
    withdraw_fee_fixed: int | None = None,
    withdraw_fee_percent: float | None = None,
    dispute_seller_response_hours: int | None = None,
    dispute_evidence_image_required: bool | None = None,
    platform_account_id: int | None = None,
) -> dict:
    row = await ensure_seeded(db)
    old = _payload(row)
    # Look up before mutating `row`: a query would autoflush it and expire
    # the server-generated `updated_at`, which async cannot lazy-load.
    fee_account = None
    if platform_account_id is not None:
        fee_account = await db.get(Account, int(platform_account_id))
        if fee_account is None or not fee_account.is_active or "admin" not in (fee_account.roles or []):
            raise ValueError("platform_account_id must be an active admin account")
    if platform_fee_percent is not None:
        _check("platform_fee_percent", platform_fee_percent, PERCENT_RANGE)
        row.platform_fee_percent = float(platform_fee_percent)
    if category_fee_percent is not None:
        row.category_fee_percent = _check_map("category_fee_percent", category_fee_percent, PERCENT_RANGE, integer=False)
    if escrow_default_days is not None:
        _check("escrow_default_days", escrow_default_days, DAYS_RANGE)
        row.escrow_default_days = int(escrow_default_days)
    if escrow_min_days is not None:
        _check("escrow_min_days", escrow_min_days, DAYS_RANGE)
        row.escrow_min_days = int(escrow_min_days)
    if category_escrow_min_days is not None:
        row.category_escrow_min_days = _check_map("category_escrow_min_days", category_escrow_min_days, DAYS_RANGE, integer=True)
    if withdraw_min_amount is not None:
        _check("withdraw_min_amount", withdraw_min_amount, AMOUNT_RANGE)
        row.withdraw_min_amount = int(withdraw_min_amount)
    if withdraw_fee_fixed is not None:
        _check("withdraw_fee_fixed", withdraw_fee_fixed, AMOUNT_RANGE)
        row.withdraw_fee_fixed = int(withdraw_fee_fixed)
    if withdraw_fee_percent is not None:
        _check("withdraw_fee_percent", withdraw_fee_percent, PERCENT_RANGE)
        row.withdraw_fee_percent = float(withdraw_fee_percent)
    if dispute_seller_response_hours is not None:
        _check("dispute_seller_response_hours", dispute_seller_response_hours, HOURS_RANGE)
        row.dispute_seller_response_hours = int(dispute_seller_response_hours)
    if dispute_evidence_image_required is not None:
        row.dispute_evidence_image_required = bool(dispute_evidence_image_required)
    if fee_account is not None:
        row.platform_account_id = fee_account.id
    row.updated_by_id = actor_id
    # Read the editable fields before flush: `updated_at` is server-generated
    # (onupdate) and expires on flush, which an async session cannot lazy-load.
    new = {k: v for k, v in _payload(row).items() if k in _EDITABLE}
    changed = {k: [old[k], new[k]] for k in _EDITABLE if old[k] != new[k]}
    await db.flush()
    labels = await _change_labels(db, changed)
    await log_event(
        db, "warning" if changed else "info", "Fee runtime config updated",
        request_id=current_request_id(),
        metadata={
            "event": "fee_runtime_config_changed",
            "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "fee_runtime_config", "subject_id": _CONFIG_ID,
            "old": {k: old[k] for k in _EDITABLE}, "new": {k: new[k] for k in _EDITABLE}, "changed": changed,
            # Names at the time of the change, so the log reads "Proxy: 5 % → 7 %"
            # even after a category is renamed or deleted.
            **({"labels": labels} if labels else {}),
            "outcome": "success", "source": "admin",
        },
    )
    await db.commit()
    _cache.invalidate()
    await db.refresh(row)
    return _payload(row)
