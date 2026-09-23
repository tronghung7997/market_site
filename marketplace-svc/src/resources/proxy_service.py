"""DProxy allocation binding/lifecycle. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md Task 2 + Task 5.

Deliberately separate from resources/service.py (that module owns the
seller_pool resource inventory — a different domain that predates DProxy and
has its own claim/release semantics). A ProxyAllocation row is not a
Resource row.
"""
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import ProxyAssignment
from src.models.proxy_allocation import (
    ProxyAllocation, ProxyAllocationSource, ProxyAllocationStatus, UpstreamRevocation,
)

logger = structlog.get_logger()


async def get_order_proxy_allocation(order_id: int, db: AsyncSession, *, for_update: bool = False) -> ProxyAllocation | None:
    q = select(ProxyAllocation).where(ProxyAllocation.order_id == order_id)
    if for_update:
        q = q.with_for_update()
    return await db.scalar(q)


def _apply_assignment(allocation: ProxyAllocation, assignment: ProxyAssignment) -> None:
    """Copy metadata fields only — never touches `status`. Every caller sets
    `status` itself right after, because what status is CORRECT depends on
    context (see review fixes Blocker 2: a fresh provisioning bind is always
    `allocated`, but a reconciliation refresh might be `allocated`,
    `offline`, or `expired` depending on the assignment's current state)."""
    allocation.external_proxy_id = assignment.proxy_id
    allocation.expires_at = assignment.expires_at
    allocation.rotate_path = assignment.rotate_path
    allocation.rotation_available = assignment.rotation_available
    allocation.cooldown_seconds = assignment.cooldown_seconds
    allocation.last_rotated_at = assignment.last_rotated_at
    allocation.last_public_ip = assignment.public_ip


async def bind_first_available_assignment(
    provider_id: int, order_id: int, assignments: list[ProxyAssignment], db: AsyncSession,
) -> ProxyAllocation | None:
    """Bind exactly one unbound, currently-usable DProxy assignment to
    `order_id`, exclusively. `assignments` must be the FULL (unfiltered)
    inventory — usability is applied here, not by the caller — so the
    idempotent-retry path below can tell "temporarily offline" apart from
    "genuinely gone".

    Idempotent: if the order already has a binding, refresh it from the
    matching supplier assignment (whatever its current state) and return it
    — never select a DIFFERENT proxy for an order that may already have
    been delivered credentials:
      - present and usable → `allocated`, return the allocation (success).
      - present but expired → `expired`, return None (this attempt fails;
        nothing left to deliver).
      - present but offline/inactive → `offline`, return None (this
        attempt fails; the next provision retry may find it usable again —
        review fixes Blocker 2).
      - absent entirely → `error`, return None.

    Concurrency-safe for two orders provisioning at once: each tries usable
    candidates in `assignments` order inside its own SAVEPOINT.
    UNIQUE(provider_id, external_id) is the actual source of truth — the
    savepoint just lets a loser roll back and try the next candidate
    instead of failing the whole provision.
    """
    now = datetime.now(timezone.utc)
    by_external_id = {a.external_id: a for a in assignments}

    existing = await get_order_proxy_allocation(order_id, db)
    if existing is not None:
        match = by_external_id.get(existing.external_id)
        if match is None:
            existing.status = ProxyAllocationStatus.error
            await db.flush()
            return None
        _apply_assignment(existing, match)
        if match.expires_at <= now:
            existing.status = ProxyAllocationStatus.expired
            await db.flush()
            return None
        if not match.online:
            existing.status = ProxyAllocationStatus.offline
            await db.flush()
            return None
        existing.status = ProxyAllocationStatus.allocated
        await db.flush()
        return existing

    for assignment in assignments:
        if not assignment.is_usable(now=now):
            continue
        try:
            async with db.begin_nested():
                allocation = ProxyAllocation(
                    provider_id=provider_id, order_id=order_id, external_id=assignment.external_id,
                )
                _apply_assignment(allocation, assignment)
                allocation.status = ProxyAllocationStatus.allocated
                db.add(allocation)
                await db.flush()
        except IntegrityError:
            continue
        return allocation
    return None


async def find_allocation_by_external_id(
    provider_id: int | None, external_id: str, db: AsyncSession,
) -> ProxyAllocation | None:
    if provider_id is None:
        return None
    return await db.scalar(
        select(ProxyAllocation).where(
            ProxyAllocation.provider_id == provider_id, ProxyAllocation.external_id == external_id,
        )
    )


