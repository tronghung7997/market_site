"""A seller-owned provider journey against the real mock seller ASGI app.

This deliberately follows public routes: seller submits config, admin approves,
seller attaches the approved backend to a product, then buyer purchases.  The
only transport seam is outbound HTTP: requests to seller.example.com are
served by scripts.mock_seller, so adapters exercise their real wire contract.
"""
import hashlib
import hmac
import json

import httpx
import pytest
from scripts import mock_seller
from src.adapters.seller_task_webhook import settings as task_settings
from src.database import SessionLocal
from src.main import app
from src.models.order import Order, OrderStatus
from src.orders.service import provision_pending_order
from tests.conftest import make_admin, make_seller, register_and_login, set_seller_tier


async def _seller_token(client, email: str) -> str:
    await register_and_login(client, email)
    await make_seller(email)
    await set_seller_tier(email, "trusted")
    return await register_and_login(client, email)


async def _route_outbound_to_mock(monkeypatch):
    """Let real adapter HTTP reach the mock, including mock webhook callbacks."""
    original_request = httpx.AsyncClient.request

    async def request(self, method, url, *args, **kwargs):
        host = httpx.URL(str(url)).host
        if host == "seller.example.com":
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=mock_seller.app), base_url="https://seller.example.com",
            ) as upstream:
                return await original_request(upstream, method, url, *args, **kwargs)
        if host == "test":
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test",
            ) as marketplace:
                return await original_request(marketplace, method, url, *args, **kwargs)
        return await original_request(self, method, url, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "request", request)


