"""Public buyer sales API (/v1, src/public_api).

Orders run through the real checkout with the token_keys adapter talking to
scripts/mock_token_keys.py over ASGITransport (as in test_token_keys_adapter),
so wallet debit, escrow and provisioning are the storefront's own.
"""
import asyncio
import contextlib
import importlib
import re
import time
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import event, func, select, update

import src.adapters.token_keys as token_module
import src.public_api.router as public_router
import src.public_api.service as public_service
from src.adapters.token_keys import SKU
from src.database import SessionLocal, engine
from src.models.account import Account
from src.models.api_key import ApiIdempotency, ApiKey
from src.models.log_entry import LogEntry
from src.models.order import Order
from src.models.product import Product
from src.models.provider import Provider
from src.models.supplier_listing import SupplierListing
from src.orders.service import spawn_provision as _real_spawn_provision

_real_sleep = asyncio.sleep  # mock_tokens stubs asyncio.sleep module-wide
from src.security.crypto import encrypt_config
from tests.conftest import make_admin, make_seller, register_and_login


@pytest.fixture(autouse=True)
def generous_rate_limits(monkeypatch):
    # Key ids restart at 1 after every TRUNCATE while Redis counters live a minute.
    monkeypatch.setattr(public_router, "KEY_REQUESTS_PER_MINUTE", 100_000)
    monkeypatch.setattr(public_router, "KEY_ORDERS_PER_MINUTE", 100_000)
    monkeypatch.setattr(public_router, "IP_REQUESTS_PER_MINUTE", 100_000)
    # Most tests drive provisioning by hand (spawn_provision is a no-op): answer at once.
    monkeypatch.setattr(public_service, "ORDER_WAIT_DEFAULT_SECONDS", 0)


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


# Settings rows are process-cached and re-seeded after every TRUNCATE, so when
# they are read depends on cache timing, not on the code under test.
_CACHED_SETTINGS = re.compile(r"\b(\w+_runtime_config|display_money_config|seller_tier_config)\b")


@contextlib.contextmanager
def _statements():
    """Every SQL statement the engine runs inside the block (any session,
    background provisioning included), cached settings reads aside."""
    seen: list[str] = []

    def count(conn, cursor, statement, *args):
        if not _CACHED_SETTINGS.search(statement):
            seen.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        yield seen
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)


def _without_goods(body: dict) -> dict:
    return {k: v for k, v in body.items() if k not in ("items", "items_truncated", "gateway")}


def _same_order(posted: dict, read: dict) -> bool:
    """POST answers through jsonable_encoder (`+00:00`), GET through the
    response model (`Z`): the same instant, spelled differently."""
    def instant(body: dict) -> datetime:
        return datetime.fromisoformat(body["created_at"].replace("Z", "+00:00"))

    return instant(posted) == instant(read) and {**posted, "created_at": None} == {**read, "created_at": None}


async def _idempotency_summary(order_code: str) -> dict:
    async with SessionLocal() as db:
        order_id = await db.scalar(select(Order.id).where(Order.order_code == order_code))
        return await db.scalar(select(ApiIdempotency.response_json).where(ApiIdempotency.order_id == order_id))


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
    assert resp.status_code == 202, resp.text
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
    assert first.status_code == 202
    again = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 2},
                              headers=_api(ctx["key"], "same"))
    assert again.status_code == 202 and again.headers.get("Idempotent-Replayed") == "true"
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
async def test_order_without_idempotency_key_succeeds_and_charges_once(client, mock_tokens):
    ctx = await _setup(client)
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"]))
    assert resp.status_code == 202, resp.text
    assert resp.headers.get("Idempotent-Replayed") is None
    assert await _order_count() == 1
    assert await _balance(client, ctx["buyer"]) == 100_000 - 2000
    # Two requests without a key are two orders.
    again = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                              headers=_api(ctx["key"]))
    assert again.status_code == 202 and again.json()["order"] != resp.json()["order"]
    assert await _order_count() == 2
    assert await _balance(client, ctx["buyer"]) == 100_000 - 4000


