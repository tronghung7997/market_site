from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event, query_logs
from src.config import settings
from src.logging import current_request_id
from src.models.account import Account
from src.models.order import (
    Dispute,
    DisputeClaimResource,
    DisputeMessage,
    DisputeResourceAction,
    DisputeStatus,
    Order,
    OrderStatus,
)
from src.models.product import DeliveryMode, Product, ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.resources.service import claim_resources
from src.sellers.tiers import escrow_days as tier_escrow_days
from src.sellers.tiers import platform_fee_percent
from src.wallet.service import escrow_settlement, refund_escrow, release_escrow
from src.exceptions import ErrorCode, api_error

_REMEDY_ALERT_ID_LIMIT = 6
_REMEDY_ALERT_HREF_ID_LIMIT = 20


def _resource_id_preview(ids: list[int], limit: int = _REMEDY_ALERT_ID_LIMIT) -> str:
    labels = [f"#{resource_id}" for resource_id in ids[:limit]]
    extra = len(ids) - limit
    if extra > 0:
        labels.append(f"+{extra}")
    return ", ".join(labels)


def _remedy_alert_href(order_id: int, resource_ids: list[int], *, seller: bool) -> str:
    shown = ",".join(str(resource_id) for resource_id in resource_ids[:_REMEDY_ALERT_HREF_ID_LIMIT])
    path = "/seller/orders" if seller else "/orders"
    return f"{path}?order_id={order_id}&resources={shown}"


async def _refresh_order_delivered_data(order: Order, db: AsyncSession) -> None:
    live = list(
        (
            await db.execute(
                select(Resource)
                .where(Resource.order_id == order.id, Resource.status == ResourceStatus.assigned)
                .order_by(Resource.id)
            )
        ).scalars()
    )
    order.delivered_data = "\n".join(resource.data for resource in live) if live else None


async def _notify_resource_remedy(
    db: AsyncSession,
    *,
    order: Order,
    action: str,
    originals: list[Resource],
    replacements: list[Resource],
) -> None:
    from src.alerts.service import add_alert

    original_ids = [resource.id for resource in originals]
    replacement_ids = [resource.id for resource in replacements]
    highlight_ids = original_ids + replacement_ids
    preview = _resource_id_preview(original_ids, _REMEDY_ALERT_ID_LIMIT)
    if action == "refund":
        buyer_message = (
            f"Đơn #{order.id}: seller hoàn {len(original_ids)} tài khoản ({preview})."
        )
        seller_message = (
            f"Đơn #{order.id}: đã hoàn {len(original_ids)} tài khoản cho buyer ({preview})."
        )
    else:
        pairs = ", ".join(
            f"#{original.id} → #{replacement.id}"
            for original, replacement in zip(originals, replacements, strict=True)
        )
        if len(pairs) > 180:
            pairs = _resource_id_preview(original_ids, _REMEDY_ALERT_ID_LIMIT)
        buyer_message = f"Đơn #{order.id}: seller đổi {len(original_ids)} tài khoản ({pairs})."
        seller_message = f"Đơn #{order.id}: đã đổi {len(original_ids)} tài khoản cho buyer ({pairs})."
    await add_alert(
        db,
        type_="buyer_dispute_resource_resolved",
        severity="info",
        target_type="buyer",
        target_id=order.buyer_id,
        message=buyer_message,
        href=_remedy_alert_href(order.id, highlight_ids, seller=False),
    )
    await add_alert(
        db,
        type_="seller_dispute_resource_resolved",
        severity="info",
        target_type="seller",
        target_id=order.seller_id,
        message=seller_message,
        href=_remedy_alert_href(order.id, highlight_ids, seller=True),
    )


_DISPUTE_OUTCOME = {
    DisputeStatus.resolved_refund: "refund",
    DisputeStatus.resolved_reject: "reject",
    DisputeStatus.resolved_partial_refund: "partial_refund",
    DisputeStatus.resolved_replace: "replace",
    DisputeStatus.resolved_extend_warranty: "extend_warranty",
    DisputeStatus.resolved_timeout: "timeout",
    DisputeStatus.withdrawn_by_buyer: "withdrawn",
    DisputeStatus.resolved_abandoned: "abandoned",
}


def last_buyer_claim_activity_at(
    dispute: Dispute,
    claims: list[DisputeClaimResource],
) -> datetime:
    """Return only buyer actions that expand the case's claimed scope.

    Chat is intentionally excluded. A buyer can send arbitrary messages, while
    every resource may be claimed once per case; using only claims prevents a
    periodic "still waiting" message from freezing escrow forever.
    """
    times = [dispute.created_at]
    times.extend(claim.created_at for claim in claims if claim.created_at)
    return max(times)


def compute_abandon_after_at(
    *,
    escrow_expires_at: datetime | None,
    last_buyer_claim_activity: datetime,
    resolution_deadline_at: datetime | None,
    has_resource_remedy: bool,
    grace_hours: int | None = None,
) -> datetime | None:
    """When an untouched open case may auto-settle remaining escrow to the seller.

    The buyer-response deadline (after a seller offer) is a different clock.
    A resource remedy blocks abandonment so the buyer can still accept or the
    offer-timeout job can finish the case.
    """
    if has_resource_remedy or resolution_deadline_at or not escrow_expires_at:
        return None
    hours = grace_hours if grace_hours is not None else settings.dispute_abandon_grace_hours
    start = escrow_expires_at
    if last_buyer_claim_activity > start:
        start = last_buyer_claim_activity
    return start + timedelta(hours=hours)


def _clear_resolution_deadline(dispute: Dispute) -> None:
    dispute.resolution_offered_at = None
    dispute.resolution_deadline_at = None


def _offer_resolution_deadline(dispute: Dispute, *, now: datetime | None = None) -> None:
    """Start the buyer response window once; a new buyer response clears it."""
    if dispute.resolution_deadline_at:
        return
    offered_at = now or datetime.now(timezone.utc)
    dispute.resolution_offered_at = offered_at
    dispute.resolution_deadline_at = offered_at + timedelta(
        hours=settings.dispute_resolution_timeout_hours
    )


async def _all_claimed_resources_remedied(dispute_id: int, db: AsyncSession) -> bool:
    claimed = set(
        (
            await db.execute(
                select(DisputeClaimResource.resource_id).where(
                    DisputeClaimResource.dispute_id == dispute_id
                )
            )
        ).scalars()
    )
    if not claimed:
        return False
    remedied = set(
        (
            await db.execute(
                select(DisputeResourceAction.original_resource_id).where(
                    DisputeResourceAction.dispute_id == dispute_id
                )
            )
        ).scalars()
    )
    return claimed <= remedied


_DISPUTE_ID_LIST_LIMIT = 2000


def _resource_search_clause(search: str | None):
    term = (search or "").strip().lstrip("#")
    if not term:
        return None
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    data_match = Resource.data.ilike(f"%{escaped}%", escape="\\")
    if term.isdigit():
        return or_(Resource.id == int(term), data_match)
    return data_match