async def _setup_product(client, admin_token, seller_token, provider_id, strategy, suffix, service_type="endpoint"):
    category = await client.post(
        "/admin/categories", json={"name": f"E2E {suffix}", "slug": f"e2e-{suffix}"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert category.status_code == 201, category.text
    product = await client.post(
        "/seller/products",
        json={"category_id": category.json()["id"], "title": f"Mock {suffix}", "status": "active", "escrow_days": 2, "service_type": service_type},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert product.status_code == 201, product.text
    params = {"credit_price": 100} if strategy == "credit" else {"base_price": 100, "platform_mult": {"web": 1}}
    configured = await client.put(
        f"/seller/products/{product.json()['id']}/pricing",
        json={"provider_id": provider_id, "pricing_strategy": strategy, "pricing_params": params},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert configured.status_code == 200, configured.text
    return product.json()["id"]


@pytest.mark.asyncio
async def test_seller_to_admin_to_buyer_with_mock_gateway_and_task(client, monkeypatch):
    mock_seller._resources.clear()
    mock_seller._tasks.clear()
    monkeypatch.setattr(mock_seller, "FAILURE_RATE", 0)
    monkeypatch.setattr(mock_seller, "TASK_PROCESSING_SECONDS", (0, 0))
    monkeypatch.setattr(task_settings, "backend_base_url", "http://test")
    await _route_outbound_to_mock(monkeypatch)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

    admin_email = "e2e-admin@example.com"
    admin_token = await register_and_login(client, admin_email)
    await make_admin(admin_email)
    admin_token = await register_and_login(client, admin_email)
    seller_token = await _seller_token(client, "e2e-seller@example.com")
    buyer_token = await register_and_login(client, "e2e-buyer@example.com")
    buyer = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    await client.post("/wallet/topup", json={"account_id": buyer.json()["id"], "amount": 10_000}, headers={"Authorization": f"Bearer {admin_token}"})

    # 1) Seller submits a direct gateway; it remains pending until admin review.
    gateway = await client.post(
        "/seller/providers",
        json={"name": "Mock direct API", "adapter_type": "seller_gateway", "config": {"base_url": "https://seller.example.com", "api_key": "mock-seller-secret"}},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert gateway.status_code == 201, gateway.text
    assert gateway.json()["review_status"] == "pending_review"
    provider_id = gateway.json()["id"]
    health = await client.post(f"/seller/providers/{provider_id}/test", headers={"Authorization": f"Bearer {seller_token}"})
    assert health.status_code == 200, health.text
    approved = await client.post(f"/admin/providers/{provider_id}/approve", json={"note": "Mock API healthy"}, headers={"Authorization": f"Bearer {admin_token}"})
    assert approved.json()["review_status"] == "approved"
    gateway_product = await _setup_product(client, admin_token, seller_token, provider_id, "credit", "gateway")

    # Editing an approved provider sends it back through review.  Existing
    # product attachments remain visible, but must not accept new orders until
    # an admin approves the updated credentials again.
    pending = await client.put(
        f"/seller/providers/{provider_id}",
        json={"config": {"base_url": "https://seller.example.com", "api_key": "changed-secret"}},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert pending.status_code == 200, pending.text
    assert pending.json()["review_status"] == "pending_review"
    blocked = await client.post(
        "/orders",
        json={"product_id": gateway_product, "user_config": {"package_size": 2}},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert blocked.status_code == 201, blocked.text
    assert blocked.json()["status"] == "cancelled"

    restored = await client.put(
        f"/seller/providers/{provider_id}",
        json={"config": {"base_url": "https://seller.example.com", "api_key": "mock-seller-secret"}},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["review_status"] == "pending_review"
    reapproved = await client.post(
        f"/admin/providers/{provider_id}/approve", json={"note": "Updated credentials verified"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert reapproved.status_code == 200, reapproved.text

    placed = await client.post("/orders", json={"product_id": gateway_product, "user_config": {"package_size": 2}}, headers={"Authorization": f"Bearer {buyer_token}"})
    assert placed.status_code == 201, placed.text
    await provision_pending_order(placed.json()["id"])
    async with SessionLocal() as db:
        order = await db.get(Order, placed.json()["id"])
        assert order.status == OrderStatus.delivered
        key = next(line.split(":", 1)[1].strip() for line in order.delivered_data.splitlines() if line.startswith("Gateway key:"))
    forwarded = await client.get(f"/gw/{key}/search", params={"q": "adapter-contract"})
    assert forwarded.status_code == 200, forwarded.text
    assert forwarded.json()["results"][0] == "result-0-for-adapter-contract"

    # 2) Seller repeats the same journey for asynchronous task + signed callback.
    task = await client.post(
        "/seller/providers",
        json={"name": "Mock async API", "adapter_type": "seller_task_webhook", "config": {"base_url": "https://seller.example.com", "api_key": "mock-seller-secret", "webhook_secret": "mock-webhook-secret"}},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert task.status_code == 201, task.text
    task_provider_id = task.json()["id"]
    await client.post(f"/admin/providers/{task_provider_id}/approve", json={"note": "Callback contract verified"}, headers={"Authorization": f"Bearer {admin_token}"})
    task_product = await _setup_product(
        client, admin_token, seller_token, task_provider_id, "task", "task", service_type="takedown",
    )
    placed_task = await client.post(
        "/orders",
        json={"product_id": task_product, "user_config": {"platform": "web", "target_urls": "https://example.com"}},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert placed_task.status_code == 201, placed_task.text
    await provision_pending_order(placed_task.json()["id"])
    dashboard = await client.get(
        f"/orders/{placed_task.json()['id']}/dashboard",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["service_type"] == "takedown"
    assert len(dashboard.json()["tasks"]) == 1
    # The mock has returned the actual external task id at this point.  In an
    # in-process ASGI test its background callback would re-enter the same
    # event loop, so drive the identical signed callback explicitly here.
    external_task_id = next(iter(mock_seller._tasks))
    callback_body = {"status": "completed", "result_data": "mock result for https://example.com (web)"}
    raw = json.dumps(callback_body).encode()
    signature = hmac.new(b"mock-webhook-secret", raw, hashlib.sha256).hexdigest()
    callback = await client.post(
        f"/webhooks/providers/{task_provider_id}/tasks/{external_task_id}",
        content=raw,
        headers={"Content-Type": "application/json", "X-Signature": signature},
    )
    assert callback.status_code == 200, callback.text
    assert callback.json()["order_status"] == "delivered"
    async with SessionLocal() as db:
        order = await db.get(Order, placed_task.json()["id"])
        assert order.status == OrderStatus.delivered
        assert "mock result for https://example.com" in order.delivered_data