@pytest.mark.asyncio
async def test_daily_spend_limit_holds_without_idempotency_key(client, mock_tokens):
    ctx = await _setup(client)
    key = await _new_key(client, ctx["buyer"], daily_spend_limit=5000)
    ok = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 2}, headers=_api(key["key"]))
    assert ok.status_code == 202
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(key["key"]))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "daily_limit_exceeded"
    assert await _order_count() == 1


@pytest.mark.asyncio
async def test_malformed_idempotency_key_is_rejected(client, mock_tokens):
    ctx = await _setup(client)
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"], "x" * 129))
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "invalid_request"
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
    assert resp.status_code == 202, resp.text


@pytest.mark.asyncio
async def test_daily_spend_limit(client, mock_tokens):
    ctx = await _setup(client)
    key = await _new_key(client, ctx["buyer"], daily_spend_limit=5000)
    ok = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 2},
                           headers=_api(key["key"], "d1"))
    assert ok.status_code == 202
    resp = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(key["key"], "d2"))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "daily_limit_exceeded"
    assert await _order_count() == 1
    # Raising the limit from the account page lets the next order through.
    resp = await client.patch(f"/account/api-keys/{key['id']}", json={"daily_spend_limit": 10_000},
                              headers=_session(ctx["buyer"]))
    assert resp.status_code == 200 and resp.json()["spent_today"] == 4000
    assert (await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                              headers=_api(key["key"], "d2"))).status_code == 202


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
    assert paths == {
        "/v1/me", "/v1/products", "/v1/products/{product}", "/v1/orders", "/v1/orders/quote",
        "/v1/orders/{order_code}", "/v1/orders/{order_code}/gateway-key/rotate",
    }
    assert spec["components"]["securitySchemes"]["bearerAuth"]["scheme"] == "bearer"
    assert spec["security"] == [{"bearerAuth": []}]
    post = spec["paths"]["/v1/orders"]["post"]
    idem = [p for p in post["parameters"] if p["name"] == "Idempotency-Key"]
    assert idem and idem[0]["required"] is False
    assert "202" in post["responses"] and any(p["name"] == "wait" for p in post["parameters"])
    assert "## Chờ kết quả" in spec["info"]["description"]
    assert {t["name"] for t in spec["tags"]} == {"Tài khoản", "Sản phẩm", "Đơn hàng"}
    assert post["responses"]["402"]["content"]["application/json"]["examples"]["insufficient_balance"]
    assert "422" not in post["responses"]
    assert "HTTPValidationError" not in spec["components"]["schemas"]


# ── Titles, kinds and products bought with options ──

TOPPROXY_URL = "http://topproxy.test"
PROXY_PRICE = 60_000


@pytest.fixture
def mock_topproxy(monkeypatch):
    """TopProxy calls go to scripts/mock_topproxy.py in-process (as in test_topproxy_bulk_orders)."""
    from scripts import mock_topproxy as mock

    mock.reset_state()
    original_get = httpx.AsyncClient.get

    async def fake_get(self, url, *args, **kwargs):
        if not str(url).startswith(TOPPROXY_URL):
            return await original_get(self, url, *args, **kwargs)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mock.app)) as mock_client:
            return await original_get(mock_client, url, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    yield mock
    mock.reset_state()


async def _seller_id() -> int:
    async with SessionLocal() as db:
        return await db.scalar(select(Account.id).where(Account.email == "pa_seller@example.com"))


async def _api_product(client, admin: str, product_id: int) -> str:
    resp = await client.patch(f"/admin/products/{product_id}/api", json={"api_enabled": True}, headers=_session(admin))
    assert resp.status_code == 200, resp.text
    async with SessionLocal() as db:
        product = await db.get(Product, product_id)
        return f"{product.slug}-{product.public_key}"


async def _proxy_product(client, ctx) -> str:
    from src.models.category import Category
    from src.models.product import ProductStatus

    from scripts import mock_topproxy as mock

    async with SessionLocal() as db:
        category = Category(name="PA proxy", slug="pa-proxy")
        provider = Provider(
            name="TP static", type="topproxy", adapter_type="topproxy",
            config=encrypt_config({"base_url": TOPPROXY_URL, "api_key": mock.MOCK_KEY, "mode": "static"}),
            credit_balance_xu=1_000_000,
        )
        db.add_all([category, provider])
        await db.flush()
        product = Product(
            seller_id=await _seller_id(), category_id=category.id, title="Proxy tĩnh Viettel",
            i18n={"vi": {"title": "Proxy tĩnh Viettel"}, "en": {"title": "Viettel static proxy"}},
            status=ProductStatus.active, service_type="proxy", provider_id=provider.id,
            pricing_strategy="config", pricing_params={"plan_prices": {"HTTP|Viettel|30": PROXY_PRICE}},
        )
        db.add(product)
        await db.commit()
        product_id = product.id
    return await _api_product(client, ctx["admin"], product_id)


@pytest.mark.asyncio
async def test_orders_carry_kind_titles_and_variant_names(client, mock_tokens):
    ctx = await _setup(client)
    catalog = (await client.get("/v1/products", headers=_api(ctx["key"]))).json()
    [item] = catalog["items"]
    assert item["kind"] == "token" and item["options"] is None and item["quantity"] is None

    placed = (await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                                headers=_api(ctx["key"], "t1"))).json()
    assert placed["kind"] == "token" and placed["product_title"] == "Token API"
    assert placed["variant_name"] == "Token" and placed["product"] == item["product"]
    assert placed["gateway"] is None
    [row] = (await client.get("/v1/orders?locale=vi", headers=_api(ctx["key"]))).json()["items"]
    assert row["product_title"] == "Token API" and row["variant_name"] == "Token" and row["kind"] == "token"
    assert row["variant"] == ctx["variant_key"]
    assert (await client.get("/v1/orders?locale=fr", headers=_api(ctx["key"]))).status_code == 400