def _truncate_reason(reason: str, limit: int = 200) -> str:
    text = (reason or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


async def _enqueue_dispute_opened(db: AsyncSession, dispute: Dispute, order: Order) -> None:
    from src.mail.service import enqueue_mail, frontend_url
    await enqueue_mail(
        db,
        template="dispute_opened",
        account_id=order.seller_id,
        idempotency_key=f"dispute_opened:{dispute.id}",
        payload={
            "order_id": order.id,
            "reason": _truncate_reason(dispute.reason),
            "action_url": frontend_url("vi", "/seller/orders"),
        },
    )


async def _enqueue_dispute_resolved(db: AsyncSession, dispute: Dispute, order: Order) -> None:
    from src.mail.service import enqueue_mail, frontend_url
    outcome = _DISPUTE_OUTCOME.get(dispute.status, dispute.status.value)
    payload = {
        "order_id": order.id,
        "outcome": outcome,
        "admin_note": dispute.admin_note or "",
        "amount": order.total_amount,
    }
    await enqueue_mail(
        db,
        template="dispute_resolved",
        account_id=order.buyer_id,
        idempotency_key=f"dispute_resolved:{dispute.id}:{order.buyer_id}",
        payload={**payload, "action_url": frontend_url("vi", f"/orders/{order.id}")},
    )
    await enqueue_mail(
        db,
        template="dispute_resolved",
        account_id=order.seller_id,
        idempotency_key=f"dispute_resolved:{dispute.id}:{order.seller_id}",
        payload={**payload, "action_url": frontend_url("vi", "/seller/orders")},
    )


async def _finalize_dispute(
    dispute: Dispute,
    order: Order,
    db: AsyncSession,
    *,
    status_value: DisputeStatus,
    actor_id: int,
    actor_role: str,
    event_type: str,
    body: str,
) -> None:
    """Apply one terminal dispute outcome and settle only the remaining escrow.

    Callers hold locks for both the commercial order and its open case. Keeping
    this operation shared prevents the buyer path, full-refund path, and
    timeout worker from drifting into different financial outcomes.
    """
    fully_refunded = order.refunded_amount == order.total_amount
    dispute.status = DisputeStatus.resolved_refund if fully_refunded else status_value
    dispute.resolved_at = datetime.now(timezone.utc)
    _clear_resolution_deadline(dispute)
    order.status = OrderStatus.refunded if fully_refunded else OrderStatus.completed

    seller = await db.get(Account, order.seller_id)
    fee_percent = platform_fee_percent(seller.seller_tier if seller else "new")
    remaining_amount, platform_fee = escrow_settlement(
        order.total_amount, order.refunded_amount, fee_percent
    )
    if remaining_amount:
        await release_escrow(order.id, order.seller_id, remaining_amount, platform_fee, db)

    db.add(
        DisputeMessage(
            dispute_id=dispute.id,
            actor_id=actor_id,
            actor_role=actor_role,
            event_type=event_type,
            body=body,
        )
    )
    if fully_refunded:
        from src.affiliate.service import clawback_commission_for_order
        await clawback_commission_for_order(order, db)
    else:
        from src.affiliate.service import apply_affiliate_commission
        await apply_affiliate_commission(order, db)
    await _enqueue_dispute_resolved(db, dispute, order)


async def create_dispute(
    order_id: int, buyer_id: int, reason: str, db: AsyncSession,
    evidence_type: str | None = None, evidence: dict[str, str] | None = None,
    resource_ids: list[int] | None = None, idempotency_key: str | None = None,
) -> dict:
    order = await db.get(Order, order_id, with_for_update=True)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != buyer_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    existing = await db.scalar(
        select(Dispute).where(
            Dispute.order_id == order_id,
            Dispute.status == DisputeStatus.open,
        )
    )
    if existing and idempotency_key:
        prior = await db.scalar(
            select(DisputeClaimResource.id).where(
                DisputeClaimResource.dispute_id == existing.id,
                DisputeClaimResource.batch_key == idempotency_key,
            )
        )
        if prior:
            return await _enrich_dispute(existing, db)
    if existing:
        raise api_error(ErrorCode.DISPUTE_ALREADY_OPEN, status.HTTP_400_BAD_REQUEST)
    if order.status != OrderStatus.delivered:
        raise api_error(ErrorCode.DISPUTE_ONLY_DELIVERED, status.HTTP_400_BAD_REQUEST)
    if order.escrow_expires_at and datetime.now(timezone.utc) > order.escrow_expires_at:
        raise api_error(ErrorCode.DISPUTE_ESCROW_EXPIRED, status.HTTP_400_BAD_REQUEST)

    dispute = Dispute(
        order_id=order_id, buyer_id=buyer_id, reason=reason,
        evidence_type=evidence_type, evidence=evidence,
    )
    db.add(dispute)
    await db.flush()
    if resource_ids:
        await _add_claim_resources(
            dispute,
            order,
            resource_ids,
            reason,
            idempotency_key or f"open-{dispute.id}",
            db,
        )
    await log_event(db, "warning", f"Dispute opened on order {order_id}", request_id=current_request_id(),
                    metadata={"event": "dispute_opened", "order_id": order_id, "buyer_id": buyer_id})
    from src.alerts.service import add_alert
    await add_alert(
        db,
        type_="dispute_opened",
        severity="warning",
        target_type="order",
        target_id=order_id,
        message=f"Đơn #{order_id} bị khiếu nại: {reason[:100]}",
    )
    await _enqueue_dispute_opened(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return await _enrich_dispute(dispute, db)


async def _resolve_order_product(order: Order | None, db: AsyncSession) -> tuple[Product | None, ProductVariant | None]:
    """Đơn cũ (variant_id) và đơn qua adapter (product_id, variant_id rỗng) trỏ tới
    sản phẩm theo 2 đường khác nhau — thiếu nhánh product_id khiến mọi đơn adapter
    hiện "Sản phẩm: —" dù sản phẩm vẫn tồn tại."""
    if not order:
        return None, None
    if order.variant_id:
        variant = await db.get(ProductVariant, order.variant_id)
        product = await db.get(Product, variant.product_id) if variant else None
        return product, variant
    if order.product_id:
        return await db.get(Product, order.product_id), None
    return None, None


async def _add_claim_resources(
    dispute: Dispute,
    order: Order,
    resource_ids: list[int],
    reason: str,
    batch_key: str,
    db: AsyncSession,
) -> None:
    resources = list(
        (
            await db.execute(
                select(Resource)
                .where(Resource.id.in_(resource_ids), Resource.order_id == order.id)
                .with_for_update()
            )
        ).scalars()
    )
    if len(resources) != len(resource_ids):
        raise HTTPException(status_code=400, detail="Every selected account must belong to this order")
    already_claimed = await db.scalar(
        select(DisputeClaimResource.id)
        .where(
            DisputeClaimResource.dispute_id == dispute.id,
            DisputeClaimResource.resource_id.in_(resource_ids),
        )
        .limit(1)
    )
    if already_claimed:
        raise HTTPException(status_code=409, detail="A selected account is already in this dispute")
    for resource_id in resource_ids:
        db.add(
            DisputeClaimResource(
                dispute_id=dispute.id,
                resource_id=resource_id,
                batch_key=batch_key,
                reason=reason,
            )
        )


def _timeline_events(
    dispute: Dispute,
    claims: list[DisputeClaimResource],
    actions: list[DisputeResourceAction],
    messages: list[DisputeMessage],
) -> list[dict]:
    events: list[dict] = [
        {
            "id": f"case-opened-{dispute.id}",
            "event_type": "case_opened",
            "created_at": dispute.created_at,
            "actor_role": "buyer",
            "body": dispute.reason,
            "resource_ids": [],
        }
    ]
    claim_batches: dict[str, list[DisputeClaimResource]] = {}
    for claim in claims:
        claim_batches.setdefault(claim.batch_key or f"legacy-{claim.id}", []).append(claim)
    for batch_key, batch in claim_batches.items():
        events.append(
            {
                "id": f"claim-{batch_key}",
                "event_type": "claim_batch",
                "created_at": min(row.created_at for row in batch),
                "actor_role": "buyer",
                "body": next((row.reason for row in batch if row.reason), None),
                "resource_ids": [row.resource_id for row in batch],
            }
        )
    action_batches: dict[str, list[DisputeResourceAction]] = {}
    for action in actions:
        action_batches.setdefault(action.idempotency_key, []).append(action)
    for action_key, batch in action_batches.items():
        events.append(
            {
                "id": f"action-{action_key}",
                "event_type": f"resource_{batch[0].action}",
                "created_at": min(row.created_at for row in batch),
                "actor_role": "seller",
                "action": batch[0].action,
                "resource_ids": [row.original_resource_id for row in batch],
                "replacement_resource_ids": [row.replacement_resource_id for row in batch],
                "refund_amount": sum(row.refund_amount for row in batch),
            }
        )
    for message in messages:
        events.append(
            {
                "id": f"message-{message.id}",
                "event_type": message.event_type,
                "created_at": message.created_at,
                "actor_role": message.actor_role,
                "body": message.body,
                "resource_ids": [],
            }
        )
    if dispute.resolved_at:
        events.append(
            {
                "id": f"case-resolved-{dispute.id}",
                "event_type": "case_resolved",
                "created_at": dispute.resolved_at,
                "actor_role": (
                    "system"
                    if dispute.status in (
                        DisputeStatus.resolved_timeout,
                        DisputeStatus.resolved_abandoned,
                    )
                    else "admin" if dispute.admin_note else "buyer"
                ),
                "body": dispute.admin_note,
                "resource_ids": [],
            }
        )
    return sorted(events, key=lambda event: (event["created_at"], event["event_type"]))


async def _enrich_dispute(dispute: Dispute, db: AsyncSession) -> dict:
    """Dispute ORM → dict with product/variant names + buyer email + order amount."""
    order = await db.get(Order, dispute.order_id)
    product, variant = await _resolve_order_product(order, db)
    buyer = await db.get(Account, dispute.buyer_id)
    claims = list(
        (
            await db.execute(
                select(DisputeClaimResource)
                .where(DisputeClaimResource.dispute_id == dispute.id)
                .order_by(DisputeClaimResource.created_at, DisputeClaimResource.id)
            )
        ).scalars()
    )
    actions = list(
        (
            await db.execute(
                select(DisputeResourceAction)
                .where(DisputeResourceAction.dispute_id == dispute.id)
                .order_by(DisputeResourceAction.created_at, DisputeResourceAction.id)
            )
        ).scalars()
    )
    messages = list(
        (
            await db.execute(
                select(DisputeMessage)
                .where(DisputeMessage.dispute_id == dispute.id)
                .order_by(DisputeMessage.created_at, DisputeMessage.id)
            )
        ).scalars()
    )
    return {
        "id": dispute.id, "order_id": dispute.order_id, "buyer_id": dispute.buyer_id,
        "reason": dispute.reason, "evidence_type": dispute.evidence_type, "evidence": dispute.evidence,
        "status": dispute.status,
        "admin_note": dispute.admin_note, "seller_note": dispute.seller_note,
        "created_at": dispute.created_at,
        "resolution_offered_at": dispute.resolution_offered_at,
        "resolution_deadline_at": dispute.resolution_deadline_at,
        "escrow_expires_at": order.escrow_expires_at if order else None,
        "abandon_after_at": compute_abandon_after_at(
            escrow_expires_at=order.escrow_expires_at if order else None,
            last_buyer_claim_activity=last_buyer_claim_activity_at(dispute, claims),
            resolution_deadline_at=dispute.resolution_deadline_at,
            has_resource_remedy=bool(actions),
        ),
        "resolved_at": dispute.resolved_at,
        "product_title": product.title if product else None,
        "variant_name": variant.name if variant else None,
        "buyer_email": buyer.email if buyer else None,
        "order_amount": order.total_amount if order else None,
        "refunded_amount": order.refunded_amount if order else 0,
        "claimed_resource_ids": [claim.resource_id for claim in claims],
        "resource_actions": [
            {
                "original_resource_id": row.original_resource_id,
                "replacement_resource_id": row.replacement_resource_id,
                "action": row.action,
                "refund_amount": row.refund_amount,
                "created_at": row.created_at,
            }
            for row in actions
        ],
        "timeline": _timeline_events(dispute, claims, actions, messages),
    }


async def list_disputes(db: AsyncSession) -> list[dict]:
    result = await db.execute(select(Dispute).order_by(Dispute.created_at.desc()))
    return [await _enrich_dispute(d, db) for d in result.scalars().all()]


async def get_dispute_detail(dispute_id: int, db: AsyncSession) -> dict:
    dispute = await db.get(Dispute, dispute_id)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)

    order = await db.get(Order, dispute.order_id)
    product, variant = await _resolve_order_product(order, db)
    buyer = await db.get(Account, dispute.buyer_id)
    seller = await db.get(Account, order.seller_id) if order else None

    order_info = None
    if order:
        order_info = {
            "id": order.id, "buyer_id": order.buyer_id, "seller_id": order.seller_id,
            "variant_id": order.variant_id, "quantity": order.quantity,
            "total_amount": order.total_amount, "status": order.status,
            "escrow_expires_at": order.escrow_expires_at, "delivered_data": order.delivered_data,
            "created_at": order.created_at,
            "product_title": product.title if product else None,
            "variant_name": variant.name if variant else None,
            "buyer_email": buyer.email if buyer else None,
            "seller_email": seller.email if seller else None,
        }

    resources_result = await db.execute(
        select(Resource).where(Resource.order_id == dispute.order_id)
    )
    resources = [
        {"id": r.id, "status": r.status, "expires_at": r.expires_at}
        for r in resources_result.scalars().all()
    ]

    logs = await query_logs(db, order_id=dispute.order_id)
    timeline = sorted(
        [
            {"event": log.metadata_.get("event", log.message), "timestamp": log.created_at}
            for log in logs if log.metadata_
        ],
        key=lambda x: x["timestamp"],
    )
    claims = list(
        (await db.execute(select(DisputeClaimResource).where(DisputeClaimResource.dispute_id == dispute.id))).scalars()
    )
    messages = list(
        (await db.execute(select(DisputeMessage).where(DisputeMessage.dispute_id == dispute.id))).scalars()
    )
    has_remedy = await db.scalar(
        select(DisputeResourceAction.id).where(DisputeResourceAction.dispute_id == dispute.id).limit(1)
    )

    return {
        "id": dispute.id, "order_id": dispute.order_id, "buyer_id": dispute.buyer_id,
        "reason": dispute.reason, "evidence_type": dispute.evidence_type, "evidence": dispute.evidence,
        "status": dispute.status,
        "admin_note": dispute.admin_note, "seller_note": dispute.seller_note,
        "created_at": dispute.created_at,
        "resolution_offered_at": dispute.resolution_offered_at,
        "resolution_deadline_at": dispute.resolution_deadline_at,
        "abandon_after_at": compute_abandon_after_at(
            escrow_expires_at=order.escrow_expires_at if order else None,
            last_buyer_claim_activity=last_buyer_claim_activity_at(dispute, claims),
            resolution_deadline_at=dispute.resolution_deadline_at,
            has_resource_remedy=bool(has_remedy),
        ),
        "resolved_at": dispute.resolved_at,
        "order": order_info,
        "resources": resources,
        "timeline": timeline,
    }


async def seller_respond_dispute(dispute_id: int, seller_id: int, seller_note: str, db: AsyncSession) -> dict:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if dispute.status != DisputeStatus.open:
        raise api_error(ErrorCode.DISPUTE_ALREADY_RESOLVED, status.HTTP_400_BAD_REQUEST)
    order = await db.get(Order, dispute.order_id, with_for_update=True)
    if not order or order.seller_id != seller_id:
        raise api_error(ErrorCode.NOT_OWNER, status.HTTP_403_FORBIDDEN)
    dispute.seller_note = seller_note
    # Resource-backed instant disputes need an actual remedy for every claim;
    # a note alone must never unlock automatic settlement. Proxy/task disputes
    # have no account-resource remedy, so their concrete seller response opens
    # the same buyer-response window.
    has_claims = await db.scalar(
        select(DisputeClaimResource.id)
        .where(DisputeClaimResource.dispute_id == dispute.id)
        .limit(1)
    )
    if not has_claims or await _all_claimed_resources_remedied(dispute.id, db):
        _offer_resolution_deadline(dispute)
    db.add(
        DisputeMessage(
            dispute_id=dispute.id,
            actor_id=seller_id,
            actor_role="seller",
            event_type="seller_message",
            body=seller_note,
        )
    )
    await log_event(db, "info", f"Seller responded to dispute {dispute_id}", request_id=current_request_id(),
                    metadata={"event": "dispute_seller_responded", "order_id": order.id, "seller_id": seller_id})
    await db.commit()
    await db.refresh(dispute)
    return await _enrich_dispute(dispute, db)


async def append_claim_batch(
    order_id: int,
    buyer_id: int,
    resource_ids: list[int],
    reason: str,
    idempotency_key: str,
    db: AsyncSession,
) -> dict:
    order = await db.get(Order, order_id, with_for_update=True)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != buyer_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    if order.status != OrderStatus.delivered:
        raise api_error(ErrorCode.DISPUTE_ONLY_DELIVERED, status.HTTP_400_BAD_REQUEST)
    dispute = await db.scalar(
        select(Dispute).where(
            Dispute.order_id == order_id,
            Dispute.status == DisputeStatus.open,
        ).with_for_update()
    )
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    prior = await db.scalar(
        select(DisputeClaimResource.id).where(
            DisputeClaimResource.dispute_id == dispute.id,
            DisputeClaimResource.batch_key == idempotency_key,
        )
    )
    if prior:
        return await _enrich_dispute(dispute, db)
    await _add_claim_resources(dispute, order, resource_ids, reason, idempotency_key, db)
    _clear_resolution_deadline(dispute)
    await log_event(
        db,
        "warning",
        f"Buyer added {len(resource_ids)} account(s) to dispute {dispute.id}",
        request_id=current_request_id(),
        metadata={
            "event": "dispute_claim_batch_added",
            "order_id": order.id,
            "dispute_id": dispute.id,
            "buyer_id": buyer_id,
            "resource_count": len(resource_ids),
        },
    )
    await db.commit()
    return await _enrich_dispute(dispute, db)


async def append_buyer_message(
    order_id: int,
    buyer_id: int,
    body: str,
    idempotency_key: str,
    db: AsyncSession,
) -> dict:
    order = await db.get(Order, order_id, with_for_update=True)
    if not order or order.buyer_id != buyer_id:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    dispute = await db.scalar(
        select(Dispute).where(
            Dispute.order_id == order_id,
            Dispute.status == DisputeStatus.open,
        ).with_for_update()
    )
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    prior = await db.scalar(
        select(DisputeMessage.id).where(
            DisputeMessage.dispute_id == dispute.id,
            DisputeMessage.idempotency_key == idempotency_key,
        )
    )
    if not prior:
        _clear_resolution_deadline(dispute)
        db.add(
            DisputeMessage(
                dispute_id=dispute.id,
                actor_id=buyer_id,
                actor_role="buyer",
                event_type="buyer_message",
                body=body,
                idempotency_key=idempotency_key,
            )
        )
        await db.commit()
    return await _enrich_dispute(dispute, db)


async def seller_resolve_resources(
    dispute_id: int,
    seller_id: int,
    resource_ids: list[int],
    action: str,
    replacement_resource_ids: list[int] | None,
    idempotency_key: str,
    db: AsyncSession,
    seller_note: str | None = None,
) -> dict:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    order = await db.get(Order, dispute.order_id, with_for_update=True)
    if not order or order.seller_id != seller_id:
        raise api_error(ErrorCode.NOT_OWNER, status.HTTP_403_FORBIDDEN)
    prior = list(
        (
            await db.execute(
                select(DisputeResourceAction)
                .where(
                    DisputeResourceAction.dispute_id == dispute_id,
                    DisputeResourceAction.idempotency_key == idempotency_key,
                )
                .order_by(DisputeResourceAction.id)
            )
        ).scalars()
    )
    if prior:
        return _resource_action_result(dispute, prior, retried=True)
    if dispute.status != DisputeStatus.open:
        raise api_error(ErrorCode.DISPUTE_ALREADY_RESOLVED, status.HTTP_400_BAD_REQUEST)
    variant = await db.get(ProductVariant, order.variant_id) if order.variant_id else None
    if not variant or variant.delivery_mode != DeliveryMode.instant:
        raise HTTPException(status_code=400, detail="Account-level remedies require an instant inventory order")

    found = list(
        (
            await db.execute(
                select(Resource)
                .where(
                    Resource.id.in_(resource_ids),
                    Resource.order_id == order.id,
                )
                .with_for_update()
            )
        ).scalars()
    )
    by_id = {resource.id: resource for resource in found}
    if len(by_id) != len(resource_ids):
        raise HTTPException(status_code=400, detail="Every selected account must belong to this disputed order")
    originals = [by_id[resource_id] for resource_id in resource_ids]
    claimed = set(
        (
            await db.execute(
                select(DisputeClaimResource.resource_id).where(
                    DisputeClaimResource.dispute_id == dispute_id,
                    DisputeClaimResource.resource_id.in_(resource_ids),
                )
            )
        ).scalars()
    )
    if claimed != set(resource_ids):
        raise HTTPException(status_code=400, detail="Seller may only remedy accounts claimed by the buyer")
    already_handled = await db.scalar(
        select(DisputeResourceAction.id)
        .where(
            DisputeResourceAction.dispute_id == dispute_id,
            DisputeResourceAction.original_resource_id.in_(resource_ids),
        )
        .limit(1)
    )
    if already_handled:
        raise HTTPException(status_code=409, detail="A selected account has already been remedied")
    if any(resource.refund_amount_cap is None for resource in originals):
        raise HTTPException(status_code=409, detail="This legacy order has no safe per-account refund allocation")

    replacements: list[Resource] = []
    if action == "replace":
        if replacement_resource_ids is not None:
            if len(replacement_resource_ids) != len(originals):
                raise HTTPException(status_code=400, detail="Select one replacement for each claimed account")
            available = list(
                (
                    await db.execute(
                        select(Resource)
                        .where(
                            Resource.id.in_(replacement_resource_ids),
                            Resource.variant_id == variant.id,
                            Resource.seller_id == seller_id,
                            Resource.status == ResourceStatus.available,
                            Resource.order_id.is_(None),
                            Resource.is_archived == False,  # noqa: E712
                        )
                        .with_for_update()
                    )
                ).scalars()
            )
            available_by_id = {resource.id: resource for resource in available}
            if len(available_by_id) != len(replacement_resource_ids):
                raise HTTPException(status_code=409, detail="A selected replacement is unavailable")
            replacements = [available_by_id[resource_id] for resource_id in replacement_resource_ids]
            now = datetime.now(timezone.utc)
            expires_at = now + timedelta(days=variant.duration_days) if variant.duration_days else None
            for original, replacement in zip(originals, replacements, strict=True):
                replacement.status = ResourceStatus.assigned
                replacement.assigned_at = now
                replacement.order_id = order.id
                replacement.expires_at = expires_at
                replacement.refund_amount_cap = original.refund_amount_cap
        else:
            replacements = await claim_resources(
                variant.id,
                len(originals),
                db,
                order_id=order.id,
                duration_days=variant.duration_days,
            )
            for original, replacement in zip(originals, replacements, strict=True):
                replacement.refund_amount_cap = original.refund_amount_cap
    elif action != "refund":
        raise HTTPException(status_code=400, detail="Unsupported account remedy")

    refund_amount = sum(resource.refund_amount_cap or 0 for resource in originals) if action == "refund" else 0
    if refund_amount:
        await refund_escrow(
            order.id,
            order.buyer_id,
            refund_amount,
            db,
            reference_suffix=f":dispute:{dispute.id}:{idempotency_key}",
        )
    rows: list[DisputeResourceAction] = []
    for index, original in enumerate(originals):
        original.status = ResourceStatus.error
        row = DisputeResourceAction(
            dispute_id=dispute.id,
            original_resource_id=original.id,
            replacement_resource_id=replacements[index].id if replacements else None,
            action=action,
            refund_amount=original.refund_amount_cap or 0 if action == "refund" else 0,
            idempotency_key=idempotency_key,
        )
        db.add(row)
        rows.append(row)
    await _refresh_order_delivered_data(order, db)
    if seller_note:
        dispute.seller_note = seller_note
        db.add(
            DisputeMessage(
                dispute_id=dispute.id,
                actor_id=seller_id,
                actor_role="seller",
                event_type="seller_message",
                body=seller_note,
                idempotency_key=f"{idempotency_key}:note",
            )
        )
    await db.flush()
    fully_refunded = order.refunded_amount == order.total_amount
    await log_event(
        db,
        "info",
        f"Seller remedied {len(rows)} disputed account(s)",
        request_id=current_request_id(),
        metadata={
            "event": "seller_dispute_resource_action",
            "order_id": order.id,
            "dispute_id": dispute.id,
            "seller_id": seller_id,
            "action": action,
            "resource_count": len(rows),
            "refund_amount": refund_amount,
        },
    )
    await _notify_resource_remedy(
        db,
        order=order,
        action=action,
        originals=originals,
        replacements=replacements,
    )
    if fully_refunded:
        await _finalize_dispute(
            dispute,
            order,
            db,
            status_value=DisputeStatus.resolved_refund,
            actor_id=seller_id,
            actor_role="seller",
            event_type="seller_full_refund",
            body="Seller refunded the full order amount.",
        )
    elif await _all_claimed_resources_remedied(dispute.id, db):
        _offer_resolution_deadline(dispute)
    await db.commit()
    return _resource_action_result(dispute, rows, retried=False)


def _resource_action_result(
    dispute: Dispute,
    rows: list[DisputeResourceAction],
    *,
    retried: bool,
) -> dict:
    return {
        "dispute_id": dispute.id,
        "status": dispute.status.value,
        "retried": retried,
        "actions": [
            {
                "original_resource_id": row.original_resource_id,
                "replacement_resource_id": row.replacement_resource_id,
                "action": row.action,
                "refund_amount": row.refund_amount,
            }
            for row in rows
        ],
    }


async def get_seller_dispute(order_id: int, seller_id: int, db: AsyncSession) -> dict | None:
    order = await db.get(Order, order_id)
    if not order or order.seller_id != seller_id:
        return None
    dispute = await db.scalar(
        select(Dispute)
        .where(Dispute.order_id == order_id)
        .order_by(Dispute.created_at.desc())
    )
    if not dispute:
        return None
    return await _enrich_dispute(dispute, db)


async def seller_escalate_dispute(
    dispute_id: int,
    seller_id: int,
    seller_note: str,
    db: AsyncSession,
) -> dict:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    order = await db.get(Order, dispute.order_id, with_for_update=True) if dispute else None
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if not order or order.seller_id != seller_id:
        raise api_error(ErrorCode.NOT_OWNER, status.HTTP_403_FORBIDDEN)
    if dispute.status != DisputeStatus.open:
        raise api_error(ErrorCode.DISPUTE_ALREADY_RESOLVED, status.HTTP_400_BAD_REQUEST)
    dispute.seller_note = seller_note
    db.add(
        DisputeMessage(
            dispute_id=dispute.id,
            actor_id=seller_id,
            actor_role="seller",
            event_type="case_escalated",
            body=seller_note,
        )
    )
    await log_event(
        db,
        "warning",
        f"Seller escalated dispute {dispute_id}",
        request_id=current_request_id(),
        metadata={
            "event": "seller_dispute_escalated",
            "order_id": order.id,
            "seller_id": seller_id,
        },
    )
    await db.commit()
    return await _enrich_dispute(dispute, db)


async def seller_dispute_resources(
    dispute_id: int,
    seller_id: int,
    db: AsyncSession,
    *,
    search: str | None,
    page: int,
    per_page: int,
    pending_only: bool = False,
    ids_only: bool = False,
) -> dict:
    dispute = await db.get(Dispute, dispute_id)
    order = await db.get(Order, dispute.order_id) if dispute else None
    if not dispute or not order or order.seller_id != seller_id:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    claimed_ids = select(DisputeClaimResource.resource_id).where(
        DisputeClaimResource.dispute_id == dispute_id
    )
    filters = [Resource.id.in_(claimed_ids)]
    search_clause = _resource_search_clause(search)
    if search_clause is not None:
        filters.append(search_clause)
    if pending_only:
        handled_ids = select(DisputeResourceAction.original_resource_id).where(
            DisputeResourceAction.dispute_id == dispute_id
        )
        filters.append(~Resource.id.in_(handled_ids))
    total = int(await db.scalar(select(func.count()).select_from(Resource).where(*filters)) or 0)
    if ids_only:
        ids = list(
            (
                await db.execute(
                    select(Resource.id).where(*filters).order_by(Resource.id).limit(_DISPUTE_ID_LIST_LIMIT)
                )
            ).scalars()
        )
        return {"items": [], "ids": ids, "total": total, "page": 1, "per_page": len(ids)}
    resources = list(
        (
            await db.execute(
                select(Resource)
                .where(*filters)
                .order_by(Resource.id)
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).scalars()
    )
    history = {
        row.original_resource_id: row
        for row in (
            await db.execute(
                select(DisputeResourceAction).where(
                    DisputeResourceAction.dispute_id == dispute_id
                )
            )
        ).scalars()
    }
    return {
        "items": [
            {
                "id": resource.id,
                "status": resource.status.value,
                "expires_at": resource.expires_at,
                "data": resource.data,
                "refund_amount_cap": resource.refund_amount_cap,
                "action": history[resource.id].action if resource.id in history else None,
                "replacement_resource_id": (
                    history[resource.id].replacement_resource_id
                    if resource.id in history
                    else None
                ),
            }
            for resource in resources
        ],
        "ids": [],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


async def seller_replacement_resources(
    dispute_id: int,
    seller_id: int,
    db: AsyncSession,
    *,
    search: str | None,
    page: int,
    per_page: int,
    ids_only: bool = False,
) -> dict:
    dispute = await db.get(Dispute, dispute_id)
    order = await db.get(Order, dispute.order_id) if dispute else None
    if not dispute or not order or order.seller_id != seller_id or not order.variant_id:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    filters = [
        Resource.variant_id == order.variant_id,
        Resource.seller_id == seller_id,
        Resource.status == ResourceStatus.available,
        Resource.order_id.is_(None),
        Resource.is_archived == False,  # noqa: E712
    ]
    search_clause = _resource_search_clause(search)
    if search_clause is not None:
        filters.append(search_clause)
    total = int(await db.scalar(select(func.count()).select_from(Resource).where(*filters)) or 0)
    if ids_only:
        ids = list(
            (
                await db.execute(
                    select(Resource.id).where(*filters).order_by(Resource.id).limit(_DISPUTE_ID_LIST_LIMIT)
                )
            ).scalars()
        )
        return {"items": [], "ids": ids, "total": total, "page": 1, "per_page": len(ids)}
    resources = list(
        (
            await db.execute(
                select(Resource)
                .where(*filters)
                .order_by(Resource.id)
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).scalars()
    )
    return {
        "items": [{"id": resource.id, "data": resource.data} for resource in resources],
        "ids": [],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


async def list_seller_open_disputes(seller_id: int, db: AsyncSession) -> list[dict]:
    """Open disputes for this seller that still have an empty seller_note.

    Used for the seller action bell. A missing note is not an automatic loss.
    """
    result = await db.execute(
        select(Dispute).join(Order, Order.id == Dispute.order_id)
        .where(Order.seller_id == seller_id, Dispute.status == DisputeStatus.open, Dispute.seller_note.is_(None))
        .order_by(Dispute.created_at.desc())
    )
    return [await _enrich_dispute(d, db) for d in result.scalars().all()]


async def list_seller_disputes(
    seller_id: int,
    db: AsyncSession,
    *,
    page: int,
    per_page: int,
    status_filter: str | None = None,
) -> dict:
    base = (
        select(Dispute)
        .join(Order, Order.id == Dispute.order_id)
        .where(Order.seller_id == seller_id)
    )
    if status_filter == "open":
        base = base.where(Dispute.status == DisputeStatus.open)
    total = int(await db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    disputes = list(
        (
            await db.execute(
                base.order_by(Dispute.created_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).scalars()
    )
    return {
        "items": [await _enrich_dispute(dispute, db) for dispute in disputes],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


async def get_buyer_dispute(order_id: int, buyer_id: int, db: AsyncSession) -> dict | None:
    order = await db.get(Order, order_id)
    if not order or order.buyer_id != buyer_id:
        return None
    dispute = await db.scalar(
        select(Dispute)
        .where(Dispute.order_id == order_id)
        .order_by(Dispute.created_at.desc())
    )
    if not dispute:
        return None
    return await _enrich_dispute(dispute, db)


async def accept_dispute_resolution(order_id: int, buyer_id: int, db: AsyncSession) -> dict:
    order = await db.get(Order, order_id, with_for_update=True)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != buyer_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    dispute = await db.scalar(
        select(Dispute).where(
            Dispute.order_id == order_id,
            Dispute.status == DisputeStatus.open,
        ).with_for_update()
    )
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    claimed = set(
        (
            await db.execute(
                select(DisputeClaimResource.resource_id).where(
                    DisputeClaimResource.dispute_id == dispute.id
                )
            )
        ).scalars()
    )
    remedied = set(
        (
            await db.execute(
                select(DisputeResourceAction.original_resource_id).where(
                    DisputeResourceAction.dispute_id == dispute.id
                )
            )
        ).scalars()
    )
    if claimed and claimed - remedied:
        raise HTTPException(status_code=409, detail="Every claimed account must be remedied before acceptance")
    if not claimed and not dispute.seller_note:
        raise HTTPException(status_code=409, detail="The seller has not responded yet")

    actions = list(
        (
            await db.execute(
                select(DisputeResourceAction).where(
                    DisputeResourceAction.dispute_id == dispute.id
                )
            )
        ).scalars()
    )
    if any(action.action == "refund" for action in actions):
        outcome = DisputeStatus.resolved_partial_refund
    elif actions:
        outcome = DisputeStatus.resolved_replace
    else:
        outcome = DisputeStatus.resolved_reject
    await _finalize_dispute(
        dispute,
        order,
        db,
        status_value=outcome,
        actor_id=buyer_id,
        actor_role="buyer",
        event_type="buyer_accepted",
        body="Buyer accepted the applied resolution.",
    )
    await db.commit()
    await db.refresh(dispute)
    return await _enrich_dispute(dispute, db)


async def withdraw_dispute(order_id: int, buyer_id: int, db: AsyncSession) -> dict:
    """Let the buyer withdraw an untouched case and resume the original escrow clock."""
    order = await db.get(Order, order_id, with_for_update=True)
    if not order:
        raise api_error(ErrorCode.ORDER_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if order.buyer_id != buyer_id:
        raise api_error(ErrorCode.NOT_ORDER_OWNER, status.HTTP_403_FORBIDDEN)
    dispute = await db.scalar(
        select(Dispute).where(
            Dispute.order_id == order_id,
            Dispute.status == DisputeStatus.open,
        ).with_for_update()
    )
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    has_remedy = await db.scalar(
        select(DisputeResourceAction.id)
        .where(DisputeResourceAction.dispute_id == dispute.id)
        .limit(1)
    )
    if has_remedy:
        raise api_error(ErrorCode.DISPUTE_WITHDRAWAL_NOT_ALLOWED, status.HTTP_409_CONFLICT)

    dispute.status = DisputeStatus.withdrawn_by_buyer
    dispute.resolved_at = datetime.now(timezone.utc)
    _clear_resolution_deadline(dispute)
    db.add(DisputeMessage(
        dispute_id=dispute.id,
        actor_id=buyer_id,
        actor_role="buyer",
        event_type="buyer_withdrew",
        body="Buyer withdrew this dispute.",
    ))

    # The original escrow expiry is never extended or restarted by a dispute.
    # If it elapsed while the case was open, settle now under the same locks;
    # otherwise the ordinary escrow job will complete it at that original time.
    # A legacy delivered order with no expiry has no scheduler completion path,
    # so buyer withdrawal is its explicit confirmation to settle immediately.
    now = datetime.now(timezone.utc)
    should_settle = not order.escrow_expires_at or order.escrow_expires_at <= now
    if order.status == OrderStatus.delivered and should_settle:
        seller = await db.get(Account, order.seller_id)
        fee_percent = platform_fee_percent(seller.seller_tier if seller else "new")
        remaining_amount, platform_fee = escrow_settlement(
            order.total_amount, order.refunded_amount, fee_percent
        )
        if remaining_amount:
            await release_escrow(order.id, order.seller_id, remaining_amount, platform_fee, db)
        order.status = OrderStatus.completed
        from src.affiliate.service import apply_affiliate_commission
        await apply_affiliate_commission(order, db)
    await log_event(
        db, "info", f"Buyer withdrew dispute {dispute.id}", request_id=current_request_id(),
        metadata={"event": "dispute_withdrawn", "order_id": order.id, "dispute_id": dispute.id, "buyer_id": buyer_id},
    )
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return await _enrich_dispute(dispute, db)


async def resolve_abandoned_dispute(
    dispute: Dispute,
    order: Order,
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> None:
    """Settle an untouched open case after escrow expiry plus buyer silence."""
    current_time = now or datetime.now(timezone.utc)
    has_remedy = await db.scalar(
        select(DisputeResourceAction.id)
        .where(DisputeResourceAction.dispute_id == dispute.id)
        .limit(1)
    )
    claims = list(
        (
            await db.execute(
                select(DisputeClaimResource).where(DisputeClaimResource.dispute_id == dispute.id)
            )
        ).scalars()
    )
    messages = list(
        (
            await db.execute(
                select(DisputeMessage).where(DisputeMessage.dispute_id == dispute.id)
            )
        ).scalars()
    )
    abandon_at = compute_abandon_after_at(
        escrow_expires_at=order.escrow_expires_at,
            last_buyer_claim_activity=last_buyer_claim_activity_at(dispute, claims),
        resolution_deadline_at=dispute.resolution_deadline_at,
        has_resource_remedy=bool(has_remedy),
    )
    if dispute.status != DisputeStatus.open or not abandon_at or abandon_at > current_time:
        raise ValueError("Dispute is not eligible for abandonment settlement")
    await _finalize_dispute(
        dispute,
        order,
        db,
        status_value=DisputeStatus.resolved_abandoned,
        actor_id=1,
        actor_role="admin",
        event_type="resolution_abandoned",
        body="Buyer activity stopped after escrow expiry; remaining escrow was released to the seller.",
    )
    await log_event(
        db,
        "info",
        f"Dispute {dispute.id} auto-resolved after buyer abandonment",
        metadata={
            "event": "dispute_abandoned",
            "order_id": order.id,
            "dispute_id": dispute.id,
            "abandon_after_at": abandon_at.isoformat(),
        },
    )


async def resolve_dispute_after_response_timeout(
    dispute: Dispute,
    order: Order,
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> None:
    """Settle an unanswered seller offer after its buyer-response deadline."""
    current_time = now or datetime.now(timezone.utc)
    if (
        dispute.status != DisputeStatus.open
        or not dispute.resolution_deadline_at
        or dispute.resolution_deadline_at > current_time
    ):
        raise ValueError("Dispute is not eligible for response-timeout settlement")
    deadline_at = dispute.resolution_deadline_at
    await _finalize_dispute(
        dispute,
        order,
        db,
        status_value=DisputeStatus.resolved_timeout,
        actor_id=1,
        # The persisted timeline currently permits buyer/seller/admin only;
        # actor_id 1 is the platform account. The response projection renders
        # resolved_timeout as a system event.
        actor_role="admin",
        event_type="resolution_timeout",
        body="Buyer response deadline elapsed; the resolution was applied automatically.",
    )
    await log_event(
        db,
        "info",
        f"Dispute {dispute.id} auto-resolved after buyer response deadline",
        metadata={
            "event": "dispute_resolution_timeout",
            "order_id": order.id,
            "dispute_id": dispute.id,
            "deadline_at": deadline_at.isoformat(),
        },
    )


async def refund_dispute(dispute_id: int, admin_note: str, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if dispute.status != DisputeStatus.open:
        raise api_error(ErrorCode.DISPUTE_ALREADY_RESOLVED, status.HTTP_400_BAD_REQUEST)

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    dispute.status = DisputeStatus.resolved_refund
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)
    order.status = OrderStatus.refunded

    remaining_amount = order.total_amount - order.refunded_amount
    if remaining_amount:
        await refund_escrow(
            order.id,
            order.buyer_id,
            remaining_amount,
            db,
        )
    from src.affiliate.service import clawback_commission_for_order
    await clawback_commission_for_order(order, db)
    await log_event(db, "info", f"Dispute {dispute_id} refunded", request_id=current_request_id(),
                    metadata={"event": "dispute_refunded", "order_id": order.id, "amount": remaining_amount})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def reject_dispute(dispute_id: int, admin_note: str, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if dispute.status != DisputeStatus.open:
        raise api_error(ErrorCode.DISPUTE_ALREADY_RESOLVED, status.HTTP_400_BAD_REQUEST)

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    dispute.status = DisputeStatus.resolved_reject
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)
    order.status = OrderStatus.completed

    seller = await db.get(Account, order.seller_id)
    fee_percent = platform_fee_percent(seller.seller_tier if seller else "new")
    remaining_amount, platform_fee = escrow_settlement(
        order.total_amount, order.refunded_amount, fee_percent
    )
    if remaining_amount:
        await release_escrow(order.id, order.seller_id, remaining_amount, platform_fee, db)
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Dispute {dispute_id} rejected", request_id=current_request_id(),
                    metadata={"event": "dispute_rejected", "order_id": order.id, "amount": remaining_amount})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def partial_refund_dispute(dispute_id: int, admin_note: str, refund_amount: int, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if dispute.status != DisputeStatus.open:
        raise api_error(ErrorCode.DISPUTE_ALREADY_RESOLVED, status.HTTP_400_BAD_REQUEST)

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    remaining_before_refund = order.total_amount - order.refunded_amount
    if refund_amount <= 0 or refund_amount >= remaining_before_refund:
        raise api_error(ErrorCode.DISPUTE_INVALID_REFUND_AMOUNT, status.HTTP_400_BAD_REQUEST)

    dispute.status = DisputeStatus.resolved_partial_refund
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)
    order.status = OrderStatus.completed

    await refund_escrow(
        order.id,
        order.buyer_id,
        refund_amount,
        db,
        reference_suffix=f":dispute:{dispute.id}:admin-partial",
    )

    seller = await db.get(Account, order.seller_id)
    fee_percent = platform_fee_percent(seller.seller_tier if seller else "new")
    remaining_amount, platform_fee = escrow_settlement(
        order.total_amount, order.refunded_amount, fee_percent
    )
    if remaining_amount:
        await release_escrow(order.id, order.seller_id, remaining_amount, platform_fee, db)
    from src.affiliate.service import apply_affiliate_commission
    await apply_affiliate_commission(order, db)
    await log_event(db, "info", f"Dispute {dispute_id} partially refunded", request_id=current_request_id(),
                    metadata={"event": "dispute_partial_refunded", "order_id": order.id, "refund_amount": refund_amount})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def replace_dispute(dispute_id: int, admin_note: str, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if dispute.status != DisputeStatus.open:
        raise api_error(ErrorCode.DISPUTE_ALREADY_RESOLVED, status.HTTP_400_BAD_REQUEST)

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    variant = await db.get(ProductVariant, order.variant_id) if order.variant_id else None
    if not variant or variant.delivery_mode != DeliveryMode.instant:
        raise api_error(ErrorCode.DISPUTE_REPLACEMENT_UNAVAILABLE, status.HTTP_400_BAD_REQUEST)

    existing_resource_action = await db.scalar(
        select(DisputeResourceAction.id)
        .where(DisputeResourceAction.dispute_id == dispute.id)
        .limit(1)
    )
    if existing_resource_action:
        raise HTTPException(
            status_code=409,
            detail="A case with account-level remedies cannot also receive a full-order replacement",
        )

    old_resources = (await db.execute(
        select(Resource).where(Resource.order_id == order.id)
    )).scalars().all()
    if not old_resources:
        raise api_error(ErrorCode.DISPUTE_NO_RESOURCES_TO_REPLACE, status.HTTP_400_BAD_REQUEST)

    for resource in old_resources:
        resource.status = ResourceStatus.error
    new_resources = await claim_resources(
        variant.id, order.quantity, db, order_id=order.id, duration_days=variant.duration_days,
    )
    refund_base, refund_remainder = divmod(
        order.total_amount - order.refunded_amount,
        len(new_resources),
    )
    for index, resource in enumerate(new_resources):
        resource.refund_amount_cap = refund_base + (1 if index < refund_remainder else 0)
    order.delivered_data = "\n".join(r.data for r in new_resources)

    product = await db.get(Product, order.product_id) if order.product_id else await db.get(Product, variant.product_id)
    base_escrow_days = product.escrow_days if product else 2
    seller = await db.get(Account, order.seller_id)
    order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(
        days=tier_escrow_days(seller.seller_tier if seller else "new", base_escrow_days)
    )
    order.status = OrderStatus.delivered

    dispute.status = DisputeStatus.resolved_replace
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)

    await log_event(db, "info", f"Dispute {dispute_id} resolved via replacement", request_id=current_request_id(),
                    metadata={"event": "dispute_replaced", "order_id": order.id})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute


async def extend_warranty_dispute(dispute_id: int, admin_note: str, extra_days: int, db: AsyncSession) -> Dispute:
    dispute = await db.get(Dispute, dispute_id, with_for_update=True)
    if not dispute:
        raise api_error(ErrorCode.DISPUTE_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    if dispute.status != DisputeStatus.open:
        raise api_error(ErrorCode.DISPUTE_ALREADY_RESOLVED, status.HTTP_400_BAD_REQUEST)
    if extra_days <= 0:
        raise api_error(ErrorCode.DISPUTE_INVALID_EXTENSION_DAYS, status.HTTP_400_BAD_REQUEST)

    order = await db.get(Order, dispute.order_id, with_for_update=True)
    base = order.escrow_expires_at or datetime.now(timezone.utc)
    order.escrow_expires_at = base + timedelta(days=extra_days)
    order.status = OrderStatus.delivered

    dispute.status = DisputeStatus.resolved_extend_warranty
    dispute.admin_note = admin_note
    dispute.resolved_at = datetime.now(timezone.utc)

    await log_event(db, "info", f"Dispute {dispute_id} resolved via warranty extension", request_id=current_request_id(),
                    metadata={"event": "dispute_warranty_extended", "order_id": order.id, "extra_days": extra_days})
    await _enqueue_dispute_resolved(db, dispute, order)
    await db.commit()
    await db.refresh(dispute)
    return dispute
