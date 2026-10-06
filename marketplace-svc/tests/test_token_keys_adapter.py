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
    return TokenKeysAdapter({"base_url": "http://tokens.test/api/v1", **extra}, db=None, provider_id=None)


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
        provider_id = provider.id

    buyer_token = await register_and_login(client, "tk_buyer@example.com")
    buyer_id = (await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test topup", "account_id": buyer_id, "amount": 100000},
                      headers={"Authorization": f"Bearer {admin_token}"})
    return {"buyer": buyer_token, "variant": variant, "provider_id": provider_id, "seller": seller_token}


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
async def test_order_never_asks_for_a_balance_the_source_does_not_have(client, mock_tokens, monkeypatch):
    """The token source has no balance API: precheck and the purchase
    bookkeeping used to call it anyway and log two warnings per order."""
    from structlog.testing import capture_logs

    ctx = await _setup(client)
    asked = AsyncMock(side_effect=SupplierUnavailableError("no balance api"))
    monkeypatch.setattr(TokenKeysAdapter, "fetch_balance", asked)
    with capture_logs() as logs:
        data = await _order(client, ctx, 1, monkeypatch)
    async with SessionLocal() as db:
        assert (await db.get(Order, data["id"])).status == OrderStatus.delivered
    asked.assert_not_awaited()
    assert not [e for e in logs if e["event"] in ("supplier_precheck_unavailable", "supplier_balance_before_failed")]


@pytest.mark.asyncio
async def test_short_delivery_delivers_what_came_and_refunds_the_rest(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    before = await _wallet(client, ctx["buyer"])
    mock_tokens.STATE["stock"] = 2
    mock_tokens.STATE["report_stock"] = False  # nguồn không báo tồn → trừ số đã giao
    data = await _order(client, ctx, 3, monkeypatch)

    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order.status == OrderStatus.delivered
        assert order.refunded_amount == 2000
        lines = await _lines(db, order.id)
        assert len(lines) == 2
        assert sum(r.refund_amount_cap for r in lines) == 4000, "trần hoàn mỗi dòng chia trên phần giữ lại"
        listing = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == ctx["variant"]["id"]))
        assert listing.upstream_amount == 100_000 - 2, "trừ đúng số đã giao, không tự ngừng bán"
    assert await _wallet(client, ctx["buyer"]) == before - 4000


@pytest.mark.asyncio
async def test_out_of_stock_refunds_without_stopping_sales(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    before = await _wallet(client, ctx["buyer"])
    mock_tokens.STATE["mode"] = "out"
    mock_tokens.STATE["report_stock"] = False
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


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_partner_key_travels_as_query_param_on_both_calls(mock_tokens, monkeypatch):
    from src.security.crypto import encrypt_str

    seen: list[tuple[str, dict | None, dict | None]] = []
    real_call = TokenKeysAdapter._call

    async def spy(self, method, path, **kw):
        seen.append((path, kw.get("params"), kw.get("headers")))
        return await real_call(self, method, path, **kw)

    monkeypatch.setattr(TokenKeysAdapter, "_call", spy)
    adapter = _adapter(api_key=encrypt_str("partner-key"), auth_query_param="api_key")
    outcome = await adapter.purchase(SKU, 2, order_id=9)
    assert outcome.ok and len(outcome.items) == 2
    keys_call, tokens_call = seen[0], seen[1]
    assert keys_call[0] == "/keys" and keys_call[1] == {"api_key": "partner-key"}
    assert "Authorization" not in (keys_call[2] or {})
    assert tokens_call[0] == "/customer/tokens"
    assert tokens_call[1]["api_key"] == "partner-key" and tokens_call[1]["page"] == 1
    assert tokens_call[2]["X-API-Key"].startswith("sk_")


async def _listing(variant_id: int) -> SupplierListing:
    async with SessionLocal() as db:
        return await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == variant_id))