@pytest.mark.asyncio
async def test_proxy_options_quote_order_replay_and_delivery(client, mock_topproxy):
    from src.orders.service import provision_pending_order

    ctx = await _setup(client, topup=1_000_000)
    ref = await _proxy_product(client, ctx)

    catalog = (await client.get("/v1/products", headers=_api(ctx["key"]))).json()
    proxy = next(i for i in catalog["items"] if i["product"] == ref)
    assert proxy["kind"] == "proxy" and proxy["variants"] == [] and proxy["title"] == "Viettel static proxy"
    assert proxy["quantity"] == {"min": 1, "max": 50}
    [field] = proxy["options"]
    assert field["name"] == "plan_key" and field["type"] == "enum" and field["required"] is True
    assert [v["value"] for v in field["values"]] == ["HTTP|Viettel|30"]
    detail = (await client.get(f"/v1/products/{ref}?locale=vi", headers=_api(ctx["key"]))).json()
    assert detail["title"] == "Proxy tĩnh Viettel" and detail["options"][0]["name"] == "plan_key"

    body = {"product": ref, "options": {"plan_key": "HTTP|Viettel|30"}, "quantity": 2}
    quote = await client.post("/v1/orders/quote", json=body, headers=_api(ctx["key"]))
    assert quote.status_code == 200, quote.text
    assert quote.json() == {"total": 2 * PROXY_PRICE, "currency": "VND"}
    assert await _order_count() == 0 and await _balance(client, ctx["buyer"]) == 1_000_000

    first = await client.post("/v1/orders", json=body, headers=_api(ctx["key"], "px-1"))
    assert first.status_code == 202, first.text
    placed = first.json()
    assert placed["kind"] == "proxy" and placed["total"] == 2 * PROXY_PRICE and placed["variant"] is None
    again = await client.post("/v1/orders", json=body, headers=_api(ctx["key"], "px-1"))
    assert again.status_code == 202 and again.headers.get("Idempotent-Replayed") == "true"
    assert again.json()["order"] == placed["order"]
    conflict = await client.post("/v1/orders", json={**body, "quantity": 1}, headers=_api(ctx["key"], "px-1"))
    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "idempotency_conflict"
    assert await _order_count() == 1
    assert await _balance(client, ctx["buyer"]) == 1_000_000 - 2 * PROXY_PRICE
    assert (await client.get("/v1/me", headers=_api(ctx["key"]))).json()["spent_today"] == 2 * PROXY_PRICE

    async with SessionLocal() as db:
        order_id = await db.scalar(select(Order.id).where(Order.order_code == placed["order"]))
    await provision_pending_order(order_id)
    with _statements() as get_sql:
        got = (await client.get(f"/v1/orders/{placed['order']}", headers=_api(ctx["key"]))).json()
    assert got["status"] == "delivered" and got["kind"] == "proxy"
    assert [i["line"] for i in got["items"]] == [1, 2]
    assert all(i["data"].count(":") >= 3 and not i["data"].startswith("#") for i in got["items"])
    assert got["items_truncated"] is False and got["gateway"] is None
    assert len(get_sql) <= GET_ORDER_MAX, len(get_sql)
    with _statements() as replay_sql:
        replayed = await client.post("/v1/orders", json=body, headers=_api(ctx["key"], "px-1"))
    assert replayed.status_code == 201 and replayed.headers.get("Idempotent-Replayed") == "true"
    assert _same_order(replayed.json(), got)
    assert len(replay_sql) <= REPLAY_MAX, len(replay_sql)
    assert await _idempotency_summary(placed["order"]) == _without_goods(placed)


