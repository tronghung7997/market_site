"""Vô hiệu hoá account demo (email chứa cả dxtrade + example).

Dùng chung CLI (scripts/purge_demo_accounts.py) và one-shot HTTP
POST /internal/ops/purge-demo-accounts.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account
from src.models.alert import Alert

# Marker "đã chạy xong" — tồn tại row fingerprint này thì HTTP one-shot 410 mãi.
DONE_FINGERPRINT = "ops:one_shot:purge_demo_accounts"
DONE_ALERT_TYPE = "ops_one_shot_done"

_EMAIL_HAS_DXTRADE = Account.email.ilike("%dxtrade%")
_EMAIL_HAS_EXAMPLE = Account.email.ilike("%example%")

# pg_advisory_xact_lock key — tránh 2 curl song song cùng apply.
_ADVISORY_LOCK_KEY = 0x70757267  # 'purg'


@dataclass
class PurgeResult:
    status: str  # dry_run | applied | aborted_no_admin | empty
    accounts: list[dict]
    message: str


def _account_row(a: Account) -> dict:
    return {
        "id": a.id,
        "email": a.email,
        "roles": list(a.roles or []),
        "is_active": a.is_active,
    }


async def already_done(db: AsyncSession) -> bool:
    """True nếu one-shot đã apply thành công trước đó (kể cả alert đã dismiss)."""
    row = await db.scalar(
        select(Alert.id).where(Alert.fingerprint == DONE_FINGERPRINT).limit(1)
    )
    return row is not None


async def mark_done(db: AsyncSession, *, purged_ids: list[int]) -> None:
    """Ghi marker one-shot trong cùng transaction với purge — không commit."""
    now = datetime.now(timezone.utc)
    db.add(
        Alert(
            type=DONE_ALERT_TYPE,
            severity="info",
            target_type="ops",
            target_id=0,
            message=(
                f"One-shot purge_demo_accounts đã chạy — vô hiệu hoá "
                f"{len(purged_ids)} account demo: {purged_ids}"
            ),
            fingerprint=DONE_FINGERPRINT,
            is_active=True,
            first_seen_at=now,
            last_seen_at=now,
            occurrence_count=1,
        )
    )


async def purge_demo_accounts(
    db: AsyncSession,
    *,
    apply: bool,
    hard: bool = False,
    force: bool = False,
    mark_one_shot: bool = False,
) -> PurgeResult:
    """Soft-disable (hoặc hard-delete) account demo.

    Không commit — caller commit. `mark_one_shot=True` ghi DONE_FINGERPRINT
    trong cùng transaction (chỉ khi apply soft/hard thành công).
    """
    await db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _ADVISORY_LOCK_KEY})

    matches = list(
        (
            await db.execute(
                select(Account)
                .where(_EMAIL_HAS_DXTRADE, _EMAIL_HAS_EXAMPLE)
                .order_by(Account.id)
            )
        ).scalars()
    )
    rows = [_account_row(a) for a in matches]

    if not matches:
        return PurgeResult(
            status="empty",
            accounts=[],
            message="Không có account nào khớp email chứa cả 'dxtrade' và 'example'.",
        )

    remaining_admins = await db.scalar(
        select(func.count(Account.id)).where(
            Account.is_active.is_(True),
            Account.roles.any("admin"),
            ~(_EMAIL_HAS_DXTRADE & _EMAIL_HAS_EXAMPLE),
        )
    ) or 0
    match_has_admin = any("admin" in (a.roles or []) for a in matches)
    would_orphan_admin = match_has_admin and remaining_admins == 0 and not force

    if not apply:
        mode = "hard-delete" if hard else "soft-disable"
        msg = f"DRY RUN — {len(matches)} account, chưa ghi DB. apply=true để {mode}."
        if would_orphan_admin:
            msg += (
                " CẢNH BÁO: apply sẽ ABORT vì không còn admin active nào khác "
                "(tạo admin thật trước, hoặc force=true)."
            )
        return PurgeResult(status="dry_run", accounts=rows, message=msg)

    if would_orphan_admin:
        return PurgeResult(
            status="aborted_no_admin",
            accounts=rows,
            message=(
                "ABORT: sau khi purge sẽ không còn admin active nào khác. "
                "Tạo admin thật trước, hoặc force=true nếu cố ý."
            ),
        )

    purged_ids = [a.id for a in matches]
    if hard:
        for a in matches:
            await db.delete(a)
    else:
        for a in matches:
            a.is_active = False
            a.roles = ["buyer"]
            a.email = f"purged+{a.id}@invalid.local"
            a.password_hash = "!"

    if mark_one_shot:
        await mark_done(db, purged_ids=purged_ids)

    # Refresh row snapshot after mutation (hard-delete → empty emails gone).
    after = (
        [{"id": i, "email": f"purged+{i}@invalid.local", "roles": ["buyer"], "is_active": False}
         for i in purged_ids]
        if not hard
        else [{"id": i, "deleted": True} for i in purged_ids]
    )
    return PurgeResult(
        status="applied",
        accounts=after,
        message=(
            f"APPLIED {'hard-delete' if hard else 'soft-disable'}: "
            f"{len(purged_ids)} account(s)."
        ),
    )
