"""TokenKeysAdapter — token API bán theo số lượng (src/adapters/token_keys.py).

Wire format chạy qua scripts/mock_token_keys.py bằng ASGITransport (không mở
socket). Integration: đơn `fixed` rẽ sang adapter, giao từng access_token
thành một dòng, giao thiếu → hoàn phần thiếu, lỗi nguồn → hoàn cả đơn mà
không tự tắt nguồn.
"""
import importlib
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import undefer

import src.adapters.token_keys as token_module
from src.adapters.supplier import PURCHASE_AUTH, PURCHASE_OUT_OF_STOCK, SupplierUnavailableError
from src.adapters.token_keys import SKU, TokenKeysAdapter, validate_token_keys_config
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.order import Order, OrderStatus
from src.models.product import Product
from src.models.provider import Provider
from src.models.resource import Resource
from src.models.supplier_listing import SupplierListing
from src.security.crypto import encrypt_config
from tests.conftest import make_admin, make_seller, register_and_login


@pytest.fixture
def mock_tokens(monkeypatch):
    import scripts.mock_token_keys as mock_module

    mock = importlib.reload(mock_module)  # state mới cho mỗi test
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real_client(*args, transport=httpx.ASGITransport(app=mock.app), **kwargs)

    monkeypatch.setattr(token_module.httpx, "AsyncClient", client_factory)
    monkeypatch.setattr(token_module.asyncio, "sleep", AsyncMock())
    return mock


def _adapter(**extra) -> TokenKeysAdapter:
    return TokenKeysAdapter({"base_url": "http://tokens.test", **extra}, db=None, provider_id=None)


# ----------------------------------------------------------------------
# Config + wire format
# ----------------------------------------------------------------------

