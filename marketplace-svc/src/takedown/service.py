"""Link takedown — requests, money and partner sync.

Ownership:
- the partner owns the work and its statuses (quote, payment confirmation,
  completion, warranty, failure); we mirror them through webhooks and a
  polling job (src/takedown/client.py, lifecycle.py);
- GMMO owns the buyer price and the money: an accepted quote becomes an
  ordinary order of the internal takedown seller. The buyer's money sits in
  that order's escrow until the partner reports `success` (order delivered,
  escrow releases) or `failed` / `cancelled` (order refunded and cancelled).

Partner calls are never made inside a DB transaction that holds a row lock;
each call is followed by a fresh transaction that applies its result.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from fastapi import status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.config import settings
from src.database import SessionLocal
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.product import Product
from src.models.takedown import TakedownEvent, TakedownRequest
from src.money.service import get_effective_rate
from src.takedown import client
from src.takedown.client import PartnerError
from src.takedown.lifecycle import (
    REFUND_ON, TERMINAL, code_in_reason, platform_for, reason_for, safe_http_url, status_for, webhook_applies,
)
from src.wallet.service import deduct_credit, refund_escrow

logger = structlog.get_logger()

SYNC_STALE_AFTER = timedelta(minutes=5)
SYNC_BATCH = 50
EVIDENCE_STATUSES = frozenset({"in_warranty", "warranty_pending", "success"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _event(req: TakedownRequest | None, source: str, action: str, *, from_status=None, to_status=None,
           note=None, payload=None, partner_event_id=None, applied=True) -> TakedownEvent:
    return TakedownEvent(
        request_id=req.id if req else None, source=source, action=action, from_status=from_status,
        to_status=to_status, note=note, payload=payload, partner_event_id=partner_event_id, applied=applied,
    )


async def _get_owned(db: AsyncSession, code: str, buyer_id: int, *, lock: bool = False) -> TakedownRequest:
    stmt = select(TakedownRequest).where(TakedownRequest.code == code, TakedownRequest.buyer_id == buyer_id)
    if lock:
        stmt = stmt.with_for_update()
    req = await db.scalar(stmt)
    if not req:
        raise api_error(ErrorCode.TAKEDOWN_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return req


async def _get_any(db: AsyncSession, code: str, *, lock: bool = False) -> TakedownRequest:
    stmt = select(TakedownRequest).where(TakedownRequest.code == code)
    if lock:
        stmt = stmt.with_for_update()
    req = await db.scalar(stmt)
    if not req:
        raise api_error(ErrorCode.TAKEDOWN_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return req


def _invalid_state() -> Exception:
    return api_error(ErrorCode.TAKEDOWN_INVALID_STATE, status.HTTP_409_CONFLICT)


def _unavailable() -> Exception:
    return api_error(ErrorCode.TAKEDOWN_UNAVAILABLE, status.HTTP_503_SERVICE_UNAVAILABLE)


# ------------------------------------------------------------------ applying


async def _settle_money(req: TakedownRequest, new_status: str, db: AsyncSession) -> None:
    """Order side effects of entering ``new_status`` (idempotent)."""
    if not req.order_id:
        return
    order = await db.get(Order, req.order_id, with_for_update=True)
    if not order:
        return
    if new_status in REFUND_ON and order.status in (OrderStatus.pending, OrderStatus.processing):
        remaining = order.total_amount - order.refunded_amount
        if remaining > 0:
            await refund_escrow(order.id, order.buyer_id, remaining, db)
        order.status = OrderStatus.cancelled
        order.cancel_reason = "Không gỡ được link — đã hoàn tiền" if new_status == "failed" else "Đã huỷ yêu cầu gỡ link"
        await log_event(db, "info", f"Takedown {req.code}: order {order.id} refunded ({new_status})",
                        metadata={"event": "takedown_refunded", "order_id": order.id, "amount": remaining,
                                  "takedown": req.code})
    elif new_status == "done" and order.status in (OrderStatus.pending, OrderStatus.processing):
        now = _now()
        order.status = OrderStatus.delivered
        order.delivered_at = now
        order.delivered_data = f"Gỡ link {req.code}\n{req.url}"
        order.escrow_expires_at = now + timedelta(days=max(0, settings.takedown_escrow_days))
        await log_event(db, "info", f"Takedown {req.code}: order {order.id} delivered",
                        metadata={"event": "takedown_delivered", "order_id": order.id, "takedown": req.code})


async def _apply(req: TakedownRequest, db: AsyncSession, *, partner_status: str, price: int | None = None,
                 warranty_until: datetime | None = None, clear_warranty: bool = False,
                 refunded_at: datetime | None = None) -> str:
    """Mirror one partner state onto the request (row must be locked)."""
    if price is not None and price > 0:
        req.partner_price = price
    if warranty_until is not None:
        req.warranty_until = warranty_until
    elif clear_warranty:
        req.warranty_until = None
    if refunded_at is not None:
        req.partner_refunded_at = refunded_at
    req.partner_status = partner_status
    old = req.status
    if old in TERMINAL:
        return old
    new = status_for(partner_status, price_set=req.price is not None, order_held=req.order_id is not None)
    if new != old:
        now = _now()
        req.status = new
        if new == "processing" and not req.processing_at:
            req.processing_at = now
        if new == "warranty" and not req.completed_at:
            req.completed_at = now
        if new in TERMINAL:
            req.finished_at = now
        await _settle_money(req, new, db)
    return new


async def _apply_order_dict(req: TakedownRequest, data: dict, db: AsyncSession) -> str:
    """Apply a full partner Order (GET /orders/{id} or an action response)."""
    partner_status = data.get("status")
    if not partner_status:
        return req.status
    if data.get("id") and not req.partner_order_id:
        req.partner_order_id = int(data["id"])
    until = client.parse_time(data.get("warranty_until"))
    return await _apply(
        req, db, partner_status=partner_status, price=data.get("price"),
        warranty_until=until, clear_warranty=until is None,
        refunded_at=client.parse_time(data.get("refunded_at")),
    )


# ------------------------------------------------------------------ buyer


def _clean_url(url: str) -> str:
    """Schema already bounds the input; reject what is blank once trimmed."""
    text = (url or "").strip()
    if not text:
        raise _invalid_state()
    return text[:2048]


async def create_request(db: AsyncSession, buyer: Account, *, url: str, note: str | None, service: str,
                         warranty_hours: int) -> TakedownRequest:
    if not client.is_configured():
        raise _unavailable()
    if service not in client.SERVICES or warranty_hours not in client.WARRANTY_HOURS:
        raise _invalid_state()
    text = _clean_url(url)
    req = TakedownRequest(
        buyer_id=buyer.id, url=text, note=(note or "").strip()[:1900] or None, service=service,
        platform=platform_for(text), warranty_hours=warranty_hours, status="review",
    )
    db.add(req)
    await db.flush()
    db.add(_event(req, "buyer", "create", to_status="review"))
    await db.commit()
    await push_create(req.id)
    await db.refresh(req)
    return req


async def push_create(request_id: int) -> None:
    """Create (or find) the partner order for a request that has none yet."""
    async with SessionLocal() as db:
        req = await db.get(TakedownRequest, request_id)
        if not req or req.partner_order_id or req.status in TERMINAL:
            return
        code, url, note, service, platform, warranty = (
            req.code, req.url, req.note, req.service, req.platform, req.warranty_hours,
        )
        retried = req.sync_error is not None
    data: dict | None = None
    error: str | None = None
    try:
        if retried:
            # A previous create may have reached the partner without us seeing
            # the answer: look for our code in `reason` before creating again.
            for order in await client.list_orders():
                if code_in_reason(order.get("reason")) == code:
                    data = order
                    break
        if data is None:
            data = await client.create_order(
                service=service, platform=platform, target_url=url,
                reason=reason_for(code, note), warranty_hours=warranty,
            )
    except PartnerError as exc:
        error = str(exc)
    async with SessionLocal() as db:
        req = await db.get(TakedownRequest, request_id, with_for_update=True)
        if not req or req.partner_order_id:
            return
        if data is not None:
            req.sync_error = None
            req.needs_sync = False
            req.last_synced_at = _now()
            await _apply_order_dict(req, data, db)
            db.add(_event(req, "system", "partner_created", to_status=req.partner_status,
                          payload={"partner_order_id": req.partner_order_id}))
        else:
            req.sync_error = (error or "create failed")[:500]
            req.needs_sync = True
            logger.warning("takedown_create_failed", code=req.code, error=error)
        await db.commit()


async def accept_quote(db: AsyncSession, buyer: Account, code: str) -> TakedownRequest:
    """Take the buyer's money into an order, then tell the partner."""
    req = await _get_owned(db, code, buyer.id, lock=True)
    if req.status != "quoted" or req.price is None or not req.partner_order_id:
        raise _invalid_state()
    seller = await db.scalar(select(Account).where(Account.email == settings.takedown_seller_email.strip().lower()))
    if not settings.takedown_seller_email or not seller:
        raise _unavailable()
    if seller.id == buyer.id:
        raise _invalid_state()
    product_id = settings.takedown_product_id
    if product_id is not None and not await db.get(Product, product_id):
        product_id = None
    order = Order(
        buyer_id=buyer.id, seller_id=seller.id, product_id=product_id, quantity=1,
        total_amount=req.price, status=OrderStatus.processing,
        user_config={"takedown_code": req.code}, display_fx_rate_snapshot=await get_effective_rate(db),
    )
    db.add(order)
    await db.flush()
    await deduct_credit(buyer.id, req.price, f"Gỡ link {req.code}", f"order-{order.id}", db)
    req.order_id = order.id
    req.accepted_at = _now()
    req.status = "started"
    req.needs_sync = True  # cleared once the partner confirms the accept
    db.add(_event(req, "buyer", "accept", from_status="quoted", to_status="started"))
    await log_event(db, "info", f"Takedown {req.code} accepted, order {order.id}",
                    metadata={"event": "takedown_accepted", "order_id": order.id, "amount": req.price,
                              "takedown": req.code})
    request_id = req.id
    await db.commit()
    await forward_accept(request_id)
    return await db.get(TakedownRequest, request_id, populate_existing=True)


