"""Task 7 — lifecycle reconciliation for DProxy allocations. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.alert import Alert
from src.models.order import Order
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus
from src.orders.service import provision_pending_order
from src.scheduler import dproxy_reconciliation_job

from .test_dproxy_orders import _patch_dproxy_http, _place_order, _resp, _sample, setup_dproxy_product


async def _deliver(client, monkeypatch, suffix, external_id="ext-1"):
    buyer_token, admin_token, product_id, provider_id = await setup_dproxy_product(client, suffix=suffix)
    order_id = await _place_order(client, buyer_token, product_id, monkeypatch)
    _patch_dproxy_http(monkeypatch, _resp(200, [_sample(external_id)]))
    await provision_pending_order(order_id)
    return order_id, provider_id


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())


@pytest.mark.asyncio
async def test_reconciliation_refreshes_metadata_for_still_present_allocation(client, monkeypatch):
    order_id, provider_id = await _deliver(client, monkeypatch, "_refresh", external_id="ext-refresh")

    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        delivered_before = order.delivered_data

    updated = _sample("ext-refresh")
    updated["proxies"]["ip_public"] = "5.5.5.5"
    _patch_dproxy_http(monkeypatch, _resp(200, [updated]))
    await dproxy_reconciliation_job()

    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.allocated
        assert allocation.last_public_ip == "5.5.5.5"

        # Reconciliation never touches buyer-facing delivered_data — only the
        # rotate endpoint does.
        order = await db.get(Order, order_id)
        assert order.delivered_data == delivered_before


@pytest.mark.asyncio
async def test_missing_but_not_yet_expired_marked_error_and_alerted(client, monkeypatch):
    order_id, provider_id = await _deliver(client, monkeypatch, "_missing", external_id="ext-missing")

    _patch_dproxy_http(monkeypatch, _resp(200, []))  # disappeared upstream, well before our expiry
    await dproxy_reconciliation_job()

    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.error

        alerts = (await db.execute(
            select(Alert).where(Alert.type == "dproxy_allocation_disappeared")
        )).scalars().all()
        assert any(a.target_id == order_id for a in alerts)


@pytest.mark.asyncio
async def test_missing_and_past_marketplace_expiry_marked_expired_not_error(client, monkeypatch):
    order_id, provider_id = await _deliver(client, monkeypatch, "_expired", external_id="ext-expired")

    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        allocation.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        await db.commit()

    _patch_dproxy_http(monkeypatch, _resp(200, []))
    await dproxy_reconciliation_job()

    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.expired

        alerts = (await db.execute(
            select(Alert).where(Alert.type == "dproxy_allocation_disappeared")
        )).scalars().all()
        assert not any(a.target_id == order_id for a in alerts)


@pytest.mark.asyncio
async def test_one_list_call_covers_every_bound_order_for_that_provider(client, monkeypatch):
    order1, provider_id = await _deliver(client, monkeypatch, "_batchA", external_id="ext-batch-1")
    order2, provider2_id = await _deliver(client, monkeypatch, "_batchB", external_id="ext-batch-2")

    # Note: setup_dproxy_product creates a NEW provider per call, so order1/
    # order2 above actually belong to different providers — reset both
    # allocations onto a single shared provider (and deactivate the now-empty
    # second one, so the job's "every active dproxy provider" query doesn't
    # still poll it) to exercise true batching.
    from src.models.provider import Provider

    async with SessionLocal() as db:
        a1 = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order1))
        a2 = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order2))
        a2.provider_id = a1.provider_id
        empty_provider = await db.get(Provider, provider2_id)
        empty_provider.is_active = False
        await db.commit()

    calls = _patch_dproxy_http(
        monkeypatch, _resp(200, [_sample("ext-batch-1"), _sample("ext-batch-2")]),
    )
    await dproxy_reconciliation_job()

    dproxy_calls = [c for c in calls if "dproxy.example.com" in c["url"]]
    assert len(dproxy_calls) == 1

    async with SessionLocal() as db:
        a1 = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order1))
        a2 = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order2))
        assert a1.status == ProxyAllocationStatus.allocated
        assert a2.status == ProxyAllocationStatus.allocated


@pytest.mark.asyncio
async def test_auth_failure_alerts_and_does_not_touch_bindings(client, monkeypatch):
    order_id, provider_id = await _deliver(client, monkeypatch, "_authfail", external_id="ext-auth")

    _patch_dproxy_http(monkeypatch, _resp(401))
    await dproxy_reconciliation_job()

    async with SessionLocal() as db:
        allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
        assert allocation.status == ProxyAllocationStatus.allocated  # untouched, not marked error

        alerts = (await db.execute(select(Alert).where(Alert.type == "dproxy_auth_error"))).scalars().all()
        assert any(a.target_id == provider_id for a in alerts)


@pytest.mark.asyncio
async def test_duplicate_external_id_in_inventory_raises_an_alert(client, monkeypatch):
    order_id, provider_id = await _deliver(client, monkeypatch, "_dupe", external_id="ext-dupe")

    _patch_dproxy_http(monkeypatch, _resp(200, [_sample("ext-dupe"), _sample("ext-dupe")]))
    await dproxy_reconciliation_job()

    async with SessionLocal() as db:
        alerts = (await db.execute(
            select(Alert).where(Alert.type == "dproxy_duplicate_external_id")
        )).scalars().all()
        assert any(a.target_id == provider_id for a in alerts)


@pytest.mark.asyncio
async def test_reconciliation_ignores_non_dproxy_providers(client, monkeypatch):
    """Sanity guard: the job must only ever touch providers with
    adapter_type='dproxy' — a stray call to a topproxy/mock provider would
    be a real bug (wrong contract, wrong auth)."""
    from src.database import SessionLocal as SL
    from src.models.provider import Provider

    async with SL() as db:
        p = Provider(name="Mock", type="mock", adapter_type="mock", config={})
        db.add(p)
        await db.commit()

    calls = _patch_dproxy_http(monkeypatch, _resp(200, []))
    await dproxy_reconciliation_job()
    assert calls == []
