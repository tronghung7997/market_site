"""Two-step approval (maker-checker) for admin settings.

``submit_change`` is what every settings PATCH calls. With
``CONFIG_APPROVAL_REQUIRED`` off it applies the change at once (the legacy
contract). With it on (the default) it

1. validates the whole payload by running the section's own update function
   with ``dry_run=True`` inside a savepoint (invalid input → 422, nothing kept);
2. applies the section's immediate fields at once (maintenance mode and the
   money freezes: the emergency path), audit-flagged;
3. stores everything else as a pending ``config_change_requests`` row with the
   before → after diff and a fingerprint of the section, and tells the other
   admins.

A different admin approves (same update function, one transaction with the
request's status change; refused with 409 if the section changed since the
request was made) or rejects; only the requester may cancel. Requests lapse
after ``CONFIG_CHANGE_EXPIRY_DAYS`` (checked lazily on every read/write).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.alerts.service import add_alert
from src.audit.service import log_event
from src.config import settings
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.logging import current_request_id
from src.models.account import Account
from src.models.alert import Alert
from src.models.config_change_request import ConfigChangeRequest

from . import sections as _sections  # noqa: F401  (registers the built-in sections)
from .registry import ConfigSection, SnapshotFn, SubmitOutcome, get_section, version_of

PENDING = "pending"
REASON_MIN = 3
NOTE_MAX = 1000
ALERT_TYPE = "config_change_pending"


def approval_required() -> bool:
    return bool(settings.config_approval_required)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _section(key: str) -> ConfigSection:
    section = get_section(key)
    if section is None:
        raise ValueError(f"unknown config section {key!r}")
    return section


def _fingerprint(request_id: int) -> str:
    return f"config_change:{request_id}:pending"


# ── validation through the section's own update function ────────────────────

async def _dry_run(
    db: AsyncSession, section: ConfigSection, actor_id: int, part: dict, *, snapshot: SnapshotFn | None = None,
) -> tuple[dict, dict]:
    """(snapshot before, snapshot the change would produce). Raises what the
    update function raises for invalid input; nothing is kept either way."""
    snapshot = snapshot or section.snapshot
    changes = section.parse(part)
    before = await snapshot(db)
    savepoint = await db.begin_nested()
    try:
        await section.apply(db, actor_id, changes, True)
        await db.flush()
        after = await snapshot(db)
    finally:
        await savepoint.rollback()
    return before, after


async def _lock_section(db: AsyncSession, key: str) -> None:
    """Serialise request creation and approval per section (transaction-scoped)."""
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"config_approval:{key}"})


async def _pending_exists(db: AsyncSession, key: str) -> bool:
    return bool(await db.scalar(
        select(func.count(ConfigChangeRequest.id))
        .where(ConfigChangeRequest.section == key, ConfigChangeRequest.status == PENDING)
    ))


async def _audit(db: AsyncSession, level: str, event: str, req: ConfigChangeRequest, section: ConfigSection | None,
                 *, actor_id: int | None, extra: dict | None = None) -> None:
    await log_event(
        db, level, f"Config change {event.removeprefix('config_change_')}",
        request_id=current_request_id(),
        metadata={
            "event": event,
            "actor_id": actor_id, "actor_type": "admin" if actor_id else "system",
            "subject_type": "config_change_request", "subject_id": req.id,
            "section": req.section,
            "section_label": section.label if section else req.section,
            # The section's own audit event, so the log renders the diff with the
            # same labels as the settings history.
            "settings_event": section.audit_event if section else None,
            "requested_by_id": req.requested_by_id,
            "changed": req.diff,
            **({"labels": req.context} if req.context else {}),
            **(extra or {}),
            "outcome": "success", "source": "admin" if actor_id else "system",
        },
    )


# ── notifications (hook point for the ops bot) ──────────────────────────────

async def notify_pending_change(db: AsyncSession, req: ConfigChangeRequest, section: ConfigSection) -> None:
    """Tell the other admins a settings change waits for them.

    Today: an admin-inbox alert (bell feed + Cảnh báo), resolved again when the
    request is decided or lapses. The "Chờ duyệt" work queue in the bell and
    sidebar is counted from the table itself.

    Ops Telegram: the ops bot collects operator alerts from the alerts table
    (``ops_telegram.collect``, event "system_alert"), so this alert reaches the
    ops group with its link without a separate enqueue.
    """
    await add_alert(
        db, type_=ALERT_TYPE, severity="info", target_type="ops", target_id=req.id,
        message=f"{section.label}: yêu cầu đổi cấu hình chờ admin khác duyệt",
        href=f"/admin/config-changes?id={req.id}", fingerprint=_fingerprint(req.id),
    )


async def _close_alert(db: AsyncSession, request_id: int, admin_id: int | None) -> None:
    now = _now()
    await db.execute(
        update(Alert)
        .where(Alert.fingerprint == _fingerprint(request_id), Alert.is_active.is_(True))
        .values(is_active=False, resolved_at=now, admin_resolved_at=now, admin_resolved_by_id=admin_id)
    )


# ── expiry ──────────────────────────────────────────────────────────────────

async def expire_due(db: AsyncSession) -> int:
    """Mark lapsed pending requests expired (audit + alert closed). Flushes;
    the caller's transaction commits it."""
    rows = list((await db.execute(
        select(ConfigChangeRequest)
        .where(ConfigChangeRequest.status == PENDING, ConfigChangeRequest.expires_at <= func.now())
        .with_for_update(skip_locked=True)
    )).scalars())
    now = _now()
    for req in rows:
        req.status = "expired"
        req.decided_at = now
        await _close_alert(db, req.id, None)
        await _audit(db, "info", "config_change_expired", req, get_section(req.section), actor_id=None)
    if rows:
        await db.flush()
    return len(rows)


