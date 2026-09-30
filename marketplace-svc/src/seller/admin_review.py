"""Admin review queue for seller applications: list, case file, notes.

Decisions (approve / reject / request-info) stay in ``seller.service``; this
module only reads and annotates.
"""
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from src.media.service import public_image
from src.models.account import Account, ApplicationStatus, SellerApplication
from src.models.order import Dispute, Order, OrderStatus

_STATUSES = {s.value for s in ApplicationStatus}
_SPENT_STATUSES = (OrderStatus.pending, OrderStatus.processing, OrderStatus.delivered,
                   OrderStatus.completed, OrderStatus.disputed)


async def _rows(db: AsyncSession, apps: list[SellerApplication]) -> list[dict]:
    from src.auth.admin_accounts import ip_links, phone_links

    account_ids = list({a.account_id for a in apps})
    accounts = {a.id: a for a in (await db.execute(
        select(Account).where(Account.id.in_(account_ids))
    )).scalars().all()} if account_ids else {}
    reviewer_ids = {a.reviewed_by for a in apps if a.reviewed_by}
    reviewers = dict((await db.execute(
        select(Account.id, Account.email).where(Account.id.in_(reviewer_ids))
    )).all()) if reviewer_ids else {}
    rejected = (await db.execute(
        select(SellerApplication.id, SellerApplication.account_id)
        .where(SellerApplication.account_id.in_(account_ids), SellerApplication.status == ApplicationStatus.rejected)
    )).all() if account_ids else []
    phones = await phone_links(db, account_ids)
    locked_ips = await ip_links(db, account_ids, locked_only=True)
    from src.seller.schemas import SellerApplicationResponse

    out = []
    for app in apps:
        account = accounts.get(app.account_id)
        prior = sum(1 for rid, aid in rejected if aid == app.account_id and rid != app.id)
        verified = bool(account and account.email_verified)
        risk_count = sum((
            not verified,
            bool(phones.get(app.account_id)),
            bool(locked_ips.get(app.account_id)),
            prior > 0,
        ))
        row = SellerApplicationResponse.model_validate(app).model_dump()
        row.update(
            applicant={"id": account.id, "email": account.email, "email_verified": verified,
                       "created_at": account.created_at} if account else None,
            logo=public_image(app.logo), banner=public_image(app.banner),
            reviewed_at=app.reviewed_at, reviewed_by_email=reviewers.get(app.reviewed_by),
            resubmitted=app.info_responded_at is not None, prior_rejections=prior, risk_count=risk_count,
        )
        out.append(row)
    return out


async def list_applications(
    db: AsyncSession, *, status: str = "pending", search: str | None = None, page: int = 1, per_page: int = 30,
) -> dict:
    if status not in _STATUSES:
        raise HTTPException(status_code=422, detail="Trạng thái không hợp lệ")
    filters = [SellerApplication.status == ApplicationStatus(status)]
    if search and search.strip():
        like = f"%{search.strip()}%"
        filters.append(or_(
            SellerApplication.business_name.ilike(like),
            SellerApplication.phone.ilike(like),
            SellerApplication.account_id.in_(select(Account.id).where(Account.email.ilike(like))),
        ))
    total = int(await db.scalar(select(func.count(SellerApplication.id)).where(*filters)) or 0)
    if status == "pending":
        # Longest wait first.
        order = (SellerApplication.created_at.asc(), SellerApplication.id.asc())
    else:
        order = (func.coalesce(SellerApplication.reviewed_at, SellerApplication.info_requested_at,
                               SellerApplication.created_at).desc(), SellerApplication.id.desc())
    apps = list((await db.execute(
        select(SellerApplication).where(*filters).order_by(*order).offset((page - 1) * per_page).limit(per_page)
    )).scalars().all())

    counts = {s: 0 for s in ("pending", "needs_info", "approved", "rejected")}
    for st, n in (await db.execute(
        select(SellerApplication.status, func.count(SellerApplication.id)).group_by(SellerApplication.status)
    )).all():
        counts[st.value if hasattr(st, "value") else st] = int(n)
    avg_seconds = await db.scalar(
        select(func.avg(func.extract("epoch", SellerApplication.reviewed_at - SellerApplication.created_at)))
        .where(SellerApplication.reviewed_at.is_not(None))
    )
    return {
        "items": await _rows(db, apps),
        "total": total,
        "counts": counts,
        "avg_review_hours": round(float(avg_seconds) / 3600, 1) if avg_seconds is not None else None,
    }


