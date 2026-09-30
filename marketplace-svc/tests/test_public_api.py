"""Public buyer sales API (/v1, src/public_api).

Orders run through the real checkout with the token_keys adapter talking to
scripts/mock_token_keys.py over ASGITransport (as in test_token_keys_adapter),
so wallet debit, escrow and provisioning are the storefront's own.
"""
import importlib
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import func, select, update

import src.adapters.token_keys as token_module
import src.public_api.router as public_router
from src.adapters.token_keys import SKU
from src.database import SessionLocal
from src.models.account import Account
from src.models.api_key import ApiIdempotency, ApiKey
from src.models.log_entry import LogEntry
from src.models.order import Order
from src.models.product import Product
from src.models.provider import Provider
from src.models.supplier_listing import SupplierListing
from src.security.crypto import encrypt_config
from tests.conftest import make_admin, make_seller, register_and_login


@pytest.fixture(autouse=True)
def generous_rate_limits(monkeypatch):
    # Key ids restart at 1 after every TRUNCATE while Redis counters live a minute.
    monkeypatch.setattr(public_router, "KEY_REQUESTS_PER_MINUTE", 100_000)
    monkeypatch.setattr(public_router, "KEY_ORDERS_PER_MINUTE", 100_000)
    monkeypatch.setattr(public_router, "IP_REQUESTS_PER_MINUTE", 100_000)


@pytest.fixture
def mock_tokens(monkeypatch):
    import scripts.mock_token_keys as mock_module

    mock = importlib.reload(mock_module)
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real_client(*args, transport=httpx.ASGITransport(app=mock.app), **kwargs)

    monkeypatch.setattr(token_module.httpx, "AsyncClient", client_factory)
    monkeypatch.setattr(token_module.asyncio, "sleep", AsyncMock())
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    return mock


def _session(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _enable_buyer(email: str, *, verified: bool = True, enabled: bool = True) -> None:
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == email).values(
            api_access_enabled=enabled, email_verified_at=datetime.now(timezone.utc) if verified else None,
        ))
        await db.commit()


async def _new_key(client, token: str, **body) -> dict:
    resp = await client.post("/account/api-keys", json={"name": "bot", **body}, headers=_session(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _setup(client, *, price=2000, topup=100_000):
    await register_and_login(client, "pa_admin@example.com")
    await make_admin("pa_admin@example.com")
    admin = await register_and_login(client, "pa_admin@example.com")
    await client.post("/admin/categories", json={"name": "Tok", "slug": "tok"}, headers=_session(admin))
    cat_id = (await client.get("/categories")).json()[-1]["id"]

    await register_and_login(client, "pa_seller@example.com")
    await make_seller("pa_seller@example.com")
    seller = await register_and_login(client, "pa_seller@example.com")
    product = (await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Token API", "status": "active",
        "escrow_days": 2, "service_type": "account", "pricing_strategy": "fixed",
    }, headers=_session(seller))).json()
    variant = (await client.post(f"/seller/products/{product['id']}/variants", json={
        "name": "Token", "price": price, "delivery_mode": "instant",
    }, headers=_session(seller))).json()

    async with SessionLocal() as db:
        provider = Provider(
            name="Token API", type="account", adapter_type="token_keys", priority=1,
            config=encrypt_config({"base_url": "http://tokens.test/api/v1", "cost_price": 1000}),
            is_active=True, review_status="approved",
        )
        db.add(provider)
        await db.flush()
        await db.execute(update(Product).where(Product.id == product["id"]).values(
            provider_id=provider.id, pricing_strategy="fixed",
        ))
        db.add(SupplierListing(
            provider_id=provider.id, variant_id=variant["id"], external_product_id=SKU,
            external_name="Token", cost_price=1000, upstream_amount=100_000,
        ))
        await db.commit()

    # Listing in the API is the admin's switch.
    resp = await client.patch(f"/admin/products/{product['id']}/api", json={"api_enabled": True},
                              headers=_session(admin))
    assert resp.status_code == 200 and resp.json() == {"api_enabled": True}

    buyer = await register_and_login(client, "pa_buyer@example.com")
    buyer_id = (await client.get("/me", headers=_session(buyer))).json()["id"]
    if topup:
        await client.post("/wallet/topup", json={"reason": "test topup", "account_id": buyer_id, "amount": topup},
                          headers=_session(admin))
    await _enable_buyer("pa_buyer@example.com")
    key = await _new_key(client, buyer)
    return {
        "admin": admin, "buyer": buyer, "buyer_id": buyer_id, "key": key["key"], "key_id": key["id"],
        "product": product, "variant": variant, "variant_key": variant["public_key"],
    }


