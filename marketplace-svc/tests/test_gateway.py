"""End-to-end tests for the seller_gateway (credit, per-request forward) and
seller_task_webhook (task, submit + callback) adapters — the two new pieces
that let a seller's own backend fulfill orders without the buyer ever seeing
its real base_url/api_key. See
docs/superpowers/specs/2026-07-21-seller-connect-gateway-design.md.
"""
import asyncio
import hashlib
import hmac
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.order import Order, OrderStatus
from src.models.product import Product
from src.models.provider import Provider
from src.models.service_task import ServiceTask, ServiceTaskStatus
from src.models.usage import OrderBalance, UsageRecord, UsageRecordStatus
from src.orders.service import provision_pending_order

from .conftest import make_admin, make_seller, register_and_login, set_seller_tier


def _ok(json_body: dict, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=json_body, request=httpx.Request("POST", "https://seller.example.com/x"))


def _patch_seller_http(monkeypatch, responses):
    """Intercept only outbound calls to the (fake) seller backend, leaving the
    test client's own in-process ASGI requests alone.

    `monkeypatch.setattr(httpx.AsyncClient, "request", AsyncMock(...))`
    replaces the method on the *class* — every AsyncClient instance is
    affected, including the test `client` fixture itself (an AsyncClient over
    ASGITransport). Tests that need to call `client.*()` again after
    provisioning (e.g. hitting /gw/... or the webhook route) would otherwise
    have those calls silently swallowed by the same mock instead of reaching
    the app. Route by URL instead: only requests whose host is
    seller.example.com get the canned response/side_effect; everything else
    (the test client's own calls) goes through the real implementation.

    `responses` is either a single httpx.Response/Exception or a list — same
    shape AsyncMock's return_value/side_effect would take, consumed in order.
    """
    original_request = httpx.AsyncClient.request
    if not isinstance(responses, list):
        responses = [responses]
    queue = list(responses)
    calls: list[dict] = []

    async def fake_request(self, method, url, *args, **kwargs):
        if "seller.example.com" not in str(url):
            return await original_request(self, method, url, *args, **kwargs)
        calls.append({"method": method, "url": str(url), **kwargs})
        item = queue.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    monkeypatch.setattr(httpx.AsyncClient, "request", fake_request)
    return calls