# ── maker ───────────────────────────────────────────────────────────────────

async def submit_change(
    db: AsyncSession, section_key: str, *, actor_id: int, payload: dict, reason: str | None,
) -> SubmitOutcome:
    """Apply or queue one settings save. ``payload`` is the validated PATCH body
    as JSON (``model_dump(mode="json", exclude_unset=True)``)."""
    section = _section(section_key)
    if not approval_required():
        return SubmitOutcome(result=await section.apply(db, actor_id, section.parse(payload), False),
                             applied_fields=sorted(payload))

    immediate, gated = section.split_payload(payload)
    # Validate everything before anything is applied.
    if gated:
        before, after = await _dry_run(db, section, actor_id, gated)
        if not section.diff(before, after):
            gated = {}
    if immediate:
        # Forms resend every emergency switch with each save: only a real flip
        # bypasses approval (and is logged as such).
        before, after = await _dry_run(db, section, actor_id, immediate, snapshot=section.immediate_snapshot)
        if not section.diff(before, after):
            immediate = {}
    if not immediate and not gated:
        # Nothing would change (or an empty body): the update function answers
        # as it always did — a no-op save, or its own 422 for an empty body.
        return SubmitOutcome(result=await section.apply(db, actor_id, section.parse(payload), False))
    note = (reason or "").strip()
    if gated and len(note) < REASON_MIN:
        raise api_error(ErrorCode.CONFIG_CHANGE_REASON_REQUIRED, 422)

    outcome = SubmitOutcome()
    # The queued part goes first, under the section lock: a conflicting pending
    # request (409) then fails the whole save before the immediate part is applied.
    if gated:
        await _lock_section(db, section.key)
        await expire_due(db)
        if await _pending_exists(db, section.key):
            raise api_error(ErrorCode.CONFIG_CHANGE_PENDING, status.HTTP_409_CONFLICT)
        # Recomputed under the lock: the base is what the approver will compare to.
        before, after = await _dry_run(db, section, actor_id, gated)
        diff = section.diff(before, after)
        if diff:
            outcome.request = await _create_request(db, section, actor_id, gated, before, diff, note)
    if immediate:
        outcome.applied_fields = sorted(_leaf_keys(immediate))
        try:
            # Flag the bypass in the same transaction as the change itself (the
            # section's own *_changed row carries old → new).
            await log_event(
                db, "warning" if section.emergency else "info", "Config applied without approval",
                request_id=current_request_id(),
                metadata={
                    "event": "config_change_applied_immediately",
                    "actor_id": actor_id, "actor_type": "admin",
                    "subject_type": "config_section", "subject_id": 0,
                    "section": section.key, "section_label": section.label,
                    "fields": outcome.applied_fields,
                    "emergency": section.emergency,
                    "outcome": "success", "source": "admin",
                },
            )
            outcome.result = await section.apply(db, actor_id, section.parse(immediate), False)  # commits
        except Exception:
            await db.rollback()
            if outcome.request is not None:
                # Do not leave half a save queued behind a failed one.
                await cancel(db, outcome.request["id"], admin_id=actor_id, note="immediate part failed")
            raise
    return outcome