def _api(key: str, idem: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {key}"}
    if idem is not None:
        headers["Idempotency-Key"] = idem
    return headers


async def _balance(client, token) -> int:
    return (await client.get("/wallet", headers=_session(token))).json()["balance"]


async def _order_count() -> int:
    async with SessionLocal() as db:
        return await db.scalar(select(func.count(Order.id)))


# ── Success, replay, conflict ──

@pytest.mark.asyncio
async def test_order_success_delivers_items_and_charges_once(client, mock_tokens):
    from src.orders.service import provision_pending_order

    ctx = await _setup(client)
    me = (await client.get("/v1/me", headers=_api(ctx["key"]))).json()
    assert me == {"balance": 100_000, "currency": "VND", "daily_spend_limit": 1_000_000, "spent_today": 0}

    catalog = (await client.get("/v1/products", headers=_api(ctx["key"]))).json()
    [item] = catalog["items"]
    assert item["product"].endswith(ctx["product"]["public_key"])
    [variant] = item["variants"]
    assert variant["id"] == ctx["variant_key"] and variant["price"] == 2000 and variant["in_stock"]
    assert "provider" not in str(catalog) and "cost" not in str(catalog)

    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 3},
                             headers=_api(ctx["key"], "idem-1"))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["order"].startswith("ORD-") and body["status"] == "processing"
    assert body["total"] == 6000 and body["variant"] == ctx["variant_key"] and "id" not in body

    async with SessionLocal() as db:
        order_id = await db.scalar(select(Order.id).where(Order.order_code == body["order"]))
    await provision_pending_order(order_id)

    detail = (await client.get(f"/v1/orders/{body['order']}", headers=_api(ctx["key"]))).json()
    assert detail["status"] == "delivered" and detail["delivered_quantity"] == 3
    assert [i["line"] for i in detail["items"]] == [1, 2, 3]
    assert all(i["data"].startswith("tok_demo_") for i in detail["items"])
    assert await _balance(client, ctx["buyer"]) == 100_000 - 6000

    listing = (await client.get("/v1/orders?limit=10", headers=_api(ctx["key"]))).json()
    assert [o["order"] for o in listing["items"]] == [body["order"]]
    assert listing["items"][0].get("items") is None and listing["next_cursor"] is None
    assert (await client.get("/v1/me", headers=_api(ctx["key"]))).json()["spent_today"] == 6000

    async with SessionLocal() as db:
        events = set((await db.scalars(select(LogEntry.metadata_["event"].as_string()))).all())
        assert {"api_key_created", "api_order_created"} <= events
        row = await db.scalar(select(ApiIdempotency))
        assert "items" not in (row.response_json or {}), "delivered goods are never stored with the idempotency row"


@pytest.mark.asyncio
async def test_replay_same_key_returns_same_order_without_second_charge(client, mock_tokens):
    ctx = await _setup(client)
    first = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 2},
                              headers=_api(ctx["key"], "same"))
    assert first.status_code == 201
    again = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 2},
                              headers=_api(ctx["key"], "same"))
    assert again.status_code == 201 and again.headers.get("Idempotent-Replayed") == "true"
    assert again.json()["order"] == first.json()["order"]
    assert await _order_count() == 1
    assert await _balance(client, ctx["buyer"]) == 100_000 - 4000


@pytest.mark.asyncio
async def test_same_key_different_body_conflicts(client, mock_tokens):
    ctx = await _setup(client)
    await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                      headers=_api(ctx["key"], "k1"))
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 2},
                             headers=_api(ctx["key"], "k1"))
    assert resp.status_code == 409
    assert resp.json() == {"error": {"code": "idempotency_conflict", "message": resp.json()["error"]["message"]}}
    assert await _order_count() == 1


@pytest.mark.asyncio
async def test_in_flight_key_answers_request_in_progress(client, mock_tokens):
    ctx = await _setup(client)
    import hashlib
    import json

    request_hash = hashlib.sha256(json.dumps({"variant": ctx["variant_key"], "quantity": 1}, sort_keys=True)
                                  .encode()).hexdigest()
    async with SessionLocal() as db:
        db.add(ApiIdempotency(account_id=ctx["buyer_id"], api_key_id=ctx["key_id"], idem_key="busy",
                              request_hash=request_hash, reserved_amount=2000))
        await db.commit()
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"], "busy"))
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "request_in_progress"


@pytest.mark.asyncio
async def test_missing_idempotency_key(client, mock_tokens):
    ctx = await _setup(client)
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"]))
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "idempotency_key_required"
    assert await _order_count() == 0