@pytest.mark.asyncio
async def test_proxy_options_are_validated_before_any_charge(client, mock_topproxy):
    ctx = await _setup(client, topup=1_000_000)
    ref = await _proxy_product(client, ctx)
    cases = [
        ({"product": ref, "options": {"plan_key": "HTTP|Viettel|30", "colour": "red"}}, 400, "invalid_options"),
        ({"product": ref, "options": {}}, 400, "invalid_options"),
        ({"product": ref, "options": {"plan_key": "HTTP|Mobi|7"}}, 400, "invalid_options"),
        ({"product": ref, "options": {"plan_key": "HTTP|Viettel|30"}, "quantity": 51}, 400, "quantity_limit"),
        ({"product": ref, "variant": "abc", "quantity": 1}, 400, "invalid_request"),
        ({"product": "nope-zzzzzzzz", "options": {}}, 404, "product_not_available"),
        ({"product": "123", "options": {}}, 404, "product_not_available"),
    ]
    for index, (body, status_code, code) in enumerate(cases):
        resp = await client.post("/v1/orders", json=body, headers=_api(ctx["key"], f"bad-{index}"))
        assert (resp.status_code, resp.json()["error"]["code"]) == (status_code, code), (body, resp.text)
    assert await _order_count() == 0 and await _balance(client, ctx["buyer"]) == 1_000_000
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count(ApiIdempotency.id))) == 0


@pytest.mark.asyncio
async def test_options_order_reserves_the_quoted_total_against_the_daily_cap(client, mock_topproxy):
    ctx = await _setup(client, topup=1_000_000)
    ref = await _proxy_product(client, ctx)
    capped = await _new_key(client, ctx["buyer"], daily_spend_limit=100_000)
    body = {"product": ref, "options": {"plan_key": "HTTP|Viettel|30"}, "quantity": 2}
    resp = await client.post("/v1/orders", json=body, headers=_api(capped["key"], "cap-1"))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "daily_limit_exceeded"
    resp = await client.post("/v1/orders", json={**body, "quantity": 1}, headers=_api(capped["key"], "cap-2"))
    assert resp.status_code == 202, resp.text
    assert await _balance(client, ctx["buyer"]) == 1_000_000 - PROXY_PRICE


async def _gateway_product(client, ctx) -> str:
    resp = await client.post("/admin/providers", json={
        "name": "PA gateway", "type": "endpoint", "priority": 1, "adapter_type": "seller_gateway",
        "config": {"base_url": "https://seller.example.com", "api_key": "seller-secret"},
    }, headers=_session(ctx["admin"]))
    assert resp.status_code == 201, resp.text
    provider_id = resp.json()["id"]
    async with SessionLocal() as db:
        product = Product(
            seller_id=await _seller_id(), category_id=(await db.get(Product, ctx["product"]["id"])).category_id,
            title="Lookup API", status="active", service_type="endpoint", provider_id=provider_id,
            pricing_strategy="credit",
            pricing_params={"credit_price": 1000, "packages": [{"size": 100, "price": 50_000, "label": "100 request"}]},
        )
        db.add(product)
        await db.commit()
        product_id = product.id
    return await _api_product(client, ctx["admin"], product_id)