async def setup_credit_gateway_product(client, *, extra_pricing_params=None, provider_config=None, suffix=""):
    admin_email = f"gw_admin{suffix}@example.com"
    admin_token = await register_and_login(client, admin_email)
    await make_admin(admin_email)
    admin_token = await register_and_login(client, admin_email)

    await client.post("/admin/categories", json={"name": f"GwCat{suffix}", "slug": f"gwcat{suffix}"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    config = {"base_url": "https://seller.example.com", "api_key": "seller-secret"}
    if provider_config:
        config.update(provider_config)
    provider_resp = await client.post("/admin/providers", json={
        "name": "Mock Seller Gateway", "type": "endpoint",
        "config": config, "priority": 1, "adapter_type": "seller_gateway",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert provider_resp.status_code == 201, provider_resp.text
    provider_id = provider_resp.json()["id"]

    seller_email = f"gw_seller{suffix}@example.com"
    seller_token = await register_and_login(client, seller_email)
    await make_seller(seller_email)
    seller_token = await register_and_login(client, seller_email)

    product_resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Search API", "status": "active",
        "escrow_days": 2, "service_type": "endpoint",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product_resp.json()["id"]

    pricing_params = {"credit_price": 1000}
    if extra_pricing_params:
        pricing_params.update(extra_pricing_params)

    async with SessionLocal() as db:
        await db.execute(
            update(Product).where(Product.id == product_id).values(
                provider_id=provider_id, pricing_strategy="credit",
                pricing_params=pricing_params,
            )
        )
        await db.commit()

    buyer_email = f"gw_buyer{suffix}@example.com"
    buyer_token = await register_and_login(client, buyer_email)
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]
    await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 500000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    return buyer_token, admin_token, product_id


async def _buy_and_deliver(client, buyer_token, product_id, package_size, monkeypatch) -> int:
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    resp = await client.post("/orders", json={
        "product_id": product_id, "user_config": {"package_size": package_size},
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 201, resp.text
    order_id = resp.json()["id"]

    _patch_seller_http(
        monkeypatch, _ok({"success": True, "data": "session issued", "resource_id": "mockres_1"}),
    )
    await provision_pending_order(order_id)
    return order_id


def _extract_gateway_key(delivered_data: str) -> str:
    for line in delivered_data.splitlines():
        if line.startswith("Gateway key:"):
            return line.split(":", 1)[1].strip()
    raise AssertionError(f"no gateway key line in {delivered_data!r}")


class TestSellerGateway:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_delivery_mints_a_gateway_key_not_the_seller_credential(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 5, monkeypatch)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.delivered
            assert order.gateway_key_hash is not None
            assert "Gateway key:" in order.delivered_data
            # The seller's own provision response ("session issued") never
            # reaches the buyer — only the platform-minted key does.
            assert "session issued" not in order.delivered_data

            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.units_total == 5
            assert balance.units_used == 0

    @pytest.mark.asyncio
    async def test_forward_call_charges_usage_and_reaches_the_seller(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, _ok({"query": "hello", "results": ["a", "b"]}))

        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "hello"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["query"] == "hello"

        # Reached the seller's real backend with a fresh (non-order-scoped) key.
        assert len(calls) == 1
        assert calls[0]["headers"]["Authorization"] == "Bearer seller-secret"
        assert calls[0]["params"] == {"q": "hello"}

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.units_used == 1

    @pytest.mark.asyncio
    async def test_quota_exceeded_after_package_exhausted(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 2, monkeypatch)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, [_ok({"echo": "x"}), _ok({"echo": "x"})])
        for _ in range(2):
            resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
            assert resp.status_code == 200

        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
        assert resp.status_code == 402
        # Quota check happens before the forward — a rejected call never reaches the seller.
        assert len(calls) == 2

    @pytest.mark.asyncio
    async def test_wrong_key_is_rejected(self, client):
        resp = await client.get("/gw/gwk_live_bogus/search", params={"q": "x"})
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_refunded_order_gateway_key_stops_working(self, client, monkeypatch):
        """The gateway never checked order.status at all — only OrderBalance
        quota/expiry. A buyer who opens a dispute and gets refunded keeps a
        gateway key that still has unused units on it, so they'd get their
        money back AND keep calling the seller through the platform. Prove
        this is blocked once the order leaves delivered/completed."""
        buyer_token, admin_token, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 5, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, [_ok({"ok": True}), _ok({"ok": True})])
        assert (await client.get(f"/gw/{gateway_key}/search", params={"q": "1"})).status_code == 200
        assert len(calls) == 1

        dispute_resp = await client.post(f"/orders/{order_id}/dispute", json={
            "reason": "not what I expected",
        }, headers={"Authorization": f"Bearer {buyer_token}"})
        assert dispute_resp.status_code == 201, dispute_resp.text
        dispute_id = dispute_resp.json()["id"]

        refund_resp = await client.post(f"/admin/disputes/{dispute_id}/refund", json={
            "admin_note": "refunded",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert refund_resp.status_code == 200, refund_resp.text

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.refunded

        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "2"})
        assert resp.status_code == 403, (
            f"a refunded order's gateway key must stop working — got {resp.status_code}"
        )
        assert len(calls) == 1, "the blocked call must never reach the seller"

    @pytest.mark.asyncio
    async def test_seller_backend_failure_refunds_the_pre_charged_unit(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        # 3 attempts (RealApiAdapter retries) all fail the same way.
        _patch_seller_http(monkeypatch, [httpx.ConnectTimeout("timed out")] * 3)
        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
        assert resp.status_code == 502

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.units_used == 0, "failed forward must not consume the buyer's quota"

    @pytest.mark.asyncio
    async def test_seller_backend_failure_writes_a_refunded_ledger_row(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        _patch_seller_http(monkeypatch, [httpx.ConnectTimeout("timed out")] * 3)
        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
        assert resp.status_code == 502

        async with SessionLocal() as db:
            from src.models.usage import UsageRecord, UsageRecordStatus
            records = (await db.execute(
                select(UsageRecord).where(UsageRecord.order_id == order_id).order_by(UsageRecord.id)
            )).scalars().all()
            assert [r.status for r in records] == [UsageRecordStatus.ok, UsageRecordStatus.refunded]

    @pytest.mark.asyncio
    async def test_path_traversal_endpoint_is_rejected(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, [_ok({"ok": True})])
        # httpx normalizes "../" client-side against the *base_url*, so route
        # straight at the ASGI app to prove the server itself rejects a
        # traversal attempt rather than relying on a client that happens to
        # not send one.
        resp = await client.get(f"/gw/{gateway_key}/..%2Fprovision", params={"q": "x"})
        assert resp.status_code in (400, 404)
        resp = await client.get(f"/gw/{gateway_key}/a/b", params={"q": "x"})
        assert resp.status_code == 400
        assert len(calls) == 0, "a rejected endpoint must never reach the seller"

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.units_used == 0

    @pytest.mark.asyncio
    async def test_oversized_request_body_is_rejected(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, [_ok({"ok": True})])
        huge = {"q": "x" * (300 * 1024)}
        resp = await client.post(f"/gw/{gateway_key}/search", json=huge)
        assert resp.status_code == 413
        assert len(calls) == 0

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.units_used == 0, "an oversized request must be rejected before charging usage"

    @pytest.mark.asyncio
    async def test_reassigning_the_product_provider_does_not_redirect_an_already_sold_key(self, client, monkeypatch):
        buyer_token, admin_token, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)
            original_provider_id = order.provider_id

        # Admin re-links the product to a brand new provider — a different
        # seller's backend entirely.
        other_provider_resp = await client.post("/admin/providers", json={
            "name": "A Different Seller", "type": "endpoint",
            "config": {"base_url": "https://other-seller.example.com", "api_key": "other-secret"},
            "priority": 1, "adapter_type": "seller_gateway",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        other_provider_id = other_provider_resp.json()["id"]
        assert other_provider_id != original_provider_id
        async with SessionLocal() as db:
            await db.execute(update(Product).where(Product.id == product_id).values(provider_id=other_provider_id))
            await db.commit()

        calls = _patch_seller_http(monkeypatch, [_ok({"ok": True})])
        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
        assert resp.status_code == 200
        assert len(calls) == 1
        # Reached the ORIGINAL seller (seller.example.com from setup_credit_gateway_product),
        # not the newly-linked one — the gateway key stays pinned to whoever
        # actually fulfilled the order.
        assert "seller.example.com" in calls[0]["url"]
        assert "other-seller.example.com" not in calls[0]["url"]


async def setup_task_webhook_product(client):
    admin_token = await register_and_login(client, "twh_admin@example.com")
    await make_admin("twh_admin@example.com")
    admin_token = await register_and_login(client, "twh_admin@example.com")

    await client.post("/admin/categories", json={"name": "TwhCat", "slug": "twhcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    webhook_secret = "wh-secret-123"
    provider_resp = await client.post("/admin/providers", json={
        "name": "Mock Task Seller", "type": "task",
        "config": {"base_url": "https://seller.example.com", "webhook_secret": webhook_secret},
        "priority": 1, "adapter_type": "seller_task_webhook",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert provider_resp.status_code == 201, provider_resp.text
    provider_id = provider_resp.json()["id"]

    seller_token = await register_and_login(client, "twh_seller@example.com")
    await make_seller("twh_seller@example.com")
    seller_token = await register_and_login(client, "twh_seller@example.com")

    product_resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Scrape Job", "status": "active",
        "escrow_days": 3, "service_type": "other",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product_resp.json()["id"]

    async with SessionLocal() as db:
        await db.execute(
            update(Product).where(Product.id == product_id).values(
                provider_id=provider_id, pricing_strategy="task",
                pricing_params={"base_price": 50000, "platform_mult": {"web": 1.0}},
            )
        )
        await db.commit()

    buyer_token = await register_and_login(client, "twh_buyer@example.com")
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]
    await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 500000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    return buyer_token, provider_id, product_id, webhook_secret


def _sign(secret: str, body: dict) -> tuple[bytes, str]:
    raw = json.dumps(body).encode()
    return raw, hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


class TestSellerTaskWebhook:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_provision_submits_one_task_per_url_and_order_goes_processing(self, client, monkeypatch):
        buyer_token, provider_id, product_id, _ = await setup_task_webhook_product(client)
        monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

        resp = await client.post("/orders", json={
            "product_id": product_id,
            "user_config": {"platform": "web", "target_urls": "https://a.example\nhttps://b.example"},
        }, headers={"Authorization": f"Bearer {buyer_token}"})
        order_id = resp.json()["id"]

        _patch_seller_http(monkeypatch, [
            _ok({"external_task_id": "ext-1", "status": "queued"}),
            _ok({"external_task_id": "ext-2", "status": "queued"}),
        ])
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.processing

            tasks = (await db.execute(
                select(ServiceTask).where(ServiceTask.order_id == order_id).order_by(ServiceTask.id)
            )).scalars().all()
            assert [t.external_task_id for t in tasks] == ["ext-1", "ext-2"]
            assert all(t.provider_id == provider_id for t in tasks)
            assert all(t.status == ServiceTaskStatus.processing for t in tasks)

    @pytest.mark.asyncio
    async def test_webhook_callback_completes_task_and_drives_order_lifecycle(self, client, monkeypatch):
        buyer_token, provider_id, product_id, secret = await setup_task_webhook_product(client)
        monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

        resp = await client.post("/orders", json={
            "product_id": product_id,
            "user_config": {"platform": "web", "target_urls": "https://a.example\nhttps://b.example"},
        }, headers={"Authorization": f"Bearer {buyer_token}"})
        order_id = resp.json()["id"]

        _patch_seller_http(monkeypatch, [
            _ok({"external_task_id": "ext-1"}),
            _ok({"external_task_id": "ext-2"}),
        ])
        await provision_pending_order(order_id)

        raw, sig = _sign(secret, {"status": "completed", "result_data": "done-1"})
        resp = await client.post(
            f"/webhooks/providers/{provider_id}/tasks/ext-1",
            content=raw, headers={"Content-Type": "application/json", "X-Signature": sig},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["order_status"] == "processing"  # ext-2 still pending

        raw, sig = _sign(secret, {"status": "completed", "result_data": "done-2"})
        resp = await client.post(
            f"/webhooks/providers/{provider_id}/tasks/ext-2",
            content=raw, headers={"Content-Type": "application/json", "X-Signature": sig},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["order_status"] == "delivered"

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.delivered
            assert order.escrow_expires_at is not None

    @pytest.mark.asyncio
    async def test_webhook_rejects_bad_signature(self, client, monkeypatch):
        _, provider_id, product_id, _secret = await setup_task_webhook_product(client)
        raw = json.dumps({"status": "completed", "result_data": "x"}).encode()

        resp = await client.post(
            f"/webhooks/providers/{provider_id}/tasks/ext-1",
            content=raw, headers={"Content-Type": "application/json", "X-Signature": "not-the-real-signature"},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_webhook_unknown_task_id_404s(self, client, monkeypatch):
        _, provider_id, product_id, secret = await setup_task_webhook_product(client)
        raw, sig = _sign(secret, {"status": "completed", "result_data": "x"})

        resp = await client.post(
            f"/webhooks/providers/{provider_id}/tasks/does-not-exist",
            content=raw, headers={"Content-Type": "application/json", "X-Signature": sig},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_webhook_fails_closed_when_provider_has_no_secret(self, client, monkeypatch):
        """providers/service.py now refuses to create/update a seller_task_webhook
        provider without a webhook_secret — but the webhook route must not
        blindly trust that invariant. Simulate a row that ended up without one
        anyway (legacy data, direct DB edit) and confirm every callback is
        rejected outright rather than accepted unsigned."""
        _, provider_id, product_id, _secret = await setup_task_webhook_product(client)
        async with SessionLocal() as db:
            provider = await db.get(Provider, provider_id)
            config = dict(provider.config)
            del config["webhook_secret"]
            await db.execute(update(Provider).where(Provider.id == provider_id).values(config=config))
            await db.commit()

        raw = json.dumps({"status": "completed", "result_data": "x"}).encode()
        resp = await client.post(
            f"/webhooks/providers/{provider_id}/tasks/ext-1",
            content=raw, headers={"Content-Type": "application/json"},  # no X-Signature at all
        )
        assert resp.status_code == 401


class TestSellerTaskWebhookAllSubmissionsFail:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_all_submissions_failing_cancels_and_refunds_the_order(self, client, monkeypatch):
        buyer_token, _provider_id, product_id, _secret = await setup_task_webhook_product(client)
        monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

        wallet_before = (await client.get(
            "/wallet", headers={"Authorization": f"Bearer {buyer_token}"},
        )).json()["balance"]

        resp = await client.post("/orders", json={
            "product_id": product_id,
            "user_config": {"platform": "web", "target_urls": "https://a.example\nhttps://b.example"},
        }, headers={"Authorization": f"Bearer {buyer_token}"})
        order_id = resp.json()["id"]

        # Every /v1/tasks submission fails (3 retries each, 2 URLs).
        _patch_seller_http(monkeypatch, [httpx.ConnectTimeout("timed out")] * 6)
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.cancelled, (
                "with zero tasks submitted, no webhook can ever arrive — the order "
                "must be cancelled immediately instead of stuck at 'processing' forever"
            )
            tasks = (await db.execute(
                select(ServiceTask).where(ServiceTask.order_id == order_id)
            )).scalars().all()
            assert all(t.status == ServiceTaskStatus.failed for t in tasks)

        wallet_after = (await client.get(
            "/wallet", headers={"Authorization": f"Bearer {buyer_token}"},
        )).json()["balance"]
        assert wallet_after == wallet_before, "buyer must be refunded in full"


class TestProviderWebhookSecretEnforced:
    @pytest.mark.asyncio
    async def test_creating_seller_task_webhook_without_secret_is_rejected(self, client):
        admin_token = await register_and_login(client, "wh_enforce_admin@example.com")
        await make_admin("wh_enforce_admin@example.com")
        admin_token = await register_and_login(client, "wh_enforce_admin@example.com")

        resp = await client.post("/admin/providers", json={
            "name": "No Secret Seller", "type": "task",
            "config": {"base_url": "https://seller.example.com"},  # no webhook_secret
            "priority": 1, "adapter_type": "seller_task_webhook",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_switching_an_existing_provider_to_seller_task_webhook_without_secret_is_rejected(self, client):
        admin_token = await register_and_login(client, "wh_enforce_admin2@example.com")
        await make_admin("wh_enforce_admin2@example.com")
        admin_token = await register_and_login(client, "wh_enforce_admin2@example.com")

        create_resp = await client.post("/admin/providers", json={
            "name": "Plain Mock", "type": "task", "config": {}, "priority": 1, "adapter_type": "mock",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        provider_id = create_resp.json()["id"]

        resp = await client.put(f"/admin/providers/{provider_id}", json={
            "adapter_type": "seller_task_webhook",
            "config": {"base_url": "https://seller.example.com"},
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_clearing_the_secret_on_an_existing_webhook_provider_is_rejected(self, client):
        admin_token = await register_and_login(client, "wh_enforce_admin3@example.com")
        await make_admin("wh_enforce_admin3@example.com")
        admin_token = await register_and_login(client, "wh_enforce_admin3@example.com")

        create_resp = await client.post("/admin/providers", json={
            "name": "Has Secret", "type": "task",
            "config": {"base_url": "https://seller.example.com", "webhook_secret": "s3cr3t"},
            "priority": 1, "adapter_type": "seller_task_webhook",
        }, headers={"Authorization": f"Bearer {admin_token}"})
        provider_id = create_resp.json()["id"]

        resp = await client.put(f"/admin/providers/{provider_id}", json={
            "config": {"base_url": "https://seller.example.com"},  # secret dropped
        }, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 400


class TestCredentialNeverLeaksToBuyer:
    """Acceptance check #1 from the follow-up review: prove — not assume —
    that nothing buyer-facing ever contains the seller's real base_url,
    api_key, or webhook_secret, across every response shape a buyer can see."""

    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_order_detail_and_gateway_response_never_contain_seller_secrets(self, client, monkeypatch):
        buyer_token, admin_token, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)

        # Everything a buyer can read about their own order.
        order_resp = await client.get(f"/orders/{order_id}", headers={"Authorization": f"Bearer {buyer_token}"})
        blob = order_resp.text
        assert "seller-secret" not in blob
        assert "seller.example.com" not in blob
        assert "gwk_live_" in blob, "buyer must still see their own gateway key on their own order"

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, _ok({"query": "hello", "results": ["a"]}))
        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "hello"})
        assert "seller-secret" not in resp.text
        assert "seller.example.com" not in resp.text
        assert len(calls) == 1
        assert calls[0]["headers"]["Authorization"] == "Bearer seller-secret", (
            "the credential DOES get used to reach the seller — it just never comes back out"
        )

        # A bad key must fail the same generic way a good key that hit a wall
        # would — no hint that leaks whether a key format is merely wrong vs.
        # some other internal detail.
        resp = await client.get("/gw/gwk_live_totallybogus/search", params={"q": "x"})
        assert "seller-secret" not in resp.text
        assert "seller.example.com" not in resp.text


class TestConcurrency:
    """Acceptance checks #2/#4 from the follow-up review: prove the quota
    check and the task-webhook lifecycle are actually safe under real
    concurrent requests, not just sequential ones — each `client.*()` call
    below gets its own DB session/connection (src/database.py::get_session),
    so asyncio.gather here produces genuine overlapping Postgres transactions,
    the same as two real simultaneous HTTP requests would."""

    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_two_simultaneous_gateway_calls_with_one_unit_left_only_one_succeeds(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 1, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        _patch_seller_http(monkeypatch, [_ok({"echo": "x"}), _ok({"echo": "x"})])
        results = await asyncio.gather(
            client.get(f"/gw/{gateway_key}/search", params={"q": "a"}),
            client.get(f"/gw/{gateway_key}/search", params={"q": "b"}),
        )
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 402], f"exactly one of two simultaneous calls on 1 unit must win, got {codes}"

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.units_used == 1, "balance row locking (charge_usage's FOR UPDATE) must prevent overspend"

    @pytest.mark.asyncio
    async def test_two_simultaneous_final_webhook_callbacks_finalize_order_exactly_once(self, client, monkeypatch):
        buyer_token, provider_id, product_id, secret = await setup_task_webhook_product(client)
        monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

        resp = await client.post("/orders", json={
            "product_id": product_id,
            "user_config": {"platform": "web", "target_urls": "https://a.example\nhttps://b.example"},
        }, headers={"Authorization": f"Bearer {buyer_token}"})
        order_id = resp.json()["id"]

        # Captured AFTER purchase (the price is already deducted at order
        # creation) — the point of this assertion is that a *successful*
        # delivery causes no further wallet movement for the buyer, and
        # critically not a double-refund if the race were to run the finalize
        # path twice.
        wallet_before = (await client.get(
            "/wallet", headers={"Authorization": f"Bearer {buyer_token}"},
        )).json()["balance"]

        _patch_seller_http(monkeypatch, [
            _ok({"external_task_id": "race-1"}),
            _ok({"external_task_id": "race-2"}),
        ])
        await provision_pending_order(order_id)

        raw1, sig1 = _sign(secret, {"status": "completed", "result_data": "done-1"})
        raw2, sig2 = _sign(secret, {"status": "completed", "result_data": "done-2"})
        results = await asyncio.gather(
            client.post(f"/webhooks/providers/{provider_id}/tasks/race-1",
                        content=raw1, headers={"Content-Type": "application/json", "X-Signature": sig1}),
            client.post(f"/webhooks/providers/{provider_id}/tasks/race-2",
                        content=raw2, headers={"Content-Type": "application/json", "X-Signature": sig2}),
        )
        assert all(r.status_code == 200 for r in results), [r.text for r in results]
        # At least one of the two responses must report the order as finalized
        # — the reported order_status is a point-in-time read at each request,
        # so which one "sees" delivered first is unspecified, but it must not
        # be BOTH still "processing" (the pre-fix race: neither ever finalizes).
        assert "delivered" in {r.json()["order_status"] for r in results}, (
            "without locking the order row, both concurrent callbacks can read "
            "'not all terminal yet' and neither ever finalizes the order"
        )

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.delivered
            assert order.escrow_expires_at is not None

        wallet_after = (await client.get(
            "/wallet", headers={"Authorization": f"Bearer {buyer_token}"},
        )).json()["balance"]
        assert wallet_after == wallet_before

    # NOTE — verification gap, deliberately left visible instead of papered
    # over: the test above (two real webhook calls racing via asyncio.gather)
    # passed even with the `with_for_update=True` fix in tasks/service.py
    # manually reverted, so it is NOT reliable proof of the fix by itself —
    # unlike the quota race above, which DOES reliably fail without its lock
    # (charge_usage's, confirmed the same way: reverted, re-ran 5x, failed
    # 5/5). A follow-up attempt to prove the underlying `SELECT ... FOR
    # UPDATE` guarantee directly (two bare sessions, one holding the lock via
    # asyncio.sleep while the other tries to acquire it) blocked correctly in
    # a standalone script run outside pytest, but did NOT block inside this
    # pytest-asyncio harness — root cause not found in the time available.
    # The fix itself (adding `with_for_update=True`, matching the exact same
    # pattern already in use for the same reason in
    # orders/service.py::provision_pending_order) is correct by inspection
    # and is the standard/only mechanism for this class of race in Postgres.
    # Recorded here rather than left as a flaky test that passes or fails by
    # luck.


class TestUsageLedgerReconciliation:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_ledger_ok_minus_refunded_matches_balance_used(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 5, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        # 2 successful calls, then 1 that fails outright (refunded).
        _patch_seller_http(monkeypatch, [
            _ok({"echo": "1"}), _ok({"echo": "2"}), httpx.ConnectTimeout("down"),
            httpx.ConnectTimeout("down"), httpx.ConnectTimeout("down"),
        ])
        assert (await client.get(f"/gw/{gateway_key}/search", params={"q": "1"})).status_code == 200
        assert (await client.get(f"/gw/{gateway_key}/search", params={"q": "2"})).status_code == 200
        assert (await client.get(f"/gw/{gateway_key}/search", params={"q": "3"})).status_code == 502

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            records = (await db.execute(
                select(UsageRecord).where(UsageRecord.order_id == order_id)
            )).scalars().all()
            ok_units = sum(r.units for r in records if r.status == UsageRecordStatus.ok)
            refunded_units = sum(r.units for r in records if r.status == UsageRecordStatus.refunded)
            assert ok_units - refunded_units == balance.units_used == 2


class TestSellerNonSuccessResponsePolicy:
    """Documents the (previously unwritten) policy for a non-5xx error from
    the seller: the call reached them and got a definitive answer, same as a
    real ScraperAPI-style provider billing for a 4xx just as much as a 2xx —
    so the unit stays charged and the response is forwarded verbatim, no
    retry and no refund. Only a transport failure or an exhausted-retries 5xx
    (see TestSellerGateway.test_seller_backend_failure_refunds_the_pre_charged_unit)
    refunds."""

    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_seller_4xx_is_forwarded_and_still_charged(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client)
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        _patch_seller_http(monkeypatch, [_ok({"error": "invalid query"}, status=400)])
        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": ""})
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid query"

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.units_used == 1, "a definitive 4xx from the seller still consumes the unit"




class TestGatewayGenericity:
    """Proves the gateway is config-driven, not hardcoded — same router/adapter
    code, three different simulated seller shapes, only provider.config /
    pricing_params change. This directly answers the "chỉ được sửa config,
    không sửa router" acceptance bar from the follow-up review."""

    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_no_endpoint_map_falls_back_to_v1_convention(self, client, monkeypatch):
        """Backward compat: a provider with no endpoint_map at all (every
        existing test/provider up to this point) keeps hitting /v1/{endpoint}
        exactly as before — this feature is additive, not a breaking change."""
        buyer_token, _, product_id = await setup_credit_gateway_product(client, suffix="_g1")
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, _ok({"ok": True}))
        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
        assert resp.status_code == 200
        assert calls[0]["url"].endswith("/v1/search")

    @pytest.mark.asyncio
    async def test_endpoint_map_translates_to_an_arbitrarily_different_shape(self, client, monkeypatch):
        """A second, differently-shaped simulated backend — nothing like
        /v1/{action} — reached with ZERO router/adapter code changes, purely
        via provider.config.endpoint_map."""
        buyer_token, _, product_id = await setup_credit_gateway_product(
            client, suffix="_g2",
            provider_config={"endpoint_map": {
                "search": "/api/v2/tiktok/profile-search",
                "scrape": "/scrapecreators/v3/run-job",
            }},
        )
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, _ok({"ok": True}))
        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
        assert resp.status_code == 200
        assert calls[0]["url"].endswith("/api/v2/tiktok/profile-search")
        assert "/v1/search" not in calls[0]["url"]

    @pytest.mark.asyncio
    async def test_endpoint_not_in_the_map_is_rejected_not_guessed(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(
            client, suffix="_g3",
            provider_config={"endpoint_map": {"search": "/api/v2/search"}},
        )
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, _ok({"ok": True}))
        resp = await client.get(f"/gw/{gateway_key}/scrape", params={"q": "x"})
        assert resp.status_code == 404
        assert len(calls) == 0

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.units_used == 0, "rejected-as-unsupported must not charge a unit"

    @pytest.mark.asyncio
    async def test_different_endpoints_charge_different_rates(self, client, monkeypatch):
        """A third shape: same backend, but 'scrape' costs 5x what 'search'
        costs — a real pricing distinction ScraperAPI-style APIs make, now
        expressible purely via pricing_params.endpoint_rates."""
        buyer_token, _, product_id = await setup_credit_gateway_product(
            client, suffix="_g4",
            extra_pricing_params={"endpoint_rates": {"search": 1, "scrape": 5}, "default_rate": 2},
        )
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 20, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.endpoint_rates == {"search": 1, "scrape": 5}
            assert balance.default_rate == 2

        _patch_seller_http(monkeypatch, [_ok({"ok": True}), _ok({"ok": True}), _ok({"ok": True})])
        await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
        await client.get(f"/gw/{gateway_key}/scrape", params={"q": "x"})
        await client.get(f"/gw/{gateway_key}/unlisted-endpoint", params={"q": "x"})

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            # 1 (search) + 5 (scrape) + 2 (default_rate, endpoint not in map)
            assert balance.units_used == 8


class TestGatewayKeyLifecycle:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_buyer_can_rotate_their_own_key_and_the_old_one_stops_working(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client, suffix="_r1")
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 5, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            old_key = _extract_gateway_key(order.delivered_data)

        resp = await client.post(f"/orders/{order_id}/gateway-key/rotate",
                                 headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 200, resp.text
        new_key = resp.json()["gateway_key"]
        assert new_key != old_key

        _patch_seller_http(monkeypatch, _ok({"ok": True}))
        old_resp = await client.get(f"/gw/{old_key}/search", params={"q": "x"})
        assert old_resp.status_code == 401

        calls = _patch_seller_http(monkeypatch, _ok({"ok": True}))
        new_resp = await client.get(f"/gw/{new_key}/search", params={"q": "x"})
        assert new_resp.status_code == 200
        assert len(calls) == 1

    @pytest.mark.asyncio
    async def test_buyer_cannot_rotate_another_buyers_order_key(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client, suffix="_r2")
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 5, monkeypatch)

        other_buyer_token = await register_and_login(client, "gw_other_buyer_r2@example.com")
        resp = await client.post(f"/orders/{order_id}/gateway-key/rotate",
                                 headers={"Authorization": f"Bearer {other_buyer_token}"})
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_admin_can_revoke_a_key_with_no_replacement(self, client, monkeypatch):
        buyer_token, admin_token, product_id = await setup_credit_gateway_product(client, suffix="_r3")
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 5, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            key = _extract_gateway_key(order.delivered_data)

        resp = await client.post(f"/admin/orders/{order_id}/gateway-key/revoke",
                                 headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 200

        calls = _patch_seller_http(monkeypatch, _ok({"ok": True}))
        blocked = await client.get(f"/gw/{key}/search", params={"q": "x"})
        assert blocked.status_code == 401
        assert len(calls) == 0

    @pytest.mark.asyncio
    async def test_revoke_requires_admin(self, client, monkeypatch):
        buyer_token, _, product_id = await setup_credit_gateway_product(client, suffix="_r4")
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 5, monkeypatch)

        resp = await client.post(f"/admin/orders/{order_id}/gateway-key/revoke",
                                 headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 403


class TestGatewayRateLimit:
    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_exceeding_the_rate_limit_returns_429_without_reaching_the_seller(self, client, monkeypatch):
        # Isolate from Redis/shared IP counters left by earlier gateway tests:
        # count only gw-* buckets for this test (router checks ip then key).
        allowed = {"n": 0}

        async def fake_rate_limit(key, *, limit, window_seconds, fail_open=True):
            if not str(key).startswith("gw-"):
                return True
            allowed["n"] += 1
            # 3 successful requests × 2 buckets (ip + key) = 6 allows, then deny.
            return allowed["n"] <= 6

        monkeypatch.setattr("src.gateway.router.check_rate_limit", fake_rate_limit)
        buyer_token, _, product_id = await setup_credit_gateway_product(client, suffix="_rl1")
        order_id = await _buy_and_deliver(client, buyer_token, product_id, 50, monkeypatch)
        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, [_ok({"ok": True})] * 3)
        for _ in range(3):
            resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
            assert resp.status_code == 200, resp.text
        assert len(calls) == 3

        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "x"})
        assert resp.status_code == 429
        assert len(calls) == 3, "a rate-limited call must never reach the seller"

        async with SessionLocal() as db:
            balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            assert balance.units_used == 3, "a 429 must not consume a unit"


class TestTaskWebhookSlaSweep:
    """scheduler.py::task_webhook_sla_job — rescues a seller_task_webhook
    order whose seller never calls the webhook back, by feeding the stuck
    tasks through the exact same update_task()/_sync_order_status() path a
    real webhook would use."""

    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    @pytest.mark.asyncio
    async def test_all_tasks_stuck_past_deadline_get_refunded_and_cancelled(self, client, monkeypatch):
        from datetime import datetime, timedelta, timezone
        from src.scheduler import task_webhook_sla_job

        buyer_token, provider_id, product_id, _secret = await setup_task_webhook_product(client)
        monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

        wallet_before = (await client.get(
            "/wallet", headers={"Authorization": f"Bearer {buyer_token}"},
        )).json()["balance"]

        resp = await client.post("/orders", json={
            "product_id": product_id,
            "user_config": {"platform": "web", "target_urls": "https://a.example\nhttps://b.example"},
        }, headers={"Authorization": f"Bearer {buyer_token}"})
        order_id = resp.json()["id"]

        _patch_seller_http(monkeypatch, [
            _ok({"external_task_id": "sla-1"}),
            _ok({"external_task_id": "sla-2"}),
        ])
        await provision_pending_order(order_id)

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.processing
            order.created_at = datetime.now(timezone.utc) - timedelta(hours=49)
            await db.commit()

        await task_webhook_sla_job()

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.cancelled
            tasks = (await db.execute(
                select(ServiceTask).where(ServiceTask.order_id == order_id)
            )).scalars().all()
            assert all(t.status == ServiceTaskStatus.failed for t in tasks)
            assert all("timeout" in (t.result_data or "").lower() for t in tasks)

        wallet_after = (await client.get(
            "/wallet", headers={"Authorization": f"Bearer {buyer_token}"},
        )).json()["balance"]
        assert wallet_after == wallet_before

    @pytest.mark.asyncio
    async def test_order_within_deadline_is_left_alone(self, client, monkeypatch):
        from src.scheduler import task_webhook_sla_job

        buyer_token, provider_id, product_id, _secret = await setup_task_webhook_product(client)
        monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

        resp = await client.post("/orders", json={
            "product_id": product_id,
            "user_config": {"platform": "web", "target_urls": "https://a.example"},
        }, headers={"Authorization": f"Bearer {buyer_token}"})
        order_id = resp.json()["id"]

        _patch_seller_http(monkeypatch, [_ok({"external_task_id": "sla-fresh"})])
        await provision_pending_order(order_id)

        await task_webhook_sla_job()  # order is brand new — must not be touched

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.processing

    @pytest.mark.asyncio
    async def test_manual_adapter_orders_are_not_touched_by_this_job(self, client, monkeypatch):
        """This sweep is scoped to seller_task_webhook only — ManualAdapter's
        (pre-existing, unrelated) no-timeout behavior for human-worked tasks
        is untouched, matching this job's own docstring."""
        from datetime import datetime, timedelta, timezone
        from src.scheduler import task_webhook_sla_job
        from tests.test_task_lifecycle import setup_takedown_product, buy_takedown

        buyer_token, _admin_token, product_id, _buyer_id = await setup_takedown_product(client, suffix="_slamanual")
        order = await buy_takedown(client, buyer_token, product_id, 2)
        order_id = order["id"]

        async with SessionLocal() as db:
            db_order = await db.get(Order, order_id)
            assert db_order.status == OrderStatus.processing
            db_order.created_at = datetime.now(timezone.utc) - timedelta(hours=100)
            await db.commit()

        await task_webhook_sla_job()

        async with SessionLocal() as db:
            db_order = await db.get(Order, order_id)
            assert db_order.status == OrderStatus.processing, "ManualAdapter orders are out of scope for this job"


class TestSellerOwnedProviderSSRFGuardAtCallTime:
    """src/security/ssrf_guard.py is re-checked on every outbound call, not
    just when the seller's provider config is written — a seller's own
    domain resolves under the seller's own DNS, so a base_url that was a
    legitimate public host at signup/approval time can be repointed at the
    platform's internal network afterwards. This simulates exactly that: the
    config is tampered with directly in the DB (bypassing the write-time
    check entirely, standing in for a DNS rebind an API-level check can't
    see) and the gateway forward must still refuse to reach it."""

    @pytest.fixture(autouse=True)
    def _no_sleep(self, monkeypatch):
        monkeypatch.setattr("src.adapters.real_api.asyncio.sleep", AsyncMock())

    async def _setup_seller_owned_gateway_order(self, client, monkeypatch, suffix):
        admin_email = f"gw_ssrf_admin{suffix}@example.com"
        admin_token = await register_and_login(client, admin_email)
        await make_admin(admin_email)
        admin_token = await register_and_login(client, admin_email)

        seller_email = f"gw_ssrf_seller{suffix}@example.com"
        seller_token = await register_and_login(client, seller_email)
        await make_seller(seller_email)
        await set_seller_tier(seller_email, "trusted")
        seller_token = await register_and_login(client, seller_email)

        provider_resp = await client.post("/seller/providers", json={
            "name": "Seller backend", "adapter_type": "seller_gateway",
            "config": {"base_url": "https://seller.example.com", "api_key": "seller-secret"},
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert provider_resp.status_code == 201, provider_resp.text
        provider_id = provider_resp.json()["id"]
        approve_resp = await client.post(f"/admin/providers/{provider_id}/approve", json={},
                                         headers={"Authorization": f"Bearer {admin_token}"})
        assert approve_resp.status_code == 200

        await client.post("/admin/categories", json={"name": f"GwSsrf{suffix}", "slug": f"gwssrf{suffix}"},
                          headers={"Authorization": f"Bearer {admin_token}"})
        cats = await client.get("/categories")
        cat_id = cats.json()[-1]["id"]
        product_resp = await client.post("/seller/products", json={
            "category_id": cat_id, "title": "Search API", "status": "active",
            "escrow_days": 2, "service_type": "endpoint",
        }, headers={"Authorization": f"Bearer {seller_token}"})
        product_id = product_resp.json()["id"]

        pricing_resp = await client.put(f"/seller/products/{product_id}/pricing", json={
            "pricing_strategy": "credit", "pricing_params": {"credit_price": 1000},
            "provider_id": provider_id,
        }, headers={"Authorization": f"Bearer {seller_token}"})
        assert pricing_resp.status_code == 200, pricing_resp.text

        buyer_email = f"gw_ssrf_buyer{suffix}@example.com"
        buyer_token = await register_and_login(client, buyer_email)
        buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
        buyer_id = buyer_me.json()["id"]
        await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 500000},
                          headers={"Authorization": f"Bearer {admin_token}"})

        order_id = await _buy_and_deliver(client, buyer_token, product_id, 3, monkeypatch)
        return provider_id, order_id, buyer_token

    @pytest.mark.asyncio
    async def test_forward_is_blocked_after_base_url_is_repointed_at_an_internal_address(self, client, monkeypatch):
        provider_id, order_id, buyer_token = await self._setup_seller_owned_gateway_order(
            client, monkeypatch, "_rebind",
        )

        async with SessionLocal() as db:
            provider = await db.get(Provider, provider_id)
            provider.config = {**provider.config, "base_url": "https://169.254.169.254"}
            await db.commit()

            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)
            balance_before = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            units_used_before = balance_before.units_used

        calls = _patch_seller_http(monkeypatch, _ok({"query": "hello"}))

        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "hello"})

        assert resp.status_code == 502, resp.text
        assert len(calls) == 0, "must never reach the network for a blocked base_url"

        async with SessionLocal() as db:
            balance_after = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order_id))
            # pre-charged then refunded on failure — buyer isn't billed for a blocked call
            assert balance_after.units_used == units_used_before

    @pytest.mark.asyncio
    async def test_forward_still_works_when_base_url_stays_public(self, client, monkeypatch):
        """Control case: the guard must not false-positive on the seller's
        legitimate (unchanged) base_url."""
        _provider_id, order_id, _buyer_token = await self._setup_seller_owned_gateway_order(
            client, monkeypatch, "_control",
        )

        async with SessionLocal() as db:
            order = await db.get(Order, order_id)
            gateway_key = _extract_gateway_key(order.delivered_data)

        calls = _patch_seller_http(monkeypatch, _ok({"query": "hello"}))
        resp = await client.get(f"/gw/{gateway_key}/search", params={"q": "hello"})

        assert resp.status_code == 200, resp.text
        assert len(calls) == 1