@pytest.mark.asyncio
async def test_token_stock_is_set_by_hand_counts_down_and_survives_sync(client, mock_tokens, monkeypatch):
    from src.suppliers.service import sync_provider_listings

    ctx = await _setup(client)
    admin = await register_and_login(client, "tk_admin@example.com")
    listing_id = (await _listing(ctx["variant"]["id"])).id

    resp = await client.patch(f"/admin/sources/listings/{listing_id}", json={"stock": 50},
                              headers={"Authorization": f"Bearer {admin}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["stock_editable"] is True
    assert resp.json()["upstream_amount"] == 50

    mock_tokens.STATE["report_stock"] = False  # nguồn không báo tồn → đếm lùi từ số đặt tay
    await _order(client, ctx, 3, monkeypatch)
    assert (await _listing(ctx["variant"]["id"])).upstream_amount == 47

    # Đồng bộ catalog (4h) không đặt lại về stock_cap.
    async with SessionLocal() as db:
        await sync_provider_listings(await db.get(Provider, ctx["provider_id"]), db)
        await db.commit()
    assert (await _listing(ctx["variant"]["id"])).upstream_amount == 47

    bad = await client.patch(f"/admin/sources/listings/{listing_id}", json={"stock": -1},
                             headers={"Authorization": f"Bearer {admin}"})
    assert bad.status_code == 422
    anon = await client.patch(f"/admin/sources/listings/{listing_id}", json={"stock": 5},
                              headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert anon.status_code in (401, 403)
    assert (await _listing(ctx["variant"]["id"])).upstream_amount == 47


@pytest.mark.asyncio
async def test_stock_reported_by_the_source_cannot_be_set_by_hand(client, mock_tokens):
    ctx = await _setup(client)
    admin = await register_and_login(client, "tk_admin@example.com")
    async with SessionLocal() as db:
        await db.execute(update(Provider).where(Provider.id == ctx["provider_id"]).values(adapter_type="igbm"))
        await db.commit()
    listing_id = (await _listing(ctx["variant"]["id"])).id
    resp = await client.patch(f"/admin/sources/listings/{listing_id}", json={"stock": 5},
                              headers={"Authorization": f"Bearer {admin}"})
    assert resp.status_code == 400, resp.text
    assert (await _listing(ctx["variant"]["id"])).upstream_amount == 100_000


async def _own_source(ctx, email: str) -> None:
    """Giao nguồn cho seller (nội bộ) — khu /seller/sources chỉ cho seller nội bộ."""
    from src.models.account import Account

    async with SessionLocal() as db:
        seller_id = await db.scalar(select(Account.id).where(Account.email == email))
        await db.execute(update(Account).where(Account.id == seller_id).values(is_internal=True))
        await db.execute(update(Provider).where(Provider.id == ctx["provider_id"]).values(seller_id=seller_id))
        await db.commit()


@pytest.mark.asyncio
async def test_stock_card_for_admin_and_owner_with_audit_and_sold_counts(client, mock_tokens, monkeypatch):
    from src.models.log_entry import LogEntry

    ctx = await _setup(client)
    await _own_source(ctx, "tk_seller@example.com")
    admin = {"Authorization": f"Bearer {await register_and_login(client, 'tk_admin@example.com')}"}
    seller = {"Authorization": f"Bearer {ctx['seller']}"}
    listing_id = (await _listing(ctx["variant"]["id"])).id
    async with SessionLocal() as db:
        public_key = (await db.get(Provider, ctx["provider_id"])).public_key

    # Admin đặt tồn → audit old→new + actor.
    assert (await client.patch(f"/admin/sources/listings/{listing_id}", json={"stock": 500}, headers=admin)).status_code == 200
    # Seller chủ nguồn đặt tồn qua khu seller.
    resp = await client.patch(f"/seller/sources/listings/{listing_id}", json={"stock": 300}, headers=seller)
    assert resp.status_code == 200, resp.text
    assert resp.json()["upstream_amount"] == 300
    # Đặt lại đúng số cũ → không ghi audit thừa.
    await client.patch(f"/seller/sources/listings/{listing_id}", json={"stock": 300}, headers=seller)

    async with SessionLocal() as db:
        events = [e.metadata_ for e in (await db.execute(select(LogEntry).order_by(LogEntry.id))).scalars()
                  if (e.metadata_ or {}).get("event") == "supplier_listing_stock_set"]
    assert [(m["old"], m["new"], m["actor_type"]) for m in events] == [(100_000, 500, "admin"), (500, 300, "seller")]
    assert all(m["listing_id"] == listing_id and m["actor_id"] for m in events)

    mock_tokens.STATE["report_stock"] = False  # đếm lùi từ số đặt tay
    await _order(client, ctx, 3, monkeypatch)

    body = (await client.get(f"/admin/sources/{ctx['provider_id']}/stock", headers=admin)).json()
    assert body["max_per_order"] > 0
    [row] = body["listings"]
    assert row["stock"] == 297 and row["sold_24h"] == 3 and row["sold_7d"] == 3
    assert row["last_set"]["new"] == 300 and row["last_set"]["actor_email"] == "tk_seller@example.com"

    mine = (await client.get(f"/seller/sources/{public_key}/stock", headers=seller))
    assert mine.status_code == 200, mine.text
    [row] = mine.json()["listings"]
    assert row["stock"] == 297 and row["last_set"]["by_me"] is True


@pytest.mark.asyncio
async def test_stock_card_rejects_other_seller_buyer_and_non_manual_source(client, mock_tokens):
    from src.models.account import Account

    ctx = await _setup(client)
    await _own_source(ctx, "tk_seller@example.com")
    await register_and_login(client, "tk_other@example.com")
    await make_seller("tk_other@example.com")
    other_token = await register_and_login(client, "tk_other@example.com")
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == "tk_other@example.com").values(is_internal=True))
        await db.commit()
    other = {"Authorization": f"Bearer {other_token}"}
    listing_id = (await _listing(ctx["variant"]["id"])).id

    assert (await client.get(f"/seller/sources/{ctx['provider_id']}/stock", headers=other)).status_code == 404
    assert (await client.patch(f"/seller/sources/listings/{listing_id}", json={"stock": 1}, headers=other)).status_code == 404
    buyer = {"Authorization": f"Bearer {ctx['buyer']}"}
    assert (await client.get(f"/admin/sources/{ctx['provider_id']}/stock", headers=buyer)).status_code in (401, 403)
    seller = {"Authorization": f"Bearer {ctx['seller']}"}
    assert (await client.patch(f"/seller/sources/listings/{listing_id}", json={"stock": -5}, headers=seller)).status_code == 422
    assert (await _listing(ctx["variant"]["id"])).upstream_amount == 100_000

    admin = {"Authorization": f"Bearer {await register_and_login(client, 'tk_admin@example.com')}"}
    async with SessionLocal() as db:
        await db.execute(update(Provider).where(Provider.id == ctx["provider_id"]).values(adapter_type="igbm"))
        await db.commit()
    assert (await client.get(f"/admin/sources/{ctx['provider_id']}/stock", headers=admin)).status_code == 400


# ----------------------------------------------------------------------
# Nguồn báo tồn (`stock`) + email buyer (`client`) trong POST /keys
# ----------------------------------------------------------------------

@pytest.mark.no_db
def test_reported_stock_accepts_only_non_negative_integers():
    from src.adapters.token_keys import _reported_stock

    assert _reported_stock({"stock": 5}) == 5
    assert _reported_stock({"stock": 0}) == 0
    assert _reported_stock({"stock": " 7 "}) == 7
    for bad in ({}, {"stock": None}, {"stock": -1}, {"stock": True}, {"stock": "abc"}, {"stock": 2.5}):
        assert _reported_stock(bad) is None, bad


@pytest.mark.asyncio
async def test_order_sends_buyer_email_as_client_and_takes_the_reported_stock(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    admin = await register_and_login(client, "tk_admin@example.com")
    listing_id = (await _listing(ctx["variant"]["id"])).id
    # Số đặt tay chỉ là điểm xuất phát: lệnh mua kế tiếp ghi đè bằng tồn thật.
    await client.patch(f"/admin/sources/listings/{listing_id}", json={"stock": 50},
                       headers={"Authorization": f"Bearer {admin}"})
    mock_tokens.STATE["stock"] = 1234

    data = await _order(client, ctx, 3, monkeypatch)

    assert mock_tokens.CUSTOMER_BY_ORDER[data["order_code"]] == "tk_buyer@example.com"
    listing = await _listing(ctx["variant"]["id"])
    assert listing.upstream_amount == 1231 == mock_tokens.STATE["stock"]
    assert listing.extra["reported_stock"] == 1231 and listing.extra["reported_stock_at"]

    resp = await client.get(f"/admin/sources/{ctx['provider_id']}/stock",
                            headers={"Authorization": f"Bearer {admin}"})
    assert resp.status_code == 200, resp.text
    row = resp.json()["listings"][0]
    assert row["stock"] == 1231 and row["reported"]["stock"] == 1231 and row["reported"]["at"]


@pytest.mark.asyncio
async def test_source_reporting_empty_sells_out_alerts_and_clears_on_restock(client, mock_tokens, monkeypatch):
    from src.alerts.service import fp_variant

    ctx = await _setup(client)
    fingerprint = fp_variant(ctx["variant"]["id"], "supplier_reported_empty")
    before = await _wallet(client, ctx["buyer"])
    mock_tokens.STATE["stock"] = 2

    data = await _order(client, ctx, 3, monkeypatch)

    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order.status == OrderStatus.delivered and order.refunded_amount == 2000
        assert (await _listing(ctx["variant"]["id"])).upstream_amount == 0, "nguồn báo hết → Hết hàng"
        alert = await db.scalar(select(Alert).where(Alert.fingerprint == fingerprint, Alert.is_active.is_(True)))
        assert alert is not None and alert.severity == "warning" and alert.type == "supplier_reported_empty"
        assert (await db.get(Provider, ctx["provider_id"])).is_active is True
    assert await _wallet(client, ctx["buyer"]) == before - 4000

    # Hết hàng thật thì checkout chặn trước khi trừ ví.
    blocked = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 1},
                                headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert blocked.status_code == 409, blocked.text

    # Nguồn nhập thêm: admin đặt lại tồn, lệnh mua kế tiếp báo tồn mới, cảnh báo tự đóng.
    admin = await register_and_login(client, "tk_admin@example.com")
    listing_id = (await _listing(ctx["variant"]["id"])).id
    await client.patch(f"/admin/sources/listings/{listing_id}", json={"stock": 5},
                       headers={"Authorization": f"Bearer {admin}"})
    mock_tokens.STATE["stock"] = 10
    await _order(client, ctx, 1, monkeypatch)
    assert (await _listing(ctx["variant"]["id"])).upstream_amount == 9
    async with SessionLocal() as db:
        assert await db.scalar(select(Alert).where(Alert.fingerprint == fingerprint, Alert.is_active.is_(True))) is None


@pytest.mark.asyncio
async def test_out_of_stock_with_reported_zero_refunds_and_sells_out(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    before = await _wallet(client, ctx["buyer"])
    mock_tokens.STATE["mode"] = "out"

    data = await _order(client, ctx, 2, monkeypatch)

    async with SessionLocal() as db:
        assert (await db.get(Order, data["id"])).status == OrderStatus.cancelled
        assert (await db.get(Provider, ctx["provider_id"])).is_active is True
    assert (await _listing(ctx["variant"]["id"])).upstream_amount == 0
    assert await _wallet(client, ctx["buyer"]) == before


@pytest.mark.asyncio
async def test_source_without_stock_field_keeps_counting_down(client, mock_tokens, monkeypatch):
    ctx = await _setup(client)
    mock_tokens.STATE["report_stock"] = False
    await _order(client, ctx, 3, monkeypatch)
    listing = await _listing(ctx["variant"]["id"])
    assert listing.upstream_amount == 100_000 - 3
    assert "reported_stock" not in (listing.extra or {})