@pytest.mark.asyncio
async def test_gateway_order_exposes_gateway_access_and_rotates_its_key(client, monkeypatch):
    from src.orders.service import provision_pending_order
    from tests.test_gateway import _ok, _patch_seller_http

    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    ctx = await _setup(client, topup=500_000)
    ref = await _gateway_product(client, ctx)

    detail = (await client.get(f"/v1/products/{ref}", headers=_api(ctx["key"]))).json()
    assert detail["kind"] == "gateway" and detail["quantity"] == {"min": 1, "max": 1}
    [field] = detail["options"]
    assert field["name"] == "package_size" and field["values"] == [{"value": 100, "label": "100 request", "price": 50_000}]

    body = {"product": ref, "options": {"package_size": 100}}
    assert (await client.post("/v1/orders/quote", json=body, headers=_api(ctx["key"]))).json()["total"] == 50_000
    bad = await client.post("/v1/orders", json={**body, "quantity": 2}, headers=_api(ctx["key"], "gw-q"))
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "quantity_limit"
    placed = await client.post("/v1/orders", json=body, headers=_api(ctx["key"], "gw-1"))
    assert placed.status_code == 202, placed.text
    code = placed.json()["order"]
    async with SessionLocal() as db:
        order_id = await db.scalar(select(Order.id).where(Order.order_code == code))
    _patch_seller_http(monkeypatch, _ok({"success": True, "data": "session issued", "resource_id": "r1"}))
    await provision_pending_order(order_id)

    with _statements() as get_sql:
        got = (await client.get(f"/v1/orders/{code}", headers=_api(ctx["key"]))).json()
    assert got["kind"] == "gateway" and got["status"] == "delivered" and got["items"] is None
    assert got["items_truncated"] is None and len(get_sql) <= GET_ORDER_MAX, len(get_sql)
    assert not any("proxy_allocations" in sql for sql in get_sql)
    old_key = got["gateway"]["key"]
    assert old_key.startswith("gwk_live_") and f"/gw/{old_key}/" in got["gateway"]["url"]
    assert got["gateway"]["key_hint"] and old_key not in got["gateway"]["key_hint"]

    rotated = await client.post(f"/v1/orders/{code}/gateway-key/rotate", headers=_api(ctx["key"]))
    assert rotated.status_code == 200, rotated.text
    new_key = rotated.json()["key"]
    assert new_key != old_key and f"/gw/{new_key}/" in rotated.json()["url"]
    assert (await client.get(f"/v1/orders/{code}", headers=_api(ctx["key"]))).json()["gateway"]["key"] == new_key
    async with SessionLocal() as db:
        events = set((await db.scalars(select(LogEntry.metadata_["event"].as_string()))).all())
        assert "gateway_key_rotated" in events

    # Another buyer's key, a read-only key, a non-gateway order.
    other = await register_and_login(client, "pa_other@example.com")
    await _enable_buyer("pa_other@example.com")
    other_key = (await _new_key(client, other))["key"]
    resp = await client.post(f"/v1/orders/{code}/gateway-key/rotate", headers=_api(other_key))
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "not_found"
    reader = (await _new_key(client, ctx["buyer"], scopes=["orders:read"]))["key"]
    resp = await client.post(f"/v1/orders/{code}/gateway-key/rotate", headers=_api(reader))
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "forbidden_scope"
    token_order = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                                    headers=_api(ctx["key"], "tok-1"))
    resp = await client.post(f"/v1/orders/{token_order.json()['order']}/gateway-key/rotate", headers=_api(ctx["key"]))
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "not_a_gateway_order"


@pytest.mark.asyncio
async def test_quote_never_charges_and_needs_a_key(client, mock_tokens):
    ctx = await _setup(client)
    body = {"variant": ctx["variant_key"], "quantity": 3}
    assert (await client.post("/v1/orders/quote", json=body)).status_code == 401
    resp = await client.post("/v1/orders/quote", json=body, headers=_api(ctx["key"]))
    assert resp.status_code == 200 and resp.json() == {"total": 6000, "currency": "VND"}
    resp = await client.post("/v1/orders/quote", json={"product": ctx["product"]["slug"] + "-" + ctx["product"]["public_key"],
                                                       "options": {}}, headers=_api(ctx["key"]))
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "invalid_request"
    assert await _order_count() == 0 and await _balance(client, ctx["buyer"]) == 100_000
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count(ApiIdempotency.id))) == 0


