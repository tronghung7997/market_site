"""Task 4 — DProxy provisioning through the existing order lifecycle. See
docs/superpowers/specs/2026-07-22-dproxy-integration.md.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import func, select, update

from src.database import SessionLocal
from src.models.order import Order, OrderStatus
from src.models.product import Product
from src.models.provider import ProviderCallLog
from src.models.proxy_allocation import ProxyAllocation, ProxyAllocationStatus
from src.orders.service import provision_pending_order

from .conftest import make_admin, make_seller, register_and_login

FUTURE = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()


def _sample(external_id="ext-1", *, status="active", proxy_status="online") -> dict:
    return {
        "id": external_id,
        "assigned_at": "2026-07-20T12:35:46.296225+00:00",
        "expired_at": FUTURE,
        "status": status,
        "username": "u",
        "password": "p",
        "is_active": True,
        "proxies": {
            "host": "s4.dproxy.info", "port": 20160,
            "status": {"msg": proxy_status}, "proxy_id": "px-1", "ip_public": "1.2.3.4",
            "rotation": {
                "available": True, "mode": "pppoe", "cooldown_seconds": 60, "last_rotated_at": None,
                "rotate_endpoint": f"/api/v1/proxies/user/{external_id}/rotate",
            },
        },
    }


def _resp(status: int, json_body=None) -> httpx.Response:
    return httpx.Response(status, json=json_body, request=httpx.Request("GET", "https://dproxy.example.com/x"))


def _patch_dproxy_http(monkeypatch, responses):
    original_request = httpx.AsyncClient.request
    if not isinstance(responses, list):
        responses = [responses]
    queue = list(responses)
    calls: list[dict] = []

    async def fake_request(self, method, url, *args, **kwargs):
        if "dproxy.example.com" not in str(url):
            return await original_request(self, method, url, *args, **kwargs)
        calls.append({"method": method, "url": str(url), **kwargs})
        # RealApiAdapter._request_with_retry retries up to 3x on 5xx/network
        # errors — persist the last queued item instead of raising IndexError
        # once exhausted, so a single "always fails" response also covers
        # every retry attempt without the caller needing to know the count.
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, BaseException):
            raise item
        return item

    monkeypatch.setattr(httpx.AsyncClient, "request", fake_request)
    return calls


async def setup_dproxy_product(client, *, suffix=""):
    admin_email = f"dpx_admin{suffix}@example.com"
    admin_token = await register_and_login(client, admin_email)
    await make_admin(admin_email)
    admin_token = await register_and_login(client, admin_email)

    await client.post("/admin/categories", json={"name": f"DpxCat{suffix}", "slug": f"dpxcat{suffix}"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    provider_resp = await client.post("/admin/providers", json={
        "name": "DProxy", "type": "dproxy", "adapter_type": "dproxy",
        "config": {"base_url": "https://dproxy.example.com", "api_key": "dpx-secret"},
        "priority": 1,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert provider_resp.status_code == 201, provider_resp.text
    provider_id = provider_resp.json()["id"]

    seller_email = f"dpx_seller{suffix}@example.com"
    seller_token = await register_and_login(client, seller_email)
    await make_seller(seller_email)
    seller_token = await register_and_login(client, seller_email)

    product_resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Proxy Package", "status": "active",
        "escrow_days": 2, "service_type": "endpoint",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product_resp.json()["id"]

    async with SessionLocal() as db:
        await db.execute(
            update(Product).where(Product.id == product_id).values(
                provider_id=provider_id, pricing_strategy="credit",
                pricing_params={"credit_price": 50000},
            )
        )
        await db.commit()

    buyer_email = f"dpx_buyer{suffix}@example.com"
    buyer_token = await register_and_login(client, buyer_email)
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]
    await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 500000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    return buyer_token, admin_token, product_id, provider_id


async def _place_order(client, buyer_token, product_id, monkeypatch) -> int:
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    resp = await client.post(
        "/orders", json={"product_id": product_id, "user_config": {"package_size": 1}},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestDProxyProvisioning:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_successful_provision_binds_and_delivers(self, client, monkeypatch):
        buyer_token, _, product_id, provider_id = await setup_dproxy_product(client, suffix="_ok")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)

        _patch_dproxy_http(monkeypatch, _resp(200, [_sample("ext-1")]))
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.delivered
            assert "s4.dproxy.info" in order.delivered_data
            assert "20160" in order.delivered_data
            # seller/provider secrets never leak into the buyer-facing text
            assert "dpx-secret" not in order.delivered_data

            allocation = await db.scalar(select(ProxyAllocation).where(ProxyAllocation.order_id == order_id))
            assert allocation is not None
            assert allocation.external_id == "ext-1"
            assert allocation.status == ProxyAllocationStatus.allocated
            assert allocation.provider_id == provider_id

    @pytest.mark.asyncio
    async def test_empty_inventory_refunds_and_cancels(self, client, monkeypatch):
        buyer_token, _, product_id, _ = await setup_dproxy_product(client, suffix="_empty")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)

        _patch_dproxy_http(monkeypatch, _resp(200, []))
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.cancelled

    @pytest.mark.asyncio
    async def test_all_inactive_or_offline_or_expired_treated_as_no_inventory(self, client, monkeypatch):
        buyer_token, _, product_id, _ = await setup_dproxy_product(client, suffix="_dead")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)

        payload = [
            _sample("ext-inactive", status="inactive"),
            _sample("ext-offline", proxy_status="offline"),
        ]
        _patch_dproxy_http(monkeypatch, _resp(200, payload))
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.cancelled

    @pytest.mark.asyncio
    async def test_malformed_payload_is_a_terminal_contract_failure(self, client, monkeypatch):
        buyer_token, _, product_id, _ = await setup_dproxy_product(client, suffix="_bad")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)

        _patch_dproxy_http(monkeypatch, _resp(200, {"not": "a list"}))
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.cancelled

    @pytest.mark.asyncio
    async def test_auth_failure_is_terminal_not_retried(self, client, monkeypatch):
        buyer_token, _, product_id, _ = await setup_dproxy_product(client, suffix="_auth")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)

        _patch_dproxy_http(monkeypatch, _resp(401))
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.cancelled

    @pytest.mark.asyncio
    async def test_transient_5xx_leaves_order_pending_for_sweep_retry(self, client, monkeypatch):
        buyer_token, _, product_id, _ = await setup_dproxy_product(client, suffix="_5xx")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)

        _patch_dproxy_http(monkeypatch, _resp(500))
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            # Left at pending — provision_sweep_job retries, only refunds past its deadline.
            assert order.status == OrderStatus.pending

    @pytest.mark.asyncio
    async def test_idempotent_retry_does_not_duplicate_the_allocation(self, client, monkeypatch):
        buyer_token, _, product_id, _ = await setup_dproxy_product(client, suffix="_retry")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)

        _patch_dproxy_http(monkeypatch, _resp(200, [_sample("ext-retry")]))
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.delivered
            count = await db.scalar(
                select(func.count()).select_from(ProxyAllocation).where(ProxyAllocation.order_id == order_id)
            )
            assert count == 1

    @pytest.mark.asyncio
    async def test_order_snapshots_the_resolved_provider(self, client, monkeypatch):
        buyer_token, _, product_id, provider_id = await setup_dproxy_product(client, suffix="_snap")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)

        _patch_dproxy_http(monkeypatch, _resp(200, [_sample("ext-snap")]))
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.provider_id == provider_id

    @pytest.mark.asyncio
    async def test_provider_call_logs_carry_no_credentials_or_response_body(self, client, monkeypatch):
        buyer_token, _, product_id, provider_id = await setup_dproxy_product(client, suffix="_log")
        order_id = await _place_order(client, buyer_token, product_id, monkeypatch)

        _patch_dproxy_http(monkeypatch, _resp(200, [_sample("ext-log")]))
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            logs = (await db.execute(
                select(ProviderCallLog).where(ProviderCallLog.provider_id == provider_id)
            )).scalars().all()
            assert len(logs) >= 1
            for log in logs:
                assert log.method and log.path and log.status_code is not None
                # ProviderCallLog (src/models/provider.py) has no body/credential
                # column at all — metadata-only by construction.

    @pytest.mark.asyncio
    async def test_concurrent_orders_one_wins_one_reports_out_of_stock(self, client, monkeypatch):
        buyer_token, _, product_id, _ = await setup_dproxy_product(client, suffix="_conc")
        order_ids = [
            await _place_order(client, buyer_token, product_id, monkeypatch),
            await _place_order(client, buyer_token, product_id, monkeypatch),
        ]

        _patch_dproxy_http(monkeypatch, [_resp(200, [_sample("ext-conc")]), _resp(200, [_sample("ext-conc")])])
        await asyncio.gather(*(provision_pending_order(oid) for oid in order_ids))

        async with SessionLocal() as db:
            statuses = [(await db.get(Order, oid)).status.value for oid in order_ids]
        assert sorted(statuses) == ["cancelled", "delivered"]