async def forward_accept(request_id: int) -> None:
    """Send `accept` for a paid request whose partner order is still `quoted`."""
    async with SessionLocal() as db:
        req = await db.get(TakedownRequest, request_id)
        if not req or not req.order_id or not req.partner_order_id or req.status in TERMINAL:
            return
        partner_id = req.partner_order_id
    data: dict | None = None
    error: PartnerError | None = None
    try:
        data = await client.action(partner_id, "accept")
    except PartnerError as exc:
        error = exc
        if not exc.unreachable:
            # 409 etc.: the partner moved on (already accepted, cancelled…).
            # Re-read it; applying that state refunds if it can no longer run.
            try:
                data = await client.get_order(partner_id)
            except PartnerError:
                data = None
    async with SessionLocal() as db:
        req = await db.get(TakedownRequest, request_id, with_for_update=True)
        if data is not None:
            await _apply_order_dict(req, data, db)
            req.needs_sync = req.partner_status == "quoted"
            req.sync_error = None if not req.needs_sync else "accept not confirmed"
            req.last_synced_at = _now()
        else:
            req.needs_sync = True
            req.sync_error = str(error)[:500] if error else "accept failed"
        await db.commit()


async def _member_action(db: AsyncSession, buyer: Account, code: str, action: str, allowed: set[str],
                         note: str | None = None) -> TakedownRequest:
    req = await _get_owned(db, code, buyer.id)
    if req.status not in allowed or not req.partner_order_id:
        raise _invalid_state()
    request_id, partner_id, before = req.id, req.partner_order_id, req.status
    await db.rollback()
    try:
        data = await client.action(partner_id, action, note)
    except PartnerError as exc:
        if exc.unreachable:
            raise _unavailable() from None
        if action == "warranty" and "ended" in str(exc).lower():
            raise api_error(ErrorCode.TAKEDOWN_WARRANTY_ENDED, status.HTTP_409_CONFLICT) from None
        await sync_request(request_id)
        raise _invalid_state() from None
    async with SessionLocal() as s:
        locked = await s.get(TakedownRequest, request_id, with_for_update=True)
        await _apply_order_dict(locked, data, s)
        s.add(_event(locked, "buyer", action, from_status=before, to_status=locked.status, note=note))
        locked.last_synced_at = _now()
        await s.commit()
    return await db.get(TakedownRequest, request_id, populate_existing=True)