@pytest.mark.asyncio
async def test_unsellable_product_is_refused_by_the_admin_switch_and_v1(client, mock_tokens):
    ctx = await _setup(client)
    async with SessionLocal() as db:
        product = Product(
            seller_id=await _seller_id(), category_id=(await db.get(Product, ctx["product"]["id"])).category_id,
            title="Orphan proxy", status="active", service_type="proxy", provider_id=None,
            pricing_strategy="config", pricing_params={"plan_prices": {"HTTP|Viettel|30": 1000}},
        )
        db.add(product)
        await db.commit()
        product_id, ref = product.id, f"{product.slug}-{product.public_key}"

    detail = (await client.get(f"/admin/products/{product_id}", headers=_session(ctx["admin"]))).json()
    assert detail["api_unsupported_reason"] == "no_provider" and detail["api_enabled"] is False
    resp = await client.patch(f"/admin/products/{product_id}/api", json={"api_enabled": True},
                              headers=_session(ctx["admin"]))
    assert resp.status_code == 400 and resp.json()["error_code"] == "API_SALE_UNSUPPORTED"
    ok = (await client.get(f"/admin/products/{ctx['product']['id']}", headers=_session(ctx["admin"]))).json()
    assert ok["api_unsupported_reason"] is None

    # Switched on before its provider went away: /v1 hides and refuses it.
    async with SessionLocal() as db:
        await db.execute(update(Product).where(Product.id == product_id).values(api_enabled=True))
        await db.commit()
    assert all(i["product"] != ref for i in (await client.get("/v1/products", headers=_api(ctx["key"]))).json()["items"])
    resp = await client.get(f"/v1/products/{ref}", headers=_api(ctx["key"]))
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "product_not_available"
    resp = await client.post("/v1/orders", json={"product": ref, "options": {"plan_key": "HTTP|Viettel|30"}},
                             headers=_api(ctx["key"], "orph"))
    assert resp.status_code == 404 and resp.json()["error"]["code"] == "product_not_available"
    assert await _balance(client, ctx["buyer"]) == 100_000


# ── Waiting for provisioning (?wait=) ──

@pytest_asyncio.fixture
async def gated_provision(monkeypatch, mock_tokens):
    """Real spawn_provision, with provisioning held until `gate` is set."""
    from src.orders import service as orders_service

    real_provision = orders_service.provision_pending_order
    gate = asyncio.Event()

    async def held(order_id: int) -> None:
        await gate.wait()
        await real_provision(order_id)

    monkeypatch.setattr(orders_service, "spawn_provision", _real_spawn_provision)
    monkeypatch.setattr(orders_service, "provision_pending_order", held)
    yield gate
    # Let held tasks finish inside this test, not during the next one's TRUNCATE.
    gate.set()
    for order_id in list(orders_service._provision_tasks):
        await orders_service.wait_for_provision(order_id, 10)


@pytest.mark.asyncio
async def test_order_delivers_in_one_call_when_provisioning_is_quick(client, gated_provision):
    gated_provision.set()
    ctx = await _setup(client)
    resp = await client.post("/v1/orders?wait=10", json={"variant": ctx["variant_key"], "quantity": 2},
                             headers=_api(ctx["key"], "fast"))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "delivered" and [i["line"] for i in body["items"]] == [1, 2]
    assert all(i["data"].startswith("tok_demo_") for i in body["items"])