@pytest.mark.asyncio
async def test_invalid_quantity(client, mock_tokens):
    ctx = await _setup(client)
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 0},
                             headers=_api(ctx["key"], "q0"))
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "invalid_quantity"


# ── Authentication and gates ──

@pytest.mark.asyncio
async def test_missing_and_unknown_key(client, mock_tokens):
    await _setup(client)
    resp = await client.get("/v1/me")
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "invalid_api_key"
    resp = await client.get("/v1/me", headers=_api("pk_live_deadbeef_nope"))
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "invalid_api_key"


@pytest.mark.asyncio
async def test_x_api_key_header_is_accepted(client, mock_tokens):
    ctx = await _setup(client)
    resp = await client.get("/v1/me", headers={"X-API-Key": ctx["key"]})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_revoked_key_is_rejected(client, mock_tokens):
    ctx = await _setup(client)
    resp = await client.delete(f"/account/api-keys/{ctx['key_id']}", headers=_session(ctx["buyer"]))
    assert resp.status_code == 204
    resp = await client.get("/v1/me", headers=_api(ctx["key"]))
    assert resp.status_code == 401 and resp.json()["error"]["code"] == "invalid_api_key"
    async with SessionLocal() as db:
        assert "api_key_revoked" in set((await db.scalars(select(LogEntry.metadata_["event"].as_string()))).all())


@pytest.mark.asyncio
async def test_account_not_enabled_blocks_keys_and_key_creation(client, mock_tokens):
    ctx = await _setup(client)
    resp = await client.patch(f"/admin/accounts/{ctx['buyer_id']}/api-access", json={"api_access_enabled": False},
                              headers=_session(ctx["admin"]))
    assert resp.status_code == 200 and resp.json()["api_access_enabled"] is False
    resp = await client.get("/v1/me", headers=_api(ctx["key"]))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "api_access_disabled"
    resp = await client.post("/account/api-keys", json={"name": "x"}, headers=_session(ctx["buyer"]))
    assert resp.status_code == 403 and resp.json()["error_code"] == "API_ACCESS_DISABLED"
    listing = (await client.get("/account/api-keys", headers=_session(ctx["buyer"]))).json()
    assert listing["enabled"] is False


@pytest.mark.asyncio
async def test_admin_switches_require_admin(client, mock_tokens):
    ctx = await _setup(client)
    resp = await client.patch(f"/admin/accounts/{ctx['buyer_id']}/api-access", json={"api_access_enabled": True},
                              headers=_session(ctx["buyer"]))
    assert resp.status_code == 403
    resp = await client.patch(f"/admin/products/{ctx['product']['id']}/api", json={"api_enabled": False},
                              headers=_session(ctx["buyer"]))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_unverified_email_is_rejected(client, mock_tokens):
    ctx = await _setup(client)
    await _enable_buyer("pa_buyer@example.com", verified=False)
    resp = await client.get("/v1/me", headers=_api(ctx["key"]))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "api_access_disabled"
    resp = await client.post("/account/api-keys", json={"name": "x"}, headers=_session(ctx["buyer"]))
    assert resp.status_code == 403 and resp.json()["error_code"] == "EMAIL_NOT_VERIFIED"


@pytest.mark.asyncio
async def test_product_not_api_enabled(client, mock_tokens):
    ctx = await _setup(client)
    await client.patch(f"/admin/products/{ctx['product']['id']}/api", json={"api_enabled": False},
                       headers=_session(ctx["admin"]))
    assert (await client.get("/v1/products", headers=_api(ctx["key"]))).json()["items"] == []
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"], "p1"))
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "product_not_available"
    assert await _balance(client, ctx["buyer"]) == 100_000


@pytest.mark.asyncio
async def test_other_buyers_order_is_not_found(client, mock_tokens):
    ctx = await _setup(client)
    placed = (await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                                headers=_api(ctx["key"], "o1"))).json()
    other = await register_and_login(client, "pa_other@example.com")
    await _enable_buyer("pa_other@example.com")
    other_key = (await _new_key(client, other))["key"]
    resp = await client.get(f"/v1/orders/{placed['order']}", headers=_api(other_key))
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "not_found"
    assert (await client.get("/v1/orders", headers=_api(other_key))).json()["items"] == []


