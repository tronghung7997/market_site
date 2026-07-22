"""DProxy allocation binding/lifecycle. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md Task 2 + Task 5.

Deliberately separate from resources/service.py (that module owns the
seller_pool resource inventory — a different domain that predates DProxy and
has its own claim/release semantics). A ProxyAllocation row is not a
Resource row.
"""
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.base import ProxyAssignment
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus


async def get_order_proxy_allocation(order_id: int, db: AsyncSession, *, for_update: bool = False) -> ProxyAllocation | None:
    q = select(ProxyAllocation).where(ProxyAllocation.order_id == order_id)
    if for_update:
        q = q.with_for_update()
    return await db.scalar(q)


def _apply_assignment(allocation: ProxyAllocation, assignment: ProxyAssignment) -> None:
    allocation.external_proxy_id = assignment.proxy_id
    allocation.expires_at = assignment.expires_at
    allocation.rotate_path = assignment.rotate_path
    allocation.rotation_available = assignment.rotation_available
    allocation.cooldown_seconds = assignment.cooldown_seconds
    allocation.last_rotated_at = assignment.last_rotated_at
    allocation.last_public_ip = assignment.public_ip
    allocation.status = ProxyAllocationStatus.allocated


async def bind_first_available_assignment(
    provider_id: int, order_id: int, assignments: list[ProxyAssignment], db: AsyncSession,
) -> ProxyAllocation | None:
    """Bind exactly one unbound usable DProxy assignment to `order_id`,
    exclusively.

    Idempotent: if the order already has a binding, refresh it from the
    matching supplier assignment and return it — never select a different
    proxy for an order that may already have been delivered credentials.
    If the previously-bound external_id is missing from the fresh
    `assignments` (expired/removed upstream), mark it `error` and return
    None rather than silently substituting a replacement.

    Concurrency-safe for two orders provisioning at once: each tries
    candidates in `assignments` order inside its own SAVEPOINT.
    UNIQUE(provider_id, external_id) is the actual source of truth — the
    savepoint just lets a loser roll back and try the next candidate
    instead of failing the whole provision.
    """
    existing = await get_order_proxy_allocation(order_id, db)
    if existing is not None:
        match = next((a for a in assignments if a.external_id == existing.external_id), None)
        if match is not None:
            _apply_assignment(existing, match)
            await db.flush()
            return existing
        existing.status = ProxyAllocationStatus.error
        await db.flush()
        return None

    for assignment in assignments:
        try:
            async with db.begin_nested():
                allocation = ProxyAllocation(
                    provider_id=provider_id, order_id=order_id, external_id=assignment.external_id,
                )
                _apply_assignment(allocation, assignment)
                db.add(allocation)
                await db.flush()
        except IntegrityError:
            continue
        return allocation
    return None


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


def apply_rotated_assignment(allocation: ProxyAllocation, assignment: ProxyAssignment) -> bool:
    """Update `allocation` from a post-rotate list refresh. Returns True iff
    buyer-visible credentials actually changed (public_ip/password/expiry) —
    the caller (proxy_router.py) only needs to touch Order.delivered_data
    when something changed."""
    changed = (
        allocation.last_public_ip != assignment.public_ip
        or allocation.expires_at != assignment.expires_at
    )
    _apply_assignment(allocation, assignment)
    return changed