def _leaf_keys(payload: dict) -> list[str]:
    """Field names of a (possibly per-row) payload: {"tiers": {"new": {"badge_image_id": …}}} → ["new.badge_image_id"]."""
    if set(payload) == {"tiers"} and isinstance(payload["tiers"], dict):
        return [f"{row}.{k}" for row, patch in payload["tiers"].items() for k in (patch or {})]
    return list(payload)


async def _create_request(
    db: AsyncSession, section: ConfigSection, actor_id: int, payload: dict, before: dict, diff: dict, reason: str,
) -> dict:
    req = ConfigChangeRequest(
        section=section.key, status=PENDING, payload=payload, diff=diff,
        context=(await section.context(db, diff)) if section.context else None,
        base_snapshot=before, base_version=version_of(before), reason=reason[:NOTE_MAX],
        requested_by_id=actor_id, expires_at=_now() + timedelta(days=int(settings.config_change_expiry_days)),
    )
    db.add(req)
    try:
        await db.flush()
    except IntegrityError as exc:  # another pending request won the race
        await db.rollback()
        raise api_error(ErrorCode.CONFIG_CHANGE_PENDING, status.HTTP_409_CONFLICT) from exc
    await _audit(db, "warning", "config_change_requested", req, section, actor_id=actor_id, extra={"reason": req.reason})
    await notify_pending_change(db, req, section)
    await db.commit()
    await db.refresh(req)
    return await serialize(db, req, viewer_id=actor_id)


# ── checker ─────────────────────────────────────────────────────────────────

