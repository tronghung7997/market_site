"""Daily automatic tier job (sellers and buyers) and the shared tier change.

Sellers (criteria and knobs in ``seller_trust_config``, see trust.py):

1. A tier an admin set by hand is locked (``seller_tier_state.locked``): the
   job never touches it until an admin unlocks it. ``enterprise`` is
   invitation-only and never moves automatically either.
2. Dispute rate above the current tier's ceiling, over the rolling window and
   with at least ``auto.dispute_min_orders`` orders in it → demoted at once to
   the highest lower tier whose ceiling the rate fits (no grace).
3. Any other "keep" criterion failing (1-star rate, trust score) → warned and
   put at risk; still failing ``auto.grace_days`` after the warning → demoted
   one step. Back within the criteria → the warning is cleared.
4. Otherwise, meeting every criterion of the next tier → promoted one step.

Buyers: every account's tier follows its criterion figure
(buyer_tiers.service).

The job is idempotent (it acts on the current state only, each seller under
a row lock in its own transaction), pausable like the other money jobs
(``site_status.pausable`` in main.py) and the seller half can be switched off
with ``auto.enabled``. Admins can preview it (dry run) or run it now.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.database import SessionLocal
from src.logging import current_request_id
from src.models.account import Account
from src.models.seller_tier_event import SellerTierEvent
from src.models.seller_tier_state import SellerTierState
from src.sellers import trust
from src.sellers.tiers import TIER_ORDER

logger = structlog.get_logger()

# Readable reasons stored on seller_tier_events (shown to admins and sellers).
REASONS = {
    "promote": "Tự động: đạt đủ tiêu chí hạng mới",
    "dispute_rate": "Tự động: tỷ lệ khiếu nại vượt mức tối đa của hạng",
    "grace_expired": "Tự động: không đạt tiêu chí giữ hạng sau thời gian ân hạn",
}


def _tier_value(tier) -> str:
    return tier.value if hasattr(tier, "value") else str(tier or "new")


def decide(
    tier: str,
    m: trust.Metrics,
    cfg: dict,
    *,
    locked: bool,
    at_risk_since: datetime | None,
    now: datetime,
) -> dict:
    """What the job does with one seller. Pure.

    ``action``: locked | skip | demote | warn | at_risk | promote | clear | keep.
    ``target``: the new tier for demote/promote. ``clear_risk``: drop a
    standing warning. ``keys``: the failing keep criteria."""
    out = {"action": "keep", "target": None, "reason": None, "keys": [], "clear_risk": False}
    if locked:
        return {**out, "action": "locked"}
    if tier not in TIER_ORDER or tier == "enterprise":
        return {**out, "action": "skip"}
    criteria = cfg["criteria"]

    if tier != "new" and trust.dispute_rate_counts(m, cfg):
        ceiling = criteria.get(tier, {}).get("max_dispute_pct")
        if ceiling is not None and m.dispute_pct > ceiling:
            target = "new"
            for lower in reversed(TIER_ORDER[:TIER_ORDER.index(tier)]):
                limit = criteria.get(lower, {}).get("max_dispute_pct")
                if lower == "new" or limit is None or m.dispute_pct <= limit:
                    target = lower
                    break
            return {**out, "action": "demote", "target": target, "reason": "dispute_rate",
                    "keys": ["max_dispute_pct"], "clear_risk": True}

    score = trust.trust_score(m, cfg)
    failing = [
        row["key"] for row in trust.check_criteria(tier, m, score, cfg, keep_only=True)
        if row["met"] is False and row["key"] != "max_dispute_pct"
    ] if tier in criteria else []
    if failing:
        if at_risk_since is None:
            return {**out, "action": "warn", "keys": failing}
        if now - at_risk_since >= timedelta(days=cfg["auto"]["grace_days"]):
            return {**out, "action": "demote", "target": TIER_ORDER[TIER_ORDER.index(tier) - 1],
                    "reason": "grace_expired", "keys": failing, "clear_risk": True}
        return {**out, "action": "at_risk", "keys": failing}

    result = trust.evaluate(tier, m, cfg)
    if result["eligible"]:
        return {**out, "action": "promote", "target": result["next_tier"], "reason": "promote",
                "clear_risk": at_risk_since is not None}
    if at_risk_since is not None:
        return {**out, "action": "clear", "clear_risk": True}
    return out


# ── shared tier change (admin and job) ─────────────────────────────────────

async def tier_state(db: AsyncSession, account_id: int, *, for_update: bool = False) -> SellerTierState:
    state = await db.get(SellerTierState, account_id, with_for_update=for_update)
    if state is None:
        state = SellerTierState(account_id=account_id, locked=False)
        db.add(state)
        await db.flush()
    return state


async def change_seller_tier(
    db: AsyncSession,
    account: Account,
    new_tier: str,
    *,
    reason: str | None,
    actor_id: int | None,
) -> bool:
    """Move a seller to ``new_tier``: history row, bell notification, seller
    alert and mail. Returns False when nothing changes. Never commits."""
    old_tier = _tier_value(account.seller_tier)
    if old_tier == new_tier:
        return False
    account.seller_tier = new_tier
    event = SellerTierEvent(account_id=account.id, old_tier=old_tier, new_tier=new_tier, reason=reason, actor_id=actor_id)
    db.add(event)
    await db.flush()

    from src.alerts.service import add_alert
    from src.mail.service import enqueue_mail, frontend_url
    from src.notifications.history import notify

    up = TIER_ORDER.index(new_tier) > TIER_ORDER.index(old_tier) if old_tier in TIER_ORDER else True
    await notify(
        db, account.id, "tier_changed", category="system", params={"old": old_tier, "new": new_tier}, href="/seller/tier",
    )
    await add_alert(
        db, type_="seller_tier_changed", severity="info" if up else "warning",
        target_type="seller", target_id=account.id,
        message="Gian hàng của bạn đã được nâng hạng." if up else "Hạng gian hàng của bạn đã thay đổi.",
        href="/seller/tier",
    )
    await enqueue_mail(
        db, template="seller_tier_changed", account_id=account.id,
        idempotency_key=f"seller_tier_changed:{event.id}",
        locale=account.preferred_locale or "vi",
        payload={"tier": new_tier, "old_tier": old_tier, "reason": reason or "",
                 "action_url": frontend_url(account.preferred_locale or "vi", "/seller/tier")},
    )
    return True


async def set_tier_lock(db: AsyncSession, account_id: int, *, locked: bool, actor_id: int) -> SellerTierState:
    """Admin lock/unlock of the automatic tier. Audit-logged; never commits."""
    state = await tier_state(db, account_id, for_update=True)
    before = state.locked
    state.locked = locked
    state.locked_by_id = actor_id if locked else None
    state.locked_at = datetime.now(timezone.utc) if locked else None
    if locked:
        state.at_risk_since = None
        state.at_risk_keys = None
    if before != locked:
        await log_event(
            db, "warning", f"Seller tier {'locked' if locked else 'unlocked'} for account {account_id}",
            request_id=current_request_id(),
            metadata={
                "event": "seller_tier_lock_changed", "actor_id": actor_id, "actor_type": "admin",
                "subject_type": "account", "subject_id": account_id, "old": before, "new": locked,
                "outcome": "success", "source": "admin",
            },
        )
    return state


# ── the job ─────────────────────────────────────────────────────────────────

async def _sellers(db: AsyncSession) -> list[Account]:
    return list((await db.scalars(
        select(Account).where(
            Account.is_active.is_(True), Account.roles.any("seller"),
            Account.is_seeded.is_(False), Account.is_internal.is_(False),
        ).order_by(Account.id)
    )).all())


async def _seller_row(db: AsyncSession, account: Account, cfg: dict, now: datetime) -> dict:
    state = await db.get(SellerTierState, account.id)
    m = await trust.load_metrics(account.id, db, window_days=cfg["window_days"], now=now)
    tier = _tier_value(account.seller_tier)
    decision = decide(
        tier, m, cfg, locked=bool(state and state.locked),
        at_risk_since=state.at_risk_since if state else None, now=now,
    )
    return {
        "account_id": account.id, "public_key": account.public_key, "email": account.email,
        "tier": tier, **decision, "dispute_pct": round(m.dispute_pct, 2), "orders_window": m.orders_window,
    }


async def _apply_seller(account_id: int, cfg: dict, now: datetime, actor_id: int | None) -> dict | None:
    """Re-decide and act for one seller under a row lock; own transaction."""
    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.id == account_id).with_for_update(skip_locked=True))
        if account is None:
            return None
        # set_tier_lock locks only this row: take it before deciding, so an admin
        # lock that lands mid-run is either seen here or waits for the commit.
        await tier_state(db, account_id, for_update=True)
        row = await _seller_row(db, account, cfg, now)
        action = row["action"]
        if action in ("locked", "skip", "keep"):
            state = await db.get(SellerTierState, account_id)
            if state is not None:
                state.evaluated_at = now
                await db.commit()
            return row
        state = await tier_state(db, account_id, for_update=True)
        state.evaluated_at = now
        if action in ("demote", "promote"):
            reason = REASONS[row["reason"]]
            await change_seller_tier(db, account, row["target"], reason=reason, actor_id=actor_id)
            await log_event(
                db, "warning" if action == "demote" else "info",
                f"Seller tier {action}d automatically for account {account_id}",
                metadata={
                    "event": "seller_tier_auto_changed", "actor_id": actor_id, "actor_type": "admin" if actor_id else "system",
                    "subject_type": "account", "subject_id": account_id, "old_tier": row["tier"], "new_tier": row["target"],
                    "reason": row["reason"], "keys": row["keys"], "outcome": "success", "source": "tier_job",
                },
            )
            if row["reason"] == "dispute_rate":
                # Operators' group (no-op while the ops bot is off); one per seller per day.
                from src.ops_telegram.service import enqueue_ops_message, masked_account

                await enqueue_ops_message(
                    db, "seller_tier_demoted",
                    f"Hạ hạng người bán {masked_account(account.email, account_id)}\n"
                    f"{row['tier']} → {row['target']}: khiếu nại {row['dispute_pct']}% trên {row['orders_window']} đơn",
                    dedupe_key=f"seller_tier_demoted:{account_id}:{now.date().isoformat()}",
                    level="action", link=f"/admin/accounts/{account_id}?tab=seller",
                )
        if row["clear_risk"]:
            state.at_risk_since = None
            state.at_risk_keys = None
        if action == "warn":
            state.at_risk_since = now
            state.at_risk_keys = row["keys"]
            from src.notifications.history import notify
            await notify(
                db, account_id, "tier_at_risk", category="system",
                params={"tier": row["tier"], "days": cfg["auto"]["grace_days"], "keys": row["keys"]}, href="/seller/tier",
            )
        elif action == "at_risk":
            state.at_risk_keys = row["keys"]
        await db.commit()
        return row


async def run_tier_job(*, dry_run: bool = False, actor_id: int | None = None) -> dict:
    """Evaluate (and unless ``dry_run`` apply) seller and buyer tiers."""
    from src.buyer_tiers import service as buyer_service

    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    async with SessionLocal() as db:
        cfg = await trust.get_config(db)
        sellers = await _sellers(db)
        seller_enabled = cfg["auto"]["enabled"] or actor_id is not None
        planned = [await _seller_row(db, s, cfg, now) for s in sellers] if seller_enabled else []
        buyer_changes = await buyer_service.plan_buyer_changes(db)

    rows = planned
    if not dry_run:
        rows = []
        for row in planned:
            if row["action"] in ("locked", "skip", "keep"):
                rows.append(row)
                continue
            try:
                applied = await _apply_seller(row["account_id"], cfg, now, actor_id)
                if applied is not None:
                    rows.append(applied)
            except Exception:
                logger.exception("seller_tier_job_failed", account_id=row["account_id"], run_id=run_id)
        async with SessionLocal() as db:
            await buyer_service.apply_buyer_changes(
                db, buyer_changes, actor_id=actor_id,
                reason="Tự động: cập nhật hạng theo tiêu chí" if actor_id is None else "Admin chạy xét hạng",
            )

    def count(action: str) -> int:
        return sum(1 for r in rows if r["action"] == action)

    summary = {
        "run_id": run_id,
        "dry_run": dry_run,
        "ran_at": now,
        "seller_auto_enabled": cfg["auto"]["enabled"],
        "sellers": {
            "checked": len(rows), "promoted": count("promote"), "demoted": count("demote"),
            "warned": count("warn"), "at_risk": count("at_risk"), "locked": count("locked"),
        },
        "seller_changes": [
            {k: r[k] for k in ("account_id", "public_key", "email", "tier", "action", "target", "reason", "keys",
                               "dispute_pct", "orders_window")}
            for r in rows if r["action"] in ("promote", "demote", "warn", "at_risk", "clear")
        ],
        "buyers": {"changed": len(buyer_changes)},
        "buyer_changes": buyer_changes[:500],
    }
    if not dry_run:
        async with SessionLocal() as db:
            await log_event(
                db, "info", "Tier job ran",
                request_id=current_request_id(),
                metadata={
                    "event": "tier_job_run", "run_id": run_id, "actor_id": actor_id,
                    "actor_type": "admin" if actor_id else "system",
                    "sellers": summary["sellers"], "buyers": summary["buyers"],
                    "outcome": "success", "source": "admin" if actor_id else "scheduler",
                },
            )
            await db.commit()
        logger.info("tier_job_ran", run_id=run_id, **summary["sellers"], buyers_changed=len(buyer_changes))
    return summary


async def tier_job() -> None:
    """Scheduler entry point (daily 03:00 Asia/Ho_Chi_Minh)."""
    await run_tier_job()