async def decline_quote(db: AsyncSession, buyer: Account, code: str) -> TakedownRequest:
    return await _member_action(db, buyer, code, "decline", {"quoted"})


async def cancel_request(db: AsyncSession, buyer: Account, code: str) -> TakedownRequest:
    return await _member_action(db, buyer, code, "cancel", {"review", "quoted", "started"})


async def claim_warranty(db: AsyncSession, buyer: Account, code: str, note: str) -> TakedownRequest:
    return await _member_action(db, buyer, code, "warranty", {"warranty"}, note=note.strip()[:2000])


# ------------------------------------------------------------------ admin


async def set_price(db: AsyncSession, admin: Account, code: str, price: int) -> TakedownRequest:
    """Admin's buyer price for a partner quote; the buyer sees it at once."""
    req = await _get_any(db, code, lock=True)
    if req.status != "review" or req.partner_status != "quoted" or price <= 0:
        raise _invalid_state()
    req.price = price
    req.quoted_at = _now()
    req.status = "quoted"
    db.add(_event(req, "admin", "price", from_status="review", to_status="quoted",
                  payload={"price": price, "partner_price": req.partner_price, "admin_id": admin.id}))
    await log_event(db, "info", f"Takedown {req.code} priced {price}",
                    metadata={"event": "takedown_priced", "takedown": req.code, "price": price,
                              "partner_price": req.partner_price, "actor_id": admin.id})
    await db.commit()
    await db.refresh(req)
    return req