async def _locked_request(db: AsyncSession, request_id: int) -> ConfigChangeRequest:
    req = await db.scalar(
        select(ConfigChangeRequest).where(ConfigChangeRequest.id == request_id).with_for_update()
    )
    if req is None:
        raise api_error(ErrorCode.CONFIG_CHANGE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if req.status == PENDING and req.expires_at <= _now():
        req.status = "expired"
        req.decided_at = _now()
        await _close_alert(db, req.id, None)
        await _audit(db, "info", "config_change_expired", req, get_section(req.section), actor_id=None)
        await db.commit()
    if req.status != PENDING:
        raise api_error(ErrorCode.CONFIG_CHANGE_NOT_PENDING, status.HTTP_409_CONFLICT, status=req.status)
    return req


def _clean_note(note: str | None) -> str | None:
    note = (note or "").strip()
    return note[:NOTE_MAX] or None


async def approve(db: AsyncSession, request_id: int, *, admin_id: int, note: str | None) -> dict:
    req = await _locked_request(db, request_id)
    if req.requested_by_id == admin_id:
        raise api_error(ErrorCode.CONFIG_CHANGE_SELF_APPROVAL, status.HTTP_403_FORBIDDEN)
    section = _section(req.section)
    await _lock_section(db, req.section)
    current = await section.snapshot(db)
    if version_of(current) != req.base_version:
        req.status = "superseded"
        req.decided_by_id = admin_id
        req.decided_at = _now()
        req.decision_note = _clean_note(note)
        await _close_alert(db, req.id, admin_id)
        await _audit(db, "warning", "config_change_superseded", req, section, actor_id=admin_id,
                     extra={"changed_since_request": section.diff(req.base_snapshot, current)})
        await db.commit()
        raise api_error(ErrorCode.CONFIG_CHANGE_STALE, status.HTTP_409_CONFLICT)

    changes = section.parse(req.payload)
    req.status = "approved"
    req.decided_by_id = admin_id
    req.decided_at = _now()
    req.decision_note = _clean_note(note)
    await _close_alert(db, req.id, admin_id)
    await _audit(db, "warning", "config_change_approved", req, section, actor_id=admin_id,
                 extra={"note": req.decision_note})
    await db.flush()
    try:
        # The section's update function re-validates, writes its own *_changed
        # audit row (actor = approver) and commits this whole transaction.
        await section.apply(db, admin_id, changes, False)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HTTPException:
        await db.rollback()
        raise
    await db.refresh(req)
    return await serialize(db, req, viewer_id=admin_id)


async def reject(db: AsyncSession, request_id: int, *, admin_id: int, note: str | None) -> dict:
    req = await _locked_request(db, request_id)
    if req.requested_by_id == admin_id:
        # The requester withdraws through cancel; a rejection is a second opinion.
        raise api_error(ErrorCode.CONFIG_CHANGE_SELF_APPROVAL, status.HTTP_403_FORBIDDEN)
    clean = _clean_note(note)
    if clean is None or len(clean) < REASON_MIN:
        raise api_error(ErrorCode.CONFIG_CHANGE_NOTE_REQUIRED, 422)
    req.status = "rejected"
    req.decided_by_id = admin_id
    req.decided_at = _now()
    req.decision_note = clean
    await _close_alert(db, req.id, admin_id)
    await _audit(db, "info", "config_change_rejected", req, get_section(req.section), actor_id=admin_id,
                 extra={"note": clean})
    await db.commit()
    await db.refresh(req)
    return await serialize(db, req, viewer_id=admin_id)


async def cancel(db: AsyncSession, request_id: int, *, admin_id: int, note: str | None = None) -> dict:
    req = await _locked_request(db, request_id)
    if req.requested_by_id != admin_id:
        raise api_error(ErrorCode.CONFIG_CHANGE_NOT_REQUESTER, status.HTTP_403_FORBIDDEN)
    req.status = "cancelled"
    req.decided_by_id = admin_id
    req.decided_at = _now()
    req.decision_note = _clean_note(note)
    await _close_alert(db, req.id, admin_id)
    await _audit(db, "info", "config_change_cancelled", req, get_section(req.section), actor_id=admin_id)
    await db.commit()
    await db.refresh(req)
    return await serialize(db, req, viewer_id=admin_id)


# ── reads ───────────────────────────────────────────────────────────────────

def _person(account: Account | None) -> dict | None:
    if account is None:
        return None
    return {"id": account.id, "email": account.email, "name": account.display_name}


async def _people(db: AsyncSession, ids: set[int]) -> dict[int, Account]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {a.id: a for a in (await db.execute(select(Account).where(Account.id.in_(ids)))).scalars()}


def _row(req: ConfigChangeRequest, people: dict[int, Account], viewer_id: int) -> dict:
    section = get_section(req.section)
    pending = req.status == PENDING
    mine = req.requested_by_id == viewer_id
    return {
        "id": req.id,
        "section": req.section,
        "section_label": section.label if section else req.section,
        "settings_event": section.audit_event if section else None,
        "href": section.href if section else None,
        "status": req.status,
        "payload": req.payload,
        "diff": req.diff,
        "context": req.context,
        "reason": req.reason,
        "requested_by": _person(people.get(req.requested_by_id)),
        "requested_at": req.requested_at,
        "expires_at": req.expires_at,
        "decided_by": _person(people.get(req.decided_by_id)) if req.decided_by_id else None,
        "decided_at": req.decided_at,
        "decision_note": req.decision_note,
        "is_mine": mine,
        "can_approve": pending and not mine,
        "can_reject": pending and not mine,
        "can_cancel": pending and mine,
    }


async def serialize(db: AsyncSession, req: ConfigChangeRequest, *, viewer_id: int) -> dict:
    people = await _people(db, {req.requested_by_id, req.decided_by_id or 0})
    return _row(req, people, viewer_id)


async def get_request(db: AsyncSession, request_id: int, *, viewer_id: int) -> dict:
    if await expire_due(db):
        await db.commit()
    req = await db.get(ConfigChangeRequest, request_id)
    if req is None:
        raise api_error(ErrorCode.CONFIG_CHANGE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return await serialize(db, req, viewer_id=viewer_id)


async def list_requests(
    db: AsyncSession, *, viewer_id: int, state: str = "pending", section: str | None = None,
    limit: int = 50, before_id: int | None = None,
) -> dict:
    """state: pending | history (decided, newest first) | all."""
    if await expire_due(db):
        await db.commit()
    q = select(ConfigChangeRequest)
    if state == "pending":
        q = q.where(ConfigChangeRequest.status == PENDING)
    elif state == "history":
        q = q.where(ConfigChangeRequest.status != PENDING)
    if section:
        q = q.where(ConfigChangeRequest.section == section)
    if before_id is not None:
        q = q.where(ConfigChangeRequest.id < before_id)
    rows = list((await db.execute(q.order_by(ConfigChangeRequest.id.desc()).limit(limit + 1))).scalars())
    more = len(rows) > limit
    rows = rows[:limit]
    people = await _people(db, {r.requested_by_id for r in rows} | {r.decided_by_id or 0 for r in rows})
    pending_count = await db.scalar(
        select(func.count(ConfigChangeRequest.id)).where(ConfigChangeRequest.status == PENDING)
    ) or 0
    return {
        "items": [_row(r, people, viewer_id) for r in rows],
        "next_before_id": rows[-1].id if more and rows else None,
        "pending_count": int(pending_count),
        "approval_required": approval_required(),
        "expiry_days": int(settings.config_change_expiry_days),
    }