async def get_application(db: AsyncSession, app_id: int) -> SellerApplication:
    app = await db.get(SellerApplication, app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn đăng ký")
    return app


async def application_row(db: AsyncSession, app: SellerApplication) -> dict:
    return (await _rows(db, [app]))[0]


_HISTORY_EVENTS = {
    "seller_application_submitted": "submitted",
    "seller_application_needs_info": "info_requested",
    "seller_application_resubmitted": "resubmitted",
    "seller_application_approved": "approved",
    "seller_application_rejected": "rejected",
}


async def _history(db: AsyncSession, app: SellerApplication) -> list[dict]:
    from src.models.log_entry import LogEntry

    entries = (await db.execute(
        select(LogEntry).where(
            LogEntry.metadata_["subject_type"].astext == "seller_application",
            LogEntry.metadata_["subject_id"].astext == str(app.id),
            LogEntry.metadata_["event"].astext.in_(list(_HISTORY_EVENTS)),
        ).order_by(LogEntry.created_at.asc(), LogEntry.id.asc())
    )).scalars().all()
    actor_ids = set()
    for e in entries:
        try:
            if (e.metadata_ or {}).get("actor_type") == "admin" and e.metadata_.get("actor_id"):
                actor_ids.add(int(e.metadata_["actor_id"]))
        except (TypeError, ValueError):
            pass
    emails = dict((await db.execute(select(Account.id, Account.email).where(Account.id.in_(actor_ids)))).all()) if actor_ids else {}
    history = []
    for e in entries:
        meta = e.metadata_ or {}
        kind = _HISTORY_EVENTS[meta["event"]]
        actor = None
        if meta.get("actor_type") == "admin":
            try:
                actor = emails.get(int(meta.get("actor_id")))
            except (TypeError, ValueError):
                actor = None
        history.append({"at": e.created_at, "kind": kind, "actor_email": actor,
                        "text": meta.get("note") or meta.get("reason")})
    if not any(h["kind"] == "submitted" for h in history):
        # Rows older than the audit trail: rebuild what the columns remember.
        history.insert(0, {"at": app.created_at, "kind": "submitted", "actor_email": None, "text": None})
        if app.info_requested_at and not any(h["kind"] == "info_requested" for h in history):
            history.append({"at": app.info_requested_at, "kind": "info_requested", "actor_email": None,
                            "text": app.info_request})
        if app.info_responded_at and not any(h["kind"] == "resubmitted" for h in history):
            history.append({"at": app.info_responded_at, "kind": "resubmitted", "actor_email": None, "text": None})
        history.sort(key=lambda h: h["at"])
    return history


async def application_detail(db: AsyncSession, app_id: int) -> dict:
    from datetime import datetime, timezone

    from src.audit.notes import list_notes
    from src.auth.admin_accounts import ip_links, phone_links

    app = await get_application(db, app_id)
    row = await application_row(db, app)
    account = await db.get(Account, app.account_id)
    bought, spent = (await db.execute(
        select(func.count(Order.id), func.coalesce(func.sum(case(
            (Order.status.in_(_SPENT_STATUSES), Order.total_amount - Order.refunded_amount), else_=0,
        )), 0)).where(Order.buyer_id == app.account_id, Order.is_seeded.is_(False))
    )).one()
    disputes_opened = int(await db.scalar(select(func.count(Dispute.id)).where(Dispute.buyer_id == app.account_id)) or 0)
    now = datetime.now(timezone.utc)
    risk = {
        "email_verified": bool(account and account.email_verified),
        "totp_enabled": bool(account and account.totp_enabled),
        "account_age_days": (now - account.created_at).days if account and account.created_at else 0,
        "orders_bought": int(bought or 0),
        "spent": int(spent or 0),
        "disputes_opened": disputes_opened,
        "same_phone_accounts": (await phone_links(db, [app.account_id])).get(app.account_id, []),
        "shared_ip_locked_accounts": [
            {"id": a["id"], "email": a["email"], "is_active": a["is_active"]}
            for a in (await ip_links(db, [app.account_id], locked_only=True)).get(app.account_id, [])
        ],
    }
    prior = (await db.execute(
        select(SellerApplication).where(SellerApplication.account_id == app.account_id, SellerApplication.id != app.id)
        .order_by(SellerApplication.created_at.desc())
    )).scalars().all()
    return {
        **row,
        "risk": risk,
        "prior_applications": [
            {"id": p.id, "status": p.status.value, "reject_reason": p.reject_reason, "created_at": p.created_at}
            for p in prior
        ],
        "previous_snapshot": app.previous_snapshot,
        "history": await _history(db, app),
        "notes": await list_notes(db, "seller_application", app.id),
    }