@pytest.mark.asyncio
async def test_slow_provisioning_answers_202_and_keeps_running(client, gated_provision):
    from src.orders.service import provision_task

    ctx = await _setup(client)
    started = time.monotonic()
    resp = await client.post("/v1/orders?wait=1", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"], "slow"))
    assert 0.9 <= time.monotonic() - started < 5
    assert resp.status_code == 202 and resp.json()["status"] == "processing"
    assert resp.json()["items"] == [] and resp.json()["items_truncated"] is False and resp.json()["gateway"] is None
    code = resp.json()["order"]
    assert await _idempotency_summary(code) == _without_goods(resp.json())
    async with SessionLocal() as db:
        order_id = await db.scalar(select(Order.id).where(Order.order_code == code))
    task = provision_task(order_id)
    assert task is not None and not task.done(), "the waiter's timeout never cancels provisioning"

    async def release():
        await _real_sleep(0.3)
        gated_provision.set()

    _, got = await asyncio.gather(
        release(), client.get(f"/v1/orders/{code}?wait=10", headers=_api(ctx["key"])),
    )
    assert got.status_code == 200 and got.json()["status"] == "delivered" and len(got.json()["items"]) == 1
    assert task.done() and not task.cancelled()


@pytest.mark.asyncio
async def test_wait_zero_answers_at_once(client, gated_provision):
    ctx = await _setup(client)
    started = time.monotonic()
    resp = await client.post("/v1/orders?wait=0", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"], "now"))
    assert time.monotonic() - started < 0.9
    assert resp.status_code == 202 and resp.json()["status"] == "processing"
    gated_provision.set()


@pytest.mark.asyncio
async def test_wait_out_of_range_is_invalid(client, mock_tokens):
    ctx = await _setup(client)
    resp = await client.post("/v1/orders?wait=31", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"], "w31"))
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "invalid_request"
    assert await _order_count() == 0


@pytest.mark.asyncio
async def test_replay_of_an_order_in_flight_waits_for_delivery(client, gated_provision):
    ctx = await _setup(client)
    body = {"variant": ctx["variant_key"], "quantity": 1}
    first = await client.post("/v1/orders?wait=0", json=body, headers=_api(ctx["key"], "inflight"))
    assert first.status_code == 202

    async def release():
        await _real_sleep(0.3)
        gated_provision.set()

    _, again = await asyncio.gather(
        release(), client.post("/v1/orders?wait=10", json=body, headers=_api(ctx["key"], "inflight")),
    )
    assert again.status_code == 201 and again.headers.get("Idempotent-Replayed") == "true"
    assert again.json()["order"] == first.json()["order"] and again.json()["status"] == "delivered"
    assert await _order_count() == 1


@pytest.mark.asyncio
async def test_get_wait_polls_when_provisioning_runs_elsewhere(client, mock_tokens):
    """No task in this process (another worker / the sweep): the row is polled."""
    from src.orders.service import provision_pending_order

    ctx = await _setup(client)
    placed = await client.post("/v1/orders", json={"variant": ctx["variant_key"], "quantity": 1},
                               headers=_api(ctx["key"], "elsewhere"))
    code = placed.json()["order"]
    async with SessionLocal() as db:
        order_id = await db.scalar(select(Order.id).where(Order.order_code == code))

    async def elsewhere():
        await _real_sleep(0.3)
        await provision_pending_order(order_id)

    _, got = await asyncio.gather(elsewhere(), client.get(f"/v1/orders/{code}?wait=10", headers=_api(ctx["key"])))
    assert got.json()["status"] == "delivered"
    quick = await client.get(f"/v1/orders/{code}", headers=_api(ctx["key"]))
    assert quick.json()["status"] == "delivered"


@pytest.mark.asyncio
async def test_waiters_over_the_per_key_cap_answer_at_once(client, gated_provision, monkeypatch):
    monkeypatch.setattr(public_service, "ORDER_WAITERS_PER_KEY", 0)
    ctx = await _setup(client)
    started = time.monotonic()
    resp = await client.post("/v1/orders?wait=10", json={"variant": ctx["variant_key"], "quantity": 1},
                             headers=_api(ctx["key"], "capped"))
    assert time.monotonic() - started < 3 and resp.status_code == 202
    gated_provision.set()



# ── Statement budgets (prod traces: ~77 statements per delivered order) ──
# Counts include everything the engine runs meanwhile; the delivered order's
# count includes its background provisioning, as the request's trace does.

DELIVERED_TOKEN_ORDER_MAX = 51  # was 73: auth + reservation + checkout + provisioning + one body
PLACED_ORDER_MAX = 26  # was 35: answered at once (wait=0), still processing
REPLAY_MAX = 6  # was 13: auth, idempotency row, order, refs, delivery summary, goods
GET_ORDER_MAX = 5  # was 11: auth, order, refs, delivery summary, goods


@pytest.mark.asyncio
async def test_delivered_order_is_built_once_within_its_statement_budget(client, gated_provision):
    gated_provision.set()
    ctx = await _setup(client)
    await client.get("/v1/me", headers=_api(ctx["key"]))  # last_used_* written now, not below
    body = {"variant": ctx["variant_key"], "quantity": 2}

    with _statements() as placed_sql:
        placed = await client.post("/v1/orders?wait=10", json=body, headers=_api(ctx["key"], "budget"))
    assert placed.status_code == 201, placed.text
    out = placed.json()
    assert out["status"] == "delivered" and out["kind"] == "token" and out["delivered_quantity"] == 2
    assert [i["line"] for i in out["items"]] == [1, 2] and out["items_truncated"] is False and out["gateway"] is None
    assert len(placed_sql) <= DELIVERED_TOKEN_ORDER_MAX, len(placed_sql)
    # Provisioning checks once for proxy lines to finalise; the body never looks.
    assert sum("proxy_allocations" in sql for sql in placed_sql) == 1
    assert await _idempotency_summary(out["order"]) == {**_without_goods(out), "status": "processing",
                                                        "delivered_quantity": 0}

    with _statements() as replay_sql:
        again = await client.post("/v1/orders?wait=10", json=body, headers=_api(ctx["key"], "budget"))
    assert again.status_code == 201 and again.headers.get("Idempotent-Replayed") == "true"
    assert again.json() == out
    assert len(replay_sql) <= REPLAY_MAX, len(replay_sql)

    with _statements() as get_sql:
        got = await client.get(f"/v1/orders/{out['order']}", headers=_api(ctx["key"]))
    assert got.status_code == 200 and _same_order(out, got.json())
    assert len(get_sql) <= GET_ORDER_MAX, len(get_sql)


@pytest.mark.asyncio
async def test_order_answered_while_processing_within_its_statement_budget(client, mock_tokens):
    ctx = await _setup(client)
    await client.get("/v1/me", headers=_api(ctx["key"]))
    with _statements() as sql:
        resp = await client.post("/v1/orders?wait=0", json={"variant": ctx["variant_key"], "quantity": 1},
                                 headers=_api(ctx["key"], "budget-202"))
    assert resp.status_code == 202, resp.text
    out = resp.json()
    assert out["status"] == "processing" and out["items"] == [] and out["items_truncated"] is False
    assert out["gateway"] is None and out["delivered_quantity"] == 0
    assert len(sql) <= PLACED_ORDER_MAX, len(sql)
    assert await _idempotency_summary(out["order"]) == _without_goods(out)


@pytest.mark.asyncio
async def test_order_failing_provisioning_answers_failed_after_waiting(client, gated_provision, mock_tokens):
    mock_tokens.STATE["mode"] = "out"
    gated_provision.set()
    ctx = await _setup(client)
    body = {"variant": ctx["variant_key"], "quantity": 2}
    resp = await client.post("/v1/orders?wait=10", json=body, headers=_api(ctx["key"], "fails"))
    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert out["status"] == "failed" and out["refunded_amount"] == out["total"] == 4000
    assert out["items"] == [] and out["delivered_quantity"] == 0 and out["gateway"] is None
    assert await _balance(client, ctx["buyer"]) == 100_000
    again = await client.post("/v1/orders?wait=10", json=body, headers=_api(ctx["key"], "fails"))
    assert again.status_code == 201 and again.headers.get("Idempotent-Replayed") == "true"
    assert again.json() == out
    assert _same_order(out, (await client.get(f"/v1/orders/{out['order']}", headers=_api(ctx["key"]))).json())


@pytest.mark.asyncio
async def test_new_accounts_can_use_the_api_by_default(client):
    """Every verified buyer may use the API; admins only switch it off for suspicious accounts."""
    token = await register_and_login(client, "pa_fresh@example.com")
    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == "pa_fresh@example.com"))
        assert account.api_access_enabled is True
        account.email_verified_at = datetime.now(timezone.utc)
        await db.commit()
    key = await _new_key(client, token)
    resp = await client.get("/v1/me", headers=_api(key["key"]))
    assert resp.status_code == 200, resp.text