async def bind_purchased_assignment(
    provider_id: int, order_id: int, assignment: ProxyAssignment, db: AsyncSession, *,
    partner_order_id: str | None = None, upstream_order_id: str | None = None,
    cost_usd: Decimal | None = None,
) -> ProxyAllocation:
    """Bind a FRESHLY-PURCHASED assignment (config-strategy provision path,
    see DProxyAdapter._provision_via_purchase) to `order_id`. Caller is
    responsible for the idempotency check and for refusing an external_id
    that another order already holds (the live API has been seen handing
    back an existing assignment) — UNIQUE(provider_id, external_id) is only
    the last line of defence here.

    Chốt `partner_order_id` đã dùng để mua (thu hồi đọc lại đúng id này) và
    giá vốn thượng nguồn, quy đổi VND theo tỷ giá hiển thị lúc giao."""
    allocation = ProxyAllocation(
        provider_id=provider_id, order_id=order_id, external_id=assignment.external_id,
        source=ProxyAllocationSource.purchase.value,
        partner_order_id=partner_order_id, upstream_order_id=upstream_order_id,
        upstream_cost_usd=cost_usd,
    )
    if cost_usd is not None:
        from src.money.service import get_effective_rate

        rate = await get_effective_rate(db)
        if rate:
            allocation.upstream_cost_vnd = int((cost_usd * rate).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    _apply_assignment(allocation, assignment)
    allocation.status = ProxyAllocationStatus.allocated
    db.add(allocation)
    await db.flush()
    return allocation


async def enqueue_upstream_revocation(
    provider_id: int, order_id: int, partner_order_id: str, reason: str, db: AsyncSession,
) -> None:
    """Xếp một lệnh partner-dispute vào outbox, TRONG transaction của caller
    (hoàn tiền / huỷ đơn). Không commit, không gọi mạng: lệnh chỉ tồn tại khi
    transaction đó commit, và `upstream_revocation_job` gửi nó sau. Gọi lại
    cho cùng (provider, partner_order_id) là no-op."""
    stmt = pg_insert(UpstreamRevocation.__table__).values(
        provider_id=provider_id, order_id=order_id, partner_order_id=partner_order_id,
        reason=reason[:64], status="pending", attempts=0,
    ).on_conflict_do_nothing(constraint="uq_upstream_revocations_partner_order")
    await db.execute(stmt)
    await db.flush()
    logger.info("upstream_revocation_queued", provider_id=provider_id, order_id=order_id, reason=reason)


async def revoke_order_proxy(order_id: int, provider_id: int | None, db: AsyncSession) -> bool | None:
    """Thu hồi proxy thượng nguồn của một đơn vừa được HOÀN TIỀN TOÀN BỘ
    (dispute refund, deadline refund). Best-effort: trả None khi đơn không
    có allocation/adapter không hỗ trợ, True/False theo kết quả revoke.
    Không bao giờ raise — refund đã xong, việc thu hồi hỏng chỉ được ghi log
    để admin đối soát, không được làm hỏng transaction hoàn tiền."""
    if not provider_id:
        return None
    allocation = await get_order_proxy_allocation(order_id, db)
    if allocation is None or allocation.status in (
        ProxyAllocationStatus.released, ProxyAllocationStatus.expired,
    ):
        return None
    from src.adapters.factory import get_binding_adapter

    try:
        adapter = await get_binding_adapter(provider_id, db)
        return bool(await adapter.revoke(allocation.external_id))
    except Exception as e:  # noqa: BLE001 — refund đã commit-được, chỉ log
        logger.warning(
            "order_proxy_revoke_failed", order_id=order_id, provider_id=provider_id, error=str(e),
        )
        return False


async def mark_allocation_expired(allocation: ProxyAllocation, db: AsyncSession) -> None:
    allocation.status = ProxyAllocationStatus.expired
    await db.flush()


async def release_allocation(provider_id: int, external_id: str, db: AsyncSession) -> None:
    """Releases the marketplace-side binding only — no DProxy revoke
    endpoint is supplied (see plan §"Open contract questions" #5), so this
    never cancels the upstream subscription."""
    allocation = await db.scalar(
        select(ProxyAllocation).where(
            ProxyAllocation.provider_id == provider_id, ProxyAllocation.external_id == external_id,
        )
    )
    if allocation is not None and allocation.status == ProxyAllocationStatus.allocated:
        allocation.status = ProxyAllocationStatus.released
        await db.flush()


def apply_rotated_assignment(allocation: ProxyAllocation, assignment: ProxyAssignment) -> None:
    """Update `allocation` from a post-rotate list refresh. A successful
    rotate implies the assignment is online, so this always sets `allocated`.

    Does NOT try to detect whether credentials "changed" — a prior version
    compared only public_ip/expiry, but DProxy can rotate the password (or
    in principle username/host/port) without moving the IP or extending the
    expiry, and none of those are stored on ProxyAllocation to compare
    against (deliberately: no plaintext credentials at rest here beyond what
    Order.delivered_data already snapshots). Review fixes Blocker 1: the
    caller (proxy_router.py) must unconditionally refresh
    `Order.delivered_data` after every successful rotate, not only when this
    function reports a change."""
    _apply_assignment(allocation, assignment)
    allocation.status = ProxyAllocationStatus.allocated
    allocation.consecutive_misses = 0