# ------------------------------------------------------------------ partner


async def handle_webhook(payload: dict) -> dict:
    """One signed partner event (API.vi.md §9). Idempotent by event id."""
    event_id = payload.get("id")
    data = payload.get("data") or {}
    partner_order_id = data.get("order_id")
    if not isinstance(event_id, int) or not isinstance(partner_order_id, int):
        return {"ok": True, "ignored": "malformed"}
    async with SessionLocal() as db:
        if await db.scalar(select(TakedownEvent.id).where(TakedownEvent.partner_event_id == event_id)):
            return {"ok": True, "duplicate": True}
        req = await db.scalar(
            select(TakedownRequest).where(TakedownRequest.partner_order_id == partner_order_id).with_for_update()
        )
        if req is None and data.get("action") == "create":
            # The create webhook can beat the create response: match on our code.
            code = code_in_reason(data.get("reason"))
            if code:
                req = await db.scalar(
                    select(TakedownRequest).where(TakedownRequest.code == code).with_for_update()
                )
                if req is not None and req.partner_order_id is None:
                    req.partner_order_id = partner_order_id
        from_status, to_status = data.get("from_status"), data.get("to_status")
        applied = False
        if req is not None and to_status and webhook_applies(req.partner_status, from_status):
            until = client.parse_time(data.get("warranty_until"))
            # The event carries no refunded_at: the partner's refund of its cost happens at event time.
            refunded_at = (client.parse_time(payload.get("created_at")) or _now()) if data.get("action") == "refund" else None
            await _apply(req, db, partner_status=to_status, price=data.get("price"), warranty_until=until,
                         clear_warranty=until is None and to_status not in ("in_warranty", "warranty_pending"),
                         refunded_at=refunded_at)
            applied = True
            if to_status == "awaiting_payment":
                req.needs_sync = False
                req.sync_error = None
        elif req is not None and to_status and to_status == req.partner_status:
            # Already there (the create response or a sync got here first): nothing to do.
            applied = True
        elif req is not None:
            req.needs_sync = True
        db.add(TakedownEvent(
            request_id=req.id if req else None, source="partner", partner_event_id=event_id,
            action=str(data.get("action") or payload.get("type") or "event")[:32],
            from_status=from_status, to_status=to_status, note=data.get("note"),
            payload={k: v for k, v in data.items() if k not in ("client",)}, applied=applied,
        ))
        await db.commit()
        request_id = req.id if req else None
        refresh = req is not None and (not applied or to_status in EVIDENCE_STATUSES)
    if refresh and request_id:
        # Evidence and anything we could not apply come from a fresh read.
        try:
            await sync_request(request_id)
        except Exception:  # never fail the webhook on a follow-up read
            logger.warning("takedown_webhook_followup_failed", request_id=request_id)
    return {"ok": True, "applied": applied}


