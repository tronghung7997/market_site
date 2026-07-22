"""Task 2 — exclusive DProxy assignment-to-order binding. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from src.adapters.base import ProxyAssignment
from src.database import SessionLocal
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.provider import Provider
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus
from src.resources.proxy_service import bind_first_available_assignment, bind_purchased_assignment, release_allocation


async def _make_account(email: str) -> int:
    async with SessionLocal() as db:
        acc = Account(email=email, password_hash="x")
        db.add(acc)
        await db.commit()
        await db.refresh(acc)
        return acc.id


async def _make_provider() -> int:
    async with SessionLocal() as db:
        p = Provider(
            name="DProxy", type="dproxy", adapter_type="dproxy",
            config={"base_url": "https://dproxy.example.com"},
        )
        db.add(p)
        await db.commit()
        await db.refresh(p)
        return p.id


async def _make_order(buyer_id: int, seller_id: int) -> int:
    async with SessionLocal() as db:
        o = Order(buyer_id=buyer_id, seller_id=seller_id, quantity=1, total_amount=1000, status=OrderStatus.pending)
        db.add(o)
        await db.commit()
        await db.refresh(o)
        return o.id


def _assignment(external_id: str, **overrides) -> ProxyAssignment:
    base = dict(
        external_id=external_id, proxy_id=None, host="s4.dproxy.info", port=20160,
        username="u", password="p", public_ip="1.2.3.4",
        assigned_at=None, expires_at=datetime.now(timezone.utc) + timedelta(days=5),
        online=True, rotation_available=True, rotation_mode="pppoe", cooldown_seconds=None,
        last_rotated_at=None, rotate_path=f"/api/v1/proxies/user/{external_id}/rotate",
    )
    base.update(overrides)
    return ProxyAssignment(**base)


@pytest.mark.asyncio
async def test_binds_first_candidate_and_persists_its_fields():
    buyer = await _make_account("dpx_alloc_buyer1@example.com")
    seller = await _make_account("dpx_alloc_seller1@example.com")
    provider_id = await _make_provider()
    order_id = await _make_order(buyer, seller)

    async with SessionLocal() as db:
        allocation = await bind_first_available_assignment(
            provider_id, order_id, [_assignment("ext-1"), _assignment("ext-2")], db,
        )
        await db.commit()

    assert allocation is not None
    assert allocation.external_id == "ext-1"
    assert allocation.rotation_available is True
    assert allocation.status == ProxyAllocationStatus.allocated


@pytest.mark.asyncio
async def test_idempotent_retry_returns_the_same_binding_not_a_new_one():
    buyer = await _make_account("dpx_alloc_buyer2@example.com")
    seller = await _make_account("dpx_alloc_seller2@example.com")
    provider_id = await _make_provider()
    order_id = await _make_order(buyer, seller)
    assignments = [_assignment("ext-a")]

    async with SessionLocal() as db:
        first = await bind_first_available_assignment(provider_id, order_id, assignments, db)
        await db.commit()
        first_id = first.id

    async with SessionLocal() as db:
        second = await bind_first_available_assignment(provider_id, order_id, assignments, db)
        await db.commit()

    assert second.id == first_id
    assert second.external_id == "ext-a"


@pytest.mark.asyncio
async def test_idempotent_retry_when_bound_assignment_vanished_flags_error_and_returns_none():
    buyer = await _make_account("dpx_alloc_buyer3@example.com")
    seller = await _make_account("dpx_alloc_seller3@example.com")
    provider_id = await _make_provider()
    order_id = await _make_order(buyer, seller)

    async with SessionLocal() as db:
        first = await bind_first_available_assignment(provider_id, order_id, [_assignment("ext-gone")], db)
        await db.commit()
        allocation_id = first.id

    async with SessionLocal() as db:
        # Fresh inventory no longer contains ext-gone — must not silently
        # substitute a different credential.
        result = await bind_first_available_assignment(provider_id, order_id, [_assignment("ext-other")], db)
        await db.commit()
    assert result is None

    async with SessionLocal() as db:
        allocation = await db.get(ProxyAllocation, allocation_id)
        assert allocation.status == ProxyAllocationStatus.error


@pytest.mark.asyncio
async def test_two_orders_with_two_assignments_each_get_a_different_one():
    buyer = await _make_account("dpx_alloc_buyer4@example.com")
    seller = await _make_account("dpx_alloc_seller4@example.com")
    provider_id = await _make_provider()
    order1 = await _make_order(buyer, seller)
    order2 = await _make_order(buyer, seller)
    assignments = [_assignment("ext-x"), _assignment("ext-y")]

    async with SessionLocal() as db:
        a1 = await bind_first_available_assignment(provider_id, order1, assignments, db)
        await db.commit()
    async with SessionLocal() as db:
        a2 = await bind_first_available_assignment(provider_id, order2, assignments, db)
        await db.commit()

    assert {a1.external_id, a2.external_id} == {"ext-x", "ext-y"}


@pytest.mark.asyncio
async def test_second_order_reports_out_of_stock_when_the_only_assignment_is_taken():
    buyer = await _make_account("dpx_alloc_buyer5@example.com")
    seller = await _make_account("dpx_alloc_seller5@example.com")
    provider_id = await _make_provider()
    order1 = await _make_order(buyer, seller)
    order2 = await _make_order(buyer, seller)
    assignments = [_assignment("ext-solo")]

    async with SessionLocal() as db:
        a1 = await bind_first_available_assignment(provider_id, order1, assignments, db)
        await db.commit()
    assert a1 is not None

    async with SessionLocal() as db:
        a2 = await bind_first_available_assignment(provider_id, order2, assignments, db)
        await db.commit()
    assert a2 is None


@pytest.mark.asyncio
async def test_concurrent_orders_racing_for_one_assignment_exactly_one_succeeds():
    buyer = await _make_account("dpx_alloc_buyer6@example.com")
    seller = await _make_account("dpx_alloc_seller6@example.com")
    provider_id = await _make_provider()
    order1 = await _make_order(buyer, seller)
    order2 = await _make_order(buyer, seller)
    assignments = [_assignment("ext-race")]

    async def _attempt(order_id):
        async with SessionLocal() as db:
            result = await bind_first_available_assignment(provider_id, order_id, assignments, db)
            await db.commit()
            return result

    results = await asyncio.gather(_attempt(order1), _attempt(order2))
    successes = [r for r in results if r is not None]
    assert len(successes) == 1
    assert successes[0].external_id == "ext-race"


@pytest.mark.asyncio
async def test_release_allocation_marks_released_and_frees_nothing_else():
    buyer = await _make_account("dpx_alloc_buyer7@example.com")
    seller = await _make_account("dpx_alloc_seller7@example.com")
    provider_id = await _make_provider()
    order_id = await _make_order(buyer, seller)

    async with SessionLocal() as db:
        allocation = await bind_first_available_assignment(provider_id, order_id, [_assignment("ext-rel")], db)
        await db.commit()
        allocation_id = allocation.id

    async with SessionLocal() as db:
        await release_allocation(provider_id, "ext-rel", db)
        await db.commit()

    async with SessionLocal() as db:
        refreshed = await db.get(ProxyAllocation, allocation_id)
        assert refreshed.status == ProxyAllocationStatus.released


@pytest.mark.asyncio
async def test_only_a_usable_candidate_is_picked_for_a_new_binding():
    """review fixes Blocker 2: bind_first_available_assignment must itself
    skip non-usable candidates when picking a NEW binding — not rely on the
    caller to have pre-filtered."""
    buyer = await _make_account("dpx_alloc_buyer8@example.com")
    seller = await _make_account("dpx_alloc_seller8@example.com")
    provider_id = await _make_provider()
    order_id = await _make_order(buyer, seller)
    assignments = [_assignment("ext-offline", online=False), _assignment("ext-online", online=True)]

    async with SessionLocal() as db:
        allocation = await bind_first_available_assignment(provider_id, order_id, assignments, db)
        await db.commit()

    assert allocation is not None
    assert allocation.external_id == "ext-online"


@pytest.mark.asyncio
async def test_idempotent_retry_when_bound_assignment_is_offline_fails_but_preserves_binding():
    buyer = await _make_account("dpx_alloc_buyer9@example.com")
    seller = await _make_account("dpx_alloc_seller9@example.com")
    provider_id = await _make_provider()
    order_id = await _make_order(buyer, seller)

    async with SessionLocal() as db:
        first = await bind_first_available_assignment(provider_id, order_id, [_assignment("ext-flaky")], db)
        await db.commit()
        allocation_id = first.id

    async with SessionLocal() as db:
        result = await bind_first_available_assignment(
            provider_id, order_id, [_assignment("ext-flaky", online=False)], db,
        )
        await db.commit()
    assert result is None  # this provision attempt fails — nothing usable to deliver right now

    async with SessionLocal() as db:
        allocation = await db.get(ProxyAllocation, allocation_id)
        # offline, not error — a later retry can still recover it, and the
        # binding to this specific external_id is preserved either way.
        assert allocation.status == ProxyAllocationStatus.offline
        assert allocation.external_id == "ext-flaky"


@pytest.mark.asyncio
async def test_idempotent_retry_when_bound_assignment_expired_marks_expired():
    buyer = await _make_account("dpx_alloc_buyer10@example.com")
    seller = await _make_account("dpx_alloc_seller10@example.com")
    provider_id = await _make_provider()
    order_id = await _make_order(buyer, seller)

    async with SessionLocal() as db:
        first = await bind_first_available_assignment(provider_id, order_id, [_assignment("ext-timebomb")], db)
        await db.commit()
        allocation_id = first.id

    past = datetime.now(timezone.utc) - timedelta(hours=1)
    async with SessionLocal() as db:
        result = await bind_first_available_assignment(
            provider_id, order_id, [_assignment("ext-timebomb", expires_at=past)], db,
        )
        await db.commit()
    assert result is None

    async with SessionLocal() as db:
        allocation = await db.get(ProxyAllocation, allocation_id)
        assert allocation.status == ProxyAllocationStatus.expired


@pytest.mark.asyncio
async def test_bind_purchased_assignment_inserts_a_fresh_allocation():
    buyer = await _make_account("dpx_alloc_buyer11@example.com")
    seller = await _make_account("dpx_alloc_seller11@example.com")
    provider_id = await _make_provider()
    order_id = await _make_order(buyer, seller)

    async with SessionLocal() as db:
        allocation = await bind_purchased_assignment(provider_id, order_id, _assignment("ext-bought"), db)
        await db.commit()

    assert allocation.external_id == "ext-bought"
    assert allocation.status == ProxyAllocationStatus.allocated
    assert allocation.order_id == order_id


@pytest.mark.asyncio
async def test_bind_purchased_assignment_called_twice_for_same_order_violates_uniqueness():
    """Caller (DProxyAdapter._provision_via_purchase) is responsible for
    checking get_order_proxy_allocation before ever calling this — it does
    not itself do an idempotent-refresh dance like
    bind_first_available_assignment does. Confirms the DB constraint still
    backstops a caller bug: a second purchase-bind for the same order must
    not silently succeed and orphan the first allocation."""
    buyer = await _make_account("dpx_alloc_buyer12@example.com")
    seller = await _make_account("dpx_alloc_seller12@example.com")
    provider_id = await _make_provider()
    order_id = await _make_order(buyer, seller)

    async with SessionLocal() as db:
        await bind_purchased_assignment(provider_id, order_id, _assignment("ext-bought-1"), db)
        await db.commit()

    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        async with SessionLocal() as db:
            await bind_purchased_assignment(provider_id, order_id, _assignment("ext-bought-2"), db)
            await db.commit()
