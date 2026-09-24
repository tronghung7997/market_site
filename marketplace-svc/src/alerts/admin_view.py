"""Admin alert inbox: what each alert is about, and where to act on it.

An alert row only stores (target_type, target_id) plus a fingerprint such as
"order:42:sla_breach". The admin console needs the concrete thing — order
ORD-…, the seller's name, the provider, the open dispute — and a link that
opens *that* record, not a generic list page. Everything is resolved here in
a handful of batched lookups for the whole page.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.entities import EntityIndex, Ref, unique
from src.audit.service import log_event
from src.models.account import Account
from src.models.alert import Alert

# Notices written for a buyer/seller inbox, never for operators.
USER_NOTIFICATION_TYPES = ("seller_application_approved", "buyer_dispute_resource_resolved", "seller_dispute_resource_resolved")
USER_TARGETS = ("buyer", "seller")
DISPUTE_TYPES = ("dispute_opened", "dispute_marketplace_review", "dispute_seller_timeout")


def admin_open_clause():
    """In the admin inbox: not an end-user notice, not resolved by an admin,
    and either still active or addressed to a seller/buyer (whose own dismiss
    must not make it vanish for operators)."""
    return and_(
        Alert.type.notin_(USER_NOTIFICATION_TYPES),
        Alert.admin_resolved_at.is_(None),
        or_(Alert.is_active.is_(True), Alert.target_type.in_(USER_TARGETS)),
    )


def _fingerprint_ref(fp: str | None) -> tuple[str, int, list[str]] | None:
    """'order:42:sla_breach' → ('order', 42, ['sla_breach'])."""
    if not fp:
        return None
    parts = fp.split(":")
    if len(parts) < 2 or not parts[1].isdigit():
        return None
    return parts[0], int(parts[1]), parts[2:]


def _plan(alert: Alert) -> list[tuple[str, int]]:
    """Entities an alert is about, most specific first."""
    refs: list[tuple[str, int]] = []
    fp = _fingerprint_ref(alert.fingerprint)
    if fp:
        kind, ident, rest = fp
        if kind == "seller" and len(rest) >= 2 and rest[-1].isdigit():
            refs.append(("provider", int(rest[-1])))  # seller:{sid}:provider_out_of_credit:{pid}
        elif kind in ("order", "provider", "variant", "deposit", "resource"):
            refs.append((kind, ident))
    if alert.target_type in ("seller", "buyer", "account"):
        target = ("account", alert.target_id)
    else:
        target = (alert.target_type, alert.target_id)
    if alert.target_type not in ("platform", "ops") and target not in refs:
        refs.append(target)
    return refs


async def _resolve(db: AsyncSession, alerts: list[Alert]) -> dict[int, list[Ref]]:
    plans = {a.id: _plan(a) for a in alerts}
    index = await EntityIndex().load(db, (p for refs in plans.values() for p in refs))

    def build(alert: Alert) -> list[Ref]:
        out: list[Ref | None] = []
        for kind, ident in plans[alert.id]:
            if kind == "order":
                o = index.orders.get(ident)
                if alert.type in DISPUTE_TYPES:
                    out.append(index.dispute_of_order(ident))
                out.append(index.order(ident))
                if o is not None:
                    out.append(index.account(o.seller_id, "người bán"))
                    if alert.type in DISPUTE_TYPES:
                        out.append(index.account(o.buyer_id, "người mua"))
            elif kind == "account":
                role = {"seller": "người bán", "buyer": "người mua"}.get(alert.target_type)
                out.append(index.account(ident, role))
            elif kind == "provider":
                out.append(index.provider(ident))
                p = index.providers.get(ident)
                if p is not None and p.seller_id:
                    out.append(index.account(p.seller_id, "chủ nguồn"))
            elif kind == "variant":
                out.append(index.variant(ident))
                vp = index.variants.get(ident)
                if vp is not None:
                    out.append(index.account(vp[1].seller_id, "người bán"))
            elif kind == "resource":
                out.append(index.resource(ident))
                r = index.resources.get(ident)
                if r is not None:
                    out.append(index.variant(r.variant_id))
            elif kind == "deposit":
                out.append(index.deposit(ident))
                d = index.deposits.get(ident)
                if d is not None:
                    out.append(index.account(d.account_id, "người nạp"))
            else:
                out.append(index.ref(kind, ident))
        refs = unique(out)
        if alert.type == "ledger_mismatch" and not refs:
            refs.append(Ref("report", 0, "Đối soát sổ cái", None, "/admin/reports"))
        return refs

    return {a.id: build(a) for a in alerts}


def _payload(alert: Alert, refs: list[Ref], resolvers: dict[int, Account]) -> dict:
    by = resolvers.get(alert.admin_resolved_by_id) if alert.admin_resolved_by_id else None
    return {
        "id": alert.id,
        "type": alert.type,
        "fingerprint": alert.fingerprint,
        "severity": alert.severity,
        "target_type": alert.target_type,
        "target_id": alert.target_id,
        "message": alert.message,
        "is_active": alert.is_active,
        "created_at": alert.created_at,
        "first_seen_at": alert.first_seen_at,
        "last_seen_at": alert.last_seen_at,
        "occurrence_count": alert.occurrence_count,
        "resolved_at": alert.resolved_at,
        "admin_resolved_at": alert.admin_resolved_at,
        "admin_resolved_by": (by.display_name or by.email) if by else None,
        "admin_note": alert.admin_note,
        "audience": "user" if alert.target_type in USER_TARGETS else "ops",
        "href": refs[0].href if refs else None,
        "refs": [r.as_dict() for r in refs],
    }


async def admin_alerts(db: AsyncSession, *, status: str = "open", limit: int = 300) -> list[dict]:
    q = select(Alert)
    if status == "resolved":
        q = q.where(Alert.type.notin_(USER_NOTIFICATION_TYPES), Alert.admin_resolved_at.is_not(None)).order_by(Alert.admin_resolved_at.desc())
    else:
        q = q.where(admin_open_clause()).order_by(Alert.last_seen_at.desc())
    alerts = list((await db.execute(q.limit(limit))).scalars())
    if status != "resolved":
        # A seller-facing incident the seller already dismissed comes back as a
        # new row; operators only need the newest one per fingerprint.
        seen: set[str] = set()
        kept = []
        for a in alerts:
            if a.fingerprint and a.fingerprint in seen:
                continue
            if a.fingerprint:
                seen.add(a.fingerprint)
            kept.append(a)
        alerts = kept
    refs = await _resolve(db, alerts)
    resolver_ids = {a.admin_resolved_by_id for a in alerts if a.admin_resolved_by_id}
    resolvers = {a.id: a for a in (await db.execute(select(Account).where(Account.id.in_(resolver_ids)))).scalars()} if resolver_ids else {}
    return [_payload(a, refs[a.id], resolvers) for a in alerts]


async def admin_alert_links(db: AsyncSession, alerts: list[Alert]) -> dict[int, str | None]:
    """Primary deep link per alert — for the admin notification bell."""
    refs = await _resolve(db, alerts)
    return {aid: (r[0].href if r else None) for aid, r in refs.items()}


async def list_admin_open_alerts(db: AsyncSession) -> list[Alert]:
    return list((await db.execute(select(Alert).where(admin_open_clause()).order_by(Alert.last_seen_at.desc()))).scalars())


async def resolve_alerts(db: AsyncSession, ids: list[int], *, admin: Account, note: str | None) -> list[dict]:
    now = datetime.now(timezone.utc)
    alerts = list((await db.execute(select(Alert).where(Alert.id.in_(ids)))).scalars())
    if not alerts:
        raise HTTPException(status_code=404, detail="Không tìm thấy cảnh báo")
    note = (note or "").strip() or None
    for alert in alerts:
        alert.admin_resolved_at = now
        alert.admin_resolved_by_id = admin.id
        alert.admin_note = note
        # Operator-owned incidents close for good; a seller/buyer notice stays
        # in its owner's inbox until they dismiss it themselves.
        if alert.target_type not in USER_TARGETS:
            alert.is_active = False
            alert.resolved_at = alert.resolved_at or now
        await log_event(
            db, "info", f"Admin #{admin.id} xử lý cảnh báo #{alert.id} ({alert.type})",
            metadata={"event": "admin_alert_resolved", "alert_id": alert.id, "alert_type": alert.type,
                      "actor_id": admin.id, "actor_type": "admin", "subject_type": "alert", "subject_id": alert.id,
                      **({"note": note} if note else {})},
        )
    await db.commit()
    return await _payloads(db, alerts)


async def reopen_alert(db: AsyncSession, alert_id: int, *, admin: Account) -> dict:
    alert = await db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Không tìm thấy cảnh báo")
    alert.admin_resolved_at = None
    alert.admin_resolved_by_id = None
    alert.admin_note = None
    if alert.target_type not in USER_TARGETS:
        alert.is_active = True
        alert.resolved_at = None
    await log_event(
        db, "info", f"Admin #{admin.id} mở lại cảnh báo #{alert.id} ({alert.type})",
        metadata={"event": "admin_alert_reopened", "alert_id": alert.id, "actor_id": admin.id, "actor_type": "admin",
                  "subject_type": "alert", "subject_id": alert.id},
    )
    await db.commit()
    return (await _payloads(db, [alert]))[0]


async def _payloads(db: AsyncSession, alerts: list[Alert]) -> list[dict]:
    for a in alerts:
        await db.refresh(a)
    refs = await _resolve(db, alerts)
    ids = {a.admin_resolved_by_id for a in alerts if a.admin_resolved_by_id}
    resolvers = {a.id: a for a in (await db.execute(select(Account).where(Account.id.in_(ids)))).scalars()} if ids else {}
    return [_payload(a, refs[a.id], resolvers) for a in alerts]