async def sync_request(request_id: int) -> None:
    """Re-read one request from the partner and apply it (+ evidence)."""
    async with SessionLocal() as db:
        req = await db.get(TakedownRequest, request_id)
        if not req:
            return
        if not req.partner_order_id:
            await db.rollback()
            await push_create(request_id)
            return
        partner_id, held = req.partner_order_id, req.order_id is not None
    try:
        data = await client.get_order(partner_id)
        evidence = await client.get_evidence(partner_id) if data.get("status") in EVIDENCE_STATUSES else None
    except PartnerError as exc:
        async with SessionLocal() as db:
            req = await db.get(TakedownRequest, request_id, with_for_update=True)
            req.sync_error = str(exc)[:500]
            req.last_synced_at = _now()
            await db.commit()
        return
    async with SessionLocal() as db:
        req = await db.get(TakedownRequest, request_id, with_for_update=True)
        await _apply_order_dict(req, data, db)
        if evidence:
            req.evidence_live_url = safe_http_url(evidence.get("evidence_live_url")) or req.evidence_live_url
            req.evidence_dead_url = safe_http_url(evidence.get("evidence_dead_url")) or req.evidence_dead_url
        pending_accept = held and req.partner_status == "quoted" and req.status not in TERMINAL
        req.needs_sync = pending_accept
        req.sync_error = "accept not confirmed" if pending_accept else None
        req.last_synced_at = _now()
        await db.commit()
    if pending_accept:
        await forward_accept(request_id)


async def sync_due_requests() -> int:
    """Polling safety net: the partner retries a webhook only 4 times in ~30 s."""
    cutoff = _now() - SYNC_STALE_AFTER
    async with SessionLocal() as db:
        ids = list(await db.scalars(
            select(TakedownRequest.id)
            .where(
                TakedownRequest.status.notin_(TERMINAL),
                or_(
                    TakedownRequest.partner_order_id.is_(None),
                    TakedownRequest.needs_sync.is_(True),
                    TakedownRequest.last_synced_at.is_(None),
                    TakedownRequest.last_synced_at < cutoff,
                    # Screenshots are set after "complete" and send no webhook: look every run until they arrive.
                    and_(TakedownRequest.partner_status.in_(EVIDENCE_STATUSES), TakedownRequest.evidence_dead_url.is_(None)),
                ),
            )
            .order_by(TakedownRequest.last_synced_at.asc().nulls_first())
            .limit(SYNC_BATCH)
        ))
    for request_id in ids:
        try:
            await sync_request(request_id)
        except Exception as exc:  # one bad row must not stop the batch
            logger.error("takedown_sync_failed", request_id=request_id, error=str(exc))
    return len(ids)


# --------------------------------------------------------------- evidence

EVIDENCE_KINDS = ("live", "dead")


def _evidence_url(req: TakedownRequest, kind: str) -> str | None:
    return req.evidence_live_url if kind == "live" else req.evidence_dead_url if kind == "dead" else None