@pytest.mark.asyncio
async def test_insufficient_balance_frees_the_idempotency_key(client, mock_tokens):
    ctx = await _setup(client, topup=1000)
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"], "poor"))
    assert resp.status_code == 402 and resp.json()["error"]["code"] == "insufficient_balance"
    assert await _order_count() == 0
    await client.post("/wallet/topup", json={"reason": "test topup", "account_id": ctx["buyer_id"], "amount": 10_000},
                      headers=_session(ctx["admin"]))
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"], "poor"))
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_daily_spend_limit(client, mock_tokens):
    ctx = await _setup(client)
    key = await _new_key(client, ctx["buyer"], daily_spend_limit=5000)
    ok = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 2},
                           headers=_api(key["key"], "d1"))
    assert ok.status_code == 201
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(key["key"], "d2"))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "daily_limit_exceeded"
    assert await _order_count() == 1
    # Raising the limit from the account page lets the next order through.
    resp = await client.patch(f"/account/api-keys/{key['id']}", json={"daily_spend_limit": 10_000},
                              headers=_session(ctx["buyer"]))
    assert resp.status_code == 200 and resp.json()["spent_today"] == 4000
    assert (await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                              headers=_api(key["key"], "d2"))).status_code == 201


@pytest.mark.asyncio
async def test_ip_not_allowed(client, mock_tokens):
    ctx = await _setup(client)
    key = await _new_key(client, ctx["buyer"], allowed_ips=["10.1.2.3", "192.168.0.0/24"])
    assert key["allowed_ips"] == ["10.1.2.3", "192.168.0.0/24"]
    resp = await client.get("/v1/me", headers=_api(key["key"]))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "ip_not_allowed"
    await client.patch(f"/account/api-keys/{key['id']}", json={"allowed_ips": ["127.0.0.1"]},
                       headers=_session(ctx["buyer"]))
    assert (await client.get("/v1/me", headers=_api(key["key"]))).status_code == 200
    bad = await client.post("/account/api-keys", json={"name": "x", "allowed_ips": ["not-an-ip"]},
                            headers=_session(ctx["buyer"]))
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_read_only_key_cannot_order(client, mock_tokens):
    ctx = await _setup(client)
    key = await _new_key(client, ctx["buyer"], scopes=["orders:read"])
    assert (await client.get("/v1/orders", headers=_api(key["key"]))).status_code == 200
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(key["key"], "s1"))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "forbidden_scope"


@pytest.mark.asyncio
async def test_key_management_cap_and_plaintext_once(client, mock_tokens):
    ctx = await _setup(client)
    listing = (await client.get("/account/api-keys", headers=_session(ctx["buyer"]))).json()
    assert listing["enabled"] and "key" not in listing["items"][0]
    for _ in range(9):
        await _new_key(client, ctx["buyer"])
    resp = await client.post("/account/api-keys", json={"name": "11th"}, headers=_session(ctx["buyer"]))
    assert resp.status_code == 409 and resp.json()["error_code"] == "API_KEY_LIMIT"
    async with SessionLocal() as db:
        stored = await db.scalar(select(ApiKey).where(ApiKey.id == ctx["key_id"]))
        assert ctx["key"] not in (stored.key_hash, stored.prefix) and ctx["key"].startswith(f"pk_live_{stored.prefix}_")
    other = await register_and_login(client, "pa_other@example.com")
    resp = await client.delete(f"/account/api-keys/{ctx['key_id']}", headers=_session(other))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_rate_limit_answers_429_with_retry_after(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)

    async def refuse(*_a, **_k):
        return False

    monkeypatch.setattr(public_router, "check_rate_limit", refuse)
    resp = await client.get("/v1/me", headers=_api(ctx["key"]))
    assert resp.status_code == 429 and resp.headers["Retry-After"] == "60"
    assert resp.json()["error"]["code"] == "rate_limited"


@pytest.mark.asyncio
async def test_openapi_spec_lists_only_v1_routes(client):
    resp = await client.get("/v1/openapi.json")
    assert resp.status_code == 200
    assert "public" in resp.headers.get("cache-control", "")
    spec = resp.json()
    assert spec["openapi"].startswith("3.1")
    assert spec["info"]["title"] == "GMMO Buyer API"
    paths = set(spec["paths"])
    assert paths == {"/v1/me", "/v1/products", "/v1/orders", "/v1/orders/{order_code}"}
    assert spec["components"]["securitySchemes"]["bearerAuth"]["scheme"] == "bearer"
    assert spec["security"] == [{"bearerAuth": []}]
    post = spec["paths"]["/v1/orders"]["post"]
    idem = [p for p in post["parameters"] if p["name"] == "Idempotency-Key"]
    assert idem and idem[0]["required"] is True
    assert post["responses"]["402"]["content"]["application/json"]["examples"]["insufficient_balance"]
    assert "422" not in post["responses"]
    assert "HTTPValidationError" not in spec["components"]["schemas"]