@pytest.mark.no_db
@pytest.mark.asyncio
async def test_validate_config_rejects_bad_values():
    await validate_token_keys_config({"base_url": "http://localhost:8500", "cost_price": 0})
    for bad in (
        {"base_url": "localhost:8500"},
        {"base_url": "http://x", "page_size": 0},
        {"base_url": "http://x", "cost_price": -1},
        {"base_url": "http://x", "stock_cap": "nhiều"},
    ):
        with pytest.raises(HTTPException):
            await validate_token_keys_config(bad)


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_catalog_is_one_token_sku_from_config():
    adapter = _adapter(cost_price=1500, stock_cap=500, max_per_order=50)
    [listing] = await adapter.fetch_catalog()
    assert (listing.external_id, listing.cost_price, listing.amount, listing.max_qty) == (SKU, 1500, 500, 50)
    assert await adapter.fetch_listing("other") is None
    assert adapter.auto_pause_after() == 0, "không tự dừng bán nguồn này"


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_purchase_pages_through_all_tokens(mock_tokens):
    adapter = _adapter(page_size=2)
    outcome = await adapter.purchase(SKU, 5, order_id=1)
    assert outcome.ok and len(outcome.items) == 5 and len(set(outcome.items)) == 5
    assert all(t.startswith("tok_demo_") for t in outcome.items)
    # order_id gửi đi là ref cố định của đơn → gọi lại nhận đúng lô cũ.
    again = await adapter.purchase(SKU, 5, order_id=1)
    assert again.items == outcome.items and again.trans_id == outcome.trans_id


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_purchase_error_kinds(mock_tokens):
    mock_tokens.STATE["mode"] = "out"
    assert (await _adapter().purchase(SKU, 1, order_id=2)).error_kind == PURCHASE_OUT_OF_STOCK
    mock_tokens.STATE["mode"] = "auth"
    assert (await _adapter().purchase(SKU, 1, order_id=3)).error_kind == PURCHASE_AUTH
    mock_tokens.STATE["mode"] = "fail"
    with pytest.raises(SupplierUnavailableError):
        await _adapter().purchase(SKU, 1, order_id=4)
    mock_tokens.STATE["mode"] = "fail_read"
    with pytest.raises(SupplierUnavailableError, match="đã cấp key"):
        await _adapter().purchase(SKU, 1, order_id=5)


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_health_never_reports_unhealthy(mock_tokens, monkeypatch):
    assert (await _adapter().check_health())["status"] == "healthy"

    class Down:
        def __init__(self, *_a, **_k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def request(self, *_a, **_k):
            raise httpx.ConnectError("down")

    monkeypatch.setattr(token_module.httpx, "AsyncClient", Down)
    assert (await _adapter().check_health())["status"] == "warning"


# ----------------------------------------------------------------------
# Integration: đặt hàng
# ----------------------------------------------------------------------

async def _setup(client, *, price=2000):
    await register_and_login(client, "tk_admin@example.com")
    await make_admin("tk_admin@example.com")
    admin_token = await register_and_login(client, "tk_admin@example.com")
    await client.post("/admin/categories", json={"name": "TokCat", "slug": "tokcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cat_id = (await client.get("/categories")).json()[-1]["id"]

    await register_and_login(client, "tk_seller@example.com")
    await make_seller("tk_seller@example.com")
    seller_token = await register_and_login(client, "tk_seller@example.com")
    product = (await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Token API", "status": "active",
        "escrow_days": 2, "service_type": "account", "pricing_strategy": "fixed",
    }, headers={"Authorization": f"Bearer {seller_token}"})).json()
    variant = (await client.post(f"/seller/products/{product['id']}/variants", json={
        "name": "Token", "price": price, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})).json()

    async with SessionLocal() as db:
        provider = Provider(
            name="Token API", type="account", adapter_type="token_keys", priority=1,
            config=encrypt_config({"base_url": "http://tokens.test", "cost_price": 1000}),
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
        provider_id = provider.id

    buyer_token = await register_and_login(client, "tk_buyer@example.com")
    buyer_id = (await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test topup", "account_id": buyer_id, "amount": 100000},
                      headers={"Authorization": f"Bearer {admin_token}"})
    return {"buyer": buyer_token, "variant": variant, "provider_id": provider_id}


async def _wallet(client, token) -> int:
    return (await client.get("/wallet", headers={"Authorization": f"Bearer {token}"})).json()["balance"]


async def _order(client, ctx, quantity: int, monkeypatch) -> dict:
    from src.orders.service import provision_pending_order

    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": quantity},
                             headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert resp.status_code == 201, resp.text
    await provision_pending_order(resp.json()["id"])
    return resp.json()


async def _lines(db, order_id: int) -> list[Resource]:
    return list((await db.execute(
        select(Resource).where(Resource.order_id == order_id).order_by(Resource.id)
        .options(undefer(Resource.data))
    )).scalars())


@pytest.mark.asyncio
async def test_order_delivers_one_line_per_token(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    before = await _wallet(client, ctx["buyer"])
    data = await _order(client, ctx, 3, monkeypatch)

    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order.status == OrderStatus.delivered and order.refunded_amount == 0
        lines = await _lines(db, order.id)
        assert len(lines) == 3 and all(r.data.startswith("tok_demo_") for r in lines)
        assert sum(r.refund_amount_cap for r in lines) == 6000
    assert await _wallet(client, ctx["buyer"]) == before - 6000
    # Nguồn nhận đúng mã đơn làm order_id.
    assert data["order_code"] in mock_tokens.KEYS_BY_ORDER


@pytest.mark.asyncio
async def test_short_delivery_delivers_what_came_and_refunds_the_rest(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    before = await _wallet(client, ctx["buyer"])
    mock_tokens.STATE["stock"] = 2
    data = await _order(client, ctx, 3, monkeypatch)

    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order.status == OrderStatus.delivered
        assert order.refunded_amount == 2000
        lines = await _lines(db, order.id)
        assert len(lines) == 2
        assert sum(r.refund_amount_cap for r in lines) == 4000, "trần hoàn mỗi dòng chia trên phần giữ lại"
        listing = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == ctx["variant"]["id"]))
        assert listing.upstream_amount > 0, "không tự ngừng bán"
    assert await _wallet(client, ctx["buyer"]) == before - 4000


@pytest.mark.asyncio
async def test_out_of_stock_refunds_without_stopping_sales(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    before = await _wallet(client, ctx["buyer"])
    mock_tokens.STATE["mode"] = "out"
    data = await _order(client, ctx, 2, monkeypatch)

    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order.status == OrderStatus.cancelled
        assert "hoàn" in (order.cancel_reason or "").lower()
        listing = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == ctx["variant"]["id"]))
        assert listing.upstream_amount > 0
        assert (await db.get(Provider, ctx["provider_id"])).is_active is True
    assert await _wallet(client, ctx["buyer"]) == before


@pytest.mark.asyncio
async def test_issued_but_unreadable_refunds_and_alerts_with_key_id(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    before = await _wallet(client, ctx["buyer"])
    mock_tokens.STATE["mode"] = "fail_read"
    data = await _order(client, ctx, 1, monkeypatch)

    key_id = mock_tokens.KEYS_BY_ORDER[data["order_code"]]["api_key_id"]
    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order.status == OrderStatus.cancelled
        alert = await db.scalar(select(Alert).where(Alert.type == "provision_operational"))
        assert alert is not None and key_id in alert.message
        assert (await db.get(Provider, ctx["provider_id"])).is_active is True
    assert await _wallet(client, ctx["buyer"]) == before


@pytest.mark.asyncio
async def test_rejected_key_refunds_and_keeps_source_on(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    before = await _wallet(client, ctx["buyer"])
    mock_tokens.STATE["mode"] = "auth"
    data = await _order(client, ctx, 1, monkeypatch)

    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order.status == OrderStatus.cancelled
        assert (await db.get(Provider, ctx["provider_id"])).is_active is True
    assert await _wallet(client, ctx["buyer"]) == before


@pytest.mark.asyncio
async def test_admin_per_order_cap_blocks_before_charging(client, mock_tokens):
    ctx = await _setup(client)
    async with SessionLocal() as db:
        provider = await db.get(Provider, ctx["provider_id"])
        provider.config = {**provider.config, "max_per_order": 5}
        await db.commit()
    before = await _wallet(client, ctx["buyer"])
    resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 6},
                             headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert resp.status_code == 400, resp.text
    assert await _wallet(client, ctx["buyer"]) == before
    assert mock_tokens.KEYS_BY_ORDER == {}, "không gọi nguồn"
    [listing] = await _adapter(max_per_order=5).fetch_catalog()
    assert listing.max_qty == 5


@pytest.mark.asyncio
async def test_saving_per_order_cap_resyncs_storefront_max(client, mock_tokens):
    ctx = await _setup(client)
    await register_and_login(client, "tk_admin@example.com")
    admin = await register_and_login(client, "tk_admin@example.com")
    resp = await client.patch(f"/admin/sources/{ctx['provider_id']}/settings", json={"max_per_order": 7},
                              headers={"Authorization": f"Bearer {admin}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["max_per_order"] == 7
    assert resp.json()["auto_pause_after_failures"] == 0
    async with SessionLocal() as db:
        listing = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == ctx["variant"]["id"]))
        assert listing.upstream_max == 7