async def evidence_image(db: AsyncSession, code: str, kind: str, *, buyer_id: int | None) -> tuple[bytes, str]:
    """The partner's screenshot, served through us: buyers never see the partner's host,
    and an http:// URL is not blocked by the page CSP. Buyers only once the link is down."""
    req = await (_get_owned(db, code, buyer_id) if buyer_id is not None else _get_any(db, code))
    url = _evidence_url(req, kind)
    if not url or (buyer_id is not None and req.partner_status not in EVIDENCE_STATUSES):
        raise api_error(ErrorCode.TAKEDOWN_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await db.rollback()
    try:
        return await client.fetch_image(url)
    except PartnerError as exc:
        logger.warning("takedown_evidence_fetch_failed", code=code, kind=kind, error=str(exc))
        raise api_error(ErrorCode.TAKEDOWN_UNAVAILABLE, status.HTTP_502_BAD_GATEWAY) from None


# ------------------------------------------------------------------ views


def buyer_view(req: TakedownRequest) -> dict[str, Any]:
    done = req.partner_status in EVIDENCE_STATUSES
    return {
        "code": req.code, "url": req.url, "note": req.note, "service": req.service, "platform": req.platform,
        "warranty_hours": req.warranty_hours, "status": req.status, "price": req.price,
        "warranty_until": req.warranty_until,
        "evidence": [k for k, url in (("live", req.evidence_live_url), ("dead", req.evidence_dead_url)) if done and url],
        "created_at": req.created_at, "quoted_at": req.quoted_at, "accepted_at": req.accepted_at,
        "processing_at": req.processing_at, "completed_at": req.completed_at, "finished_at": req.finished_at,
        "refunded": req.status in REFUND_ON and req.order_id is not None,
    }


async def list_for_buyer(db: AsyncSession, buyer_id: int) -> list[dict]:
    rows = await db.scalars(
        select(TakedownRequest).where(TakedownRequest.buyer_id == buyer_id).order_by(TakedownRequest.created_at.desc())
    )
    return [buyer_view(r) for r in rows]


async def get_for_buyer(db: AsyncSession, buyer_id: int, code: str) -> dict:
    return buyer_view(await _get_owned(db, code, buyer_id))


async def _emails(db: AsyncSession, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = await db.execute(select(Account.id, Account.email).where(Account.id.in_(ids)))
    return {i: e for i, e in rows.all()}


def admin_view(req: TakedownRequest, email: str | None, order_code: str | None = None) -> dict[str, Any]:
    return {
        **buyer_view(req),
        "evidence_live_url": req.evidence_live_url, "evidence_dead_url": req.evidence_dead_url,
        "buyer_email": email, "partner_order_id": req.partner_order_id, "partner_status": req.partner_status,
        "partner_price": req.partner_price, "order_code": order_code, "needs_sync": req.needs_sync,
        "sync_error": req.sync_error, "last_synced_at": req.last_synced_at, "updated_at": req.updated_at,
        "partner_refunded_at": req.partner_refunded_at,
    }


ADMIN_LIST_LIMIT = 2000


async def list_for_admin(db: AsyncSession) -> list[dict]:
    reqs = list(await db.scalars(
        select(TakedownRequest).order_by(TakedownRequest.created_at.desc()).limit(ADMIN_LIST_LIMIT)
    ))
    emails = await _emails(db, {r.buyer_id for r in reqs})
    return [admin_view(r, emails.get(r.buyer_id)) for r in reqs]


async def get_for_admin(db: AsyncSession, code: str) -> dict:
    req = await _get_any(db, code)
    emails = await _emails(db, {req.buyer_id})
    order_code = (await db.get(Order, req.order_id)).order_code if req.order_id else None
    events = list(await db.scalars(
        select(TakedownEvent).where(TakedownEvent.request_id == req.id).order_by(TakedownEvent.id)
    ))
    return {
        **admin_view(req, emails.get(req.buyer_id), order_code),
        "events": [
            {"source": e.source, "action": e.action, "from_status": e.from_status, "to_status": e.to_status,
             "note": e.note, "applied": e.applied, "created_at": e.created_at}
            for e in events
        ],
    }
