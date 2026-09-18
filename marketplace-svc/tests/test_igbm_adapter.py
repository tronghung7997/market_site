"""IgbmAdapter + CatalogSupplierAdapter — contract igbm.net probe thật 2026-09-17
(docs/superpowers/specs/2026-09-17-igbm-reseller-research.md).

Unit: wire format chạy qua scripts/mock_igbm.py bằng ASGITransport (không
mở socket). Integration: luồng đặt hàng `fixed` rẽ sang adapter, tồn kho
storefront từ supplier_listings, hết hàng/hết tiền/timeout, job đồng bộ.
"""
import importlib
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select, update

import src.adapters.igbm as igbm_module
from src.adapters.igbm import (
    IgbmAdapter,
    classify_error,
    flatten_catalog,
    parse_listing,
    validate_igbm_config,
)
from src.adapters.supplier import (
    PURCHASE_AUTH,
    PURCHASE_INVALID,
    PURCHASE_INVALID_SKU,
    PURCHASE_OUT_OF_CREDIT,
    PURCHASE_OUT_OF_STOCK,
    PURCHASE_UNKNOWN,
    SupplierAuthError,
    SupplierUnavailableError,
)
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.order import Order, OrderStatus
from src.models.product import Product
from src.models.provider import Provider
from src.models.resource import Resource, ResourceStatus
from src.models.supplier_listing import SupplierListing
from src.security.crypto import encrypt_config, encrypt_str
from src.suppliers.service import sync_provider_listings
from tests.conftest import make_admin, make_seller, register_and_login

MOCK_KEY = "mock-igbm-key"


def _fresh_mock():
    """Module mock mới cho mỗi test — state (số dư, tồn) không rò giữa test."""
    import scripts.mock_igbm as mock_module

    return importlib.reload(mock_module)


@pytest.fixture
def mock_igbm(monkeypatch):
    mock = _fresh_mock()
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real_client(*args, transport=httpx.ASGITransport(app=mock.app), **kwargs)

    # Adapter gọi httpx.AsyncClient(...) rồi request URL tuyệt đối — ASGI
    # transport bỏ qua host nên base_url bất kỳ đều đi vào mock.
    monkeypatch.setattr(igbm_module.httpx, "AsyncClient", client_factory)
    return mock


def _adapter(**extra) -> IgbmAdapter:
    config = {"base_url": "http://igbm.test", "api_key": encrypt_str(MOCK_KEY), **extra}
    return IgbmAdapter(config, db=AsyncMock(), provider_id=None)


# ----------------------------------------------------------------------
# Thuần hàm
# ----------------------------------------------------------------------

@pytest.mark.no_db
@pytest.mark.parametrize("msg,kind", [
    ("Số dư không đủ, vui lòng nạp thêm", PURCHASE_OUT_OF_CREDIT),
    ("So du khong du", PURCHASE_OUT_OF_CREDIT),
    ("Số lượng còn lại trong hệ thống không đủ", PURCHASE_OUT_OF_STOCK),
    ("Vui lòng đăng nhập", PURCHASE_AUTH),
    ("API Key không hợp lệ", PURCHASE_AUTH),
    ("Sản phẩm không tồn tại trong hệ thống", PURCHASE_INVALID_SKU),
    ("ID sản phẩm không hợp lệ!", PURCHASE_INVALID_SKU),
    ("Số lượng không hợp lệ!", PURCHASE_INVALID),
    ("Request does not exist", PURCHASE_UNKNOWN),
    (None, PURCHASE_UNKNOWN),
])
def test_classify_error_matches_real_messages(msg, kind):
    assert classify_error(msg) == kind


@pytest.mark.no_db
def test_parse_listing_coerces_strings_and_drops_junk_description():
    up = parse_listing({"id": "137151", "name": " H4. Clone ", "price": "9800", "amount": 211,
                        "description": "/", "min": "1", "max": "1000000"})
    assert (up.external_id, up.name, up.cost_price, up.amount) == ("137151", "H4. Clone", 9800, 211)
    assert up.max_qty is None and up.min_qty == 1 and up.format_hint is None
    up2 = parse_listing({"id": 5, "name": "x", "price": 100, "amount": -3, "description": "uid|pass|2fa",
                         "min": 2, "max": 50})
    assert up2.amount == 0 and up2.min_qty == 2 and up2.max_qty == 50 and up2.format_hint == "uid|pass|2fa"
    assert parse_listing({"name": "no id"}) is None


@pytest.mark.no_db
def test_flatten_catalog_builds_category_path():
    body = {"categories": [
        {"id": "13", "parent_id": 0, "name": "Facebook", "products": []},
        {"id": "99", "parent_id": 13, "name": "Clone VN", "products": [
            {"id": "1", "name": "A", "price": "10", "amount": "5", "min": "1", "max": "1000000"},
        ]},
    ]}
    rows = flatten_catalog(body)
    assert len(rows) == 1
    assert rows[0].category_path == ("Facebook", "Clone VN")


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_validate_igbm_config_rejects_bad_values():
    from fastapi import HTTPException

    await validate_igbm_config({"base_url": "https://igbm.net", "api_key": "k"})
    for bad in (
        {"base_url": "igbm.net", "api_key": "k"},
        {"base_url": "https://igbm.net"},
        {"base_url": "https://igbm.net", "api_key": "k", "timeout_seconds": "abc"},
        {"base_url": "https://igbm.net", "api_key": "k", "low_balance_vnd": -1},
    ):
        with pytest.raises(HTTPException):
            await validate_igbm_config(bad)


# ----------------------------------------------------------------------
# Wire format qua mock
# ----------------------------------------------------------------------

@pytest.mark.no_db
@pytest.mark.asyncio
async def test_wire_balance_listing_catalog(mock_igbm):
    a = _adapter()
    assert await a.fetch_balance() == Decimal("10000.00")
    up = await a.fetch_listing("145883")
    assert up.cost_price == 2800 and up.amount == 5026 and up.format_hint == "UID | Pass | 2FA |Mail"
    assert await a.fetch_listing("999999999") is None
    catalog = await a.fetch_catalog()
    assert {u.external_id for u in catalog} >= {"145883", "32749", "133947"}
    assert next(u for u in catalog if u.external_id == "145883").category_path[0] == "Facebook"


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_wire_purchase_success_and_order_lookup(mock_igbm):
    a = _adapter()
    out = await a.purchase("145883", 2, order_id=1)
    assert out.ok and len(out.items) == 2 and out.trans_id
    assert await a.fetch_order(out.trans_id) == out.items
    assert await a.fetch_order("nope") is None
    assert await a.fetch_balance() == Decimal("4400.00")


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_wire_purchase_error_kinds(mock_igbm):
    a = _adapter()
    assert (await a.purchase("133947", 1, order_id=1)).error_kind == PURCHASE_OUT_OF_STOCK
    assert (await a.purchase("999999999", 1, order_id=1)).error_kind == PURCHASE_INVALID_SKU
    assert (await a.purchase("145883", 0, order_id=1)).error_kind == PURCHASE_INVALID
    mock_igbm.STATE["balance"] = Decimal("100")
    assert (await a.purchase("145883", 1, order_id=1)).error_kind == PURCHASE_OUT_OF_CREDIT
    bad = _adapter(api_key=encrypt_str("wrong"))
    assert (await bad.purchase("145883", 1, order_id=1)).error_kind == PURCHASE_AUTH
    with pytest.raises(SupplierAuthError):
        await bad.fetch_balance()
    assert (await bad.check_health())["status"] == "unhealthy"


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_wire_5xx_is_ambiguous_not_a_result(mock_igbm):
    a = _adapter()
    mock_igbm.STATE["fail_mode"] = "http500"
    with pytest.raises(SupplierUnavailableError):
        await a.purchase("145883", 1, order_id=1)


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_health_warns_on_low_balance(mock_igbm):
    a = _adapter(low_balance_vnd=50000)
    h = await a.check_health()
    assert h["status"] == "warning" and h["balance_vnd"] == 10000
    assert (await _adapter(low_balance_vnd=1000).check_health())["status"] == "healthy"


# ----------------------------------------------------------------------
# Integration — đặt hàng qua API
# ----------------------------------------------------------------------

async def _setup(client, *, sell_price=4000, sku="145883", upstream_amount=5026, cost=2800):
    admin_token = await register_and_login(client, "ig_admin@example.com")
    await make_admin("ig_admin@example.com")
    admin_token = await register_and_login(client, "ig_admin@example.com")
    await client.post("/admin/categories", json={"name": "IgCat", "slug": "igcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cat_id = (await client.get("/categories")).json()[-1]["id"]

    seller_token = await register_and_login(client, "ig_seller@example.com")
    await make_seller("ig_seller@example.com")
    seller_token = await register_and_login(client, "ig_seller@example.com")
    product = (await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Clone FB ngoại", "status": "active",
        "escrow_days": 2, "service_type": "account", "pricing_strategy": "fixed",
    }, headers={"Authorization": f"Bearer {seller_token}"})).json()
    variant = (await client.post(f"/seller/products/{product['id']}/variants", json={
        "name": "Gói 1", "price": sell_price, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})).json()

    async with SessionLocal() as db:
        provider = Provider(
            name="Acc Station", type="account", adapter_type="igbm", priority=1,
            config=encrypt_config({"base_url": "http://igbm.test", "api_key": MOCK_KEY}),
            is_active=True, review_status="approved",
        )
        db.add(provider)
        await db.flush()
        await db.execute(update(Product).where(Product.id == product["id"]).values(
            provider_id=provider.id, pricing_strategy="fixed",
        ))
        db.add(SupplierListing(
            provider_id=provider.id, variant_id=variant["id"], external_product_id=sku,
            external_name="H30. Clone Ngoại", cost_price=cost, upstream_amount=upstream_amount,
        ))
        await db.commit()
        provider_id = provider.id

    buyer_token = await register_and_login(client, "ig_buyer@example.com")
    buyer_id = (await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test topup", "account_id": buyer_id, "amount": 100000},
                      headers={"Authorization": f"Bearer {admin_token}"})
    return {
        "buyer": buyer_token, "seller": seller_token, "admin": admin_token,
        "product": product, "variant": variant, "provider_id": provider_id, "buyer_id": buyer_id,
    }


async def _wallet(client, token) -> int:
    return (await client.get("/wallet", headers={"Authorization": f"Bearer {token}"})).json()["balance"]


@pytest.mark.asyncio
async def test_storefront_stock_comes_from_supplier_listing(client, mock_igbm):
    ctx = await _setup(client, upstream_amount=7)
    detail = (await client.get(f"/products/{ctx['product']['id']}")).json()
    v = detail["variants"][0]
    assert v["stock_state"] == "low" and v["max_quantity"] == 7

    listing = (await client.get("/products?in_stock=true")).json()
    items = listing["items"] if isinstance(listing, dict) else listing
    assert any(p["id"] == ctx["product"]["id"] for p in items)

    # Seller inventory thấy số tồn thật (không bucket) từ listing.
    own = (await client.get(f"/seller/products/{ctx['product']['id']}/detail",
                            headers={"Authorization": f"Bearer {ctx['seller']}"})).json()
    assert own["variants"][0]["stock_count"] == 7


@pytest.mark.asyncio
async def test_fixed_order_routes_to_adapter_and_delivers(client, mock_igbm, monkeypatch):
    from src.orders.service import provision_pending_order

    ctx = await _setup(client)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    before = await _wallet(client, ctx["buyer"])

    resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 2},
                             headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["status"] == "pending" and data["delivered_data"] is None
    assert await _wallet(client, ctx["buyer"]) == before - 8000

    await provision_pending_order(data["id"])

    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order.status == OrderStatus.delivered
        assert order.variant_id == ctx["variant"]["id"]
        assert order.provider_id == ctx["provider_id"]
        lines = order.delivered_data.split("\n")
        assert len(lines) == 2 and all("|" in line for line in lines)
        resources = list((await db.execute(
            select(Resource).where(Resource.order_id == order.id).order_by(Resource.id)
        )).scalars())
        assert [r.data for r in resources] == lines
        assert all(r.status == ResourceStatus.assigned for r in resources)
        assert sum(r.refund_amount_cap for r in resources) == 8000
        listing = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == order.variant_id))
        # precheck cập nhật cache từ product.php (5026) rồi provision trừ 2
        assert listing.upstream_amount == 5024
    # Mock đã trừ đúng giá vốn 2 × 2800.
    assert mock_igbm.STATE["balance"] == Decimal("4400.00")

    # Chạy lại provision cho đơn đã giao KHÔNG mua thêm.
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == data["id"]).values(status=OrderStatus.pending))
        await db.commit()
    await provision_pending_order(data["id"])
    assert mock_igbm.STATE["balance"] == Decimal("4400.00")
    async with SessionLocal() as db:
        order = await db.get(Order, data["id"])
        assert order.status == OrderStatus.delivered and order.delivered_data == "\n".join(lines)


@pytest.mark.asyncio
async def test_precheck_rejects_out_of_stock_before_charging(client, mock_igbm):
    ctx = await _setup(client, sku="133947", upstream_amount=50)  # cache nói còn 50, thật là 0
    before = await _wallet(client, ctx["buyer"])
    resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 1},
                             headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert resp.status_code == 409, resp.text
    assert resp.json()["error_code"] == "RESOURCE_UNAVAILABLE"
    assert await _wallet(client, ctx["buyer"]) == before
    async with SessionLocal() as db:
        assert await db.scalar(select(Order)) is None


@pytest.mark.asyncio
async def test_precheck_blocks_when_upstream_price_kills_margin(client, mock_igbm):
    # Bán 2.900 khi vốn thật 2.800 → margin 3.5% < 10% mặc định.
    ctx = await _setup(client, sell_price=2900, cost=1000)
    resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 1},
                             headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert resp.status_code == 409 and resp.json()["error_code"] == "PRODUCT_UNAVAILABLE"
    async with SessionLocal() as db:
        alert = await db.scalar(select(Alert).where(Alert.type == "supplier_low_margin"))
        assert alert is not None and alert.target_id == ctx["variant"]["id"]


@pytest.mark.asyncio
async def test_out_of_credit_refunds_and_disables_provider(client, mock_igbm, monkeypatch):
    from src.orders.service import provision_pending_order

    ctx = await _setup(client)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    before = await _wallet(client, ctx["buyer"])
    resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 1},
                             headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert resp.status_code == 201
    mock_igbm.STATE["balance"] = Decimal("100")  # hết tiền giữa lúc precheck và mua

    await provision_pending_order(resp.json()["id"])

    async with SessionLocal() as db:
        order = await db.get(Order, resp.json()["id"])
        assert order.status == OrderStatus.cancelled
        assert "hoàn" in (order.cancel_reason or "").lower()
        assert "igbm" not in (order.cancel_reason or "").lower()
        provider = await db.get(Provider, ctx["provider_id"])
        assert provider.is_active is False
        assert await db.scalar(select(Alert).where(Alert.type == "provider_out_of_credit")) is not None
    assert await _wallet(client, ctx["buyer"]) == before


@pytest.mark.asyncio
async def test_ambiguous_purchase_reconciles_by_balance_and_alerts(client, mock_igbm, monkeypatch):
    from src.orders.service import provision_pending_order

    ctx = await _setup(client)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)
    before = await _wallet(client, ctx["buyer"])
    resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 1},
                             headers={"Authorization": f"Bearer {ctx['buyer']}"})
    # Mock trừ tiền rồi trả 500 — đúng ca "tiền đã đi, response mất".
    mock_igbm.STATE["fail_mode"] = "http500"

    await provision_pending_order(resp.json()["id"])

    async with SessionLocal() as db:
        order = await db.get(Order, resp.json()["id"])
        assert order.status == OrderStatus.cancelled
        alert = await db.scalar(select(Alert).where(Alert.type == "provision_operational"))
        assert alert is not None and alert.severity == "critical"
        assert "ĐỐI SOÁT" in alert.message
        provider = await db.get(Provider, ctx["provider_id"])
        assert provider.is_active is True  # không phải hết tiền, đừng tắt
    assert await _wallet(client, ctx["buyer"]) == before
    assert mock_igbm.STATE["balance"] == Decimal("7200.00")


@pytest.mark.asyncio
async def test_sync_updates_cache_and_flags_delisted_and_low_margin(client, mock_igbm):
    ctx = await _setup(client, sell_price=4000, cost=1000, upstream_amount=1)

    # Gói 2 trỏ SKU đã bị gỡ.
    v2 = (await client.post(f"/seller/products/{ctx['product']['id']}/variants", json={
        "name": "Gói 2", "price": 5000, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {ctx['seller']}"})).json()
    async with SessionLocal() as db:
        db.add(SupplierListing(provider_id=ctx["provider_id"], variant_id=v2["id"],
                               external_product_id="424242", cost_price=1, upstream_amount=9))
        await db.commit()

    async with SessionLocal() as db:
        provider = await db.get(Provider, ctx["provider_id"])
        report = await sync_provider_listings(provider, db)
        await db.commit()
    assert (report.updated, report.delisted, report.low_margin) == (1, 1, 0)

    async with SessionLocal() as db:
        l1 = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == ctx["variant"]["id"]))
        assert l1.cost_price == 2800 and l1.upstream_amount == 5026 and l1.sync_error is None
        assert l1.extra["category_path"][0] == "Facebook"
        l2 = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == v2["id"]))
        assert l2.sync_error == "delisted" and l2.upstream_amount == 0
        assert await db.scalar(select(Alert).where(Alert.type == "supplier_sku_delisted")) is not None

    detail = (await client.get(f"/products/{ctx['product']['id']}")).json()
    by_id = {v["id"]: v for v in detail["variants"]}
    assert by_id[ctx["variant"]["id"]]["stock_state"] == "in_stock"
    assert by_id[v2["id"]]["stock_state"] == "out"

    # Hạ giá bán xuống 3.000 vs vốn 2.800 = 7% < 10% → lần sync sau cảnh báo margin.
    async with SessionLocal() as db:
        from src.models.product import ProductVariant

        await db.execute(update(ProductVariant).where(ProductVariant.id == ctx["variant"]["id"]).values(price=3000))
        await db.commit()
    async with SessionLocal() as db:
        provider = await db.get(Provider, ctx["provider_id"])
        report = await sync_provider_listings(provider, db)
        await db.commit()
        assert report.low_margin == 1
        assert await db.scalar(select(Alert).where(Alert.type == "supplier_low_margin")) is not None


@pytest.mark.asyncio
async def test_precheck_sees_empty_upstream_balance_and_disables_provider(client, mock_igbm):
    ctx = await _setup(client)
    mock_igbm.STATE["balance"] = Decimal("100")
    before = await _wallet(client, ctx["buyer"])
    resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 1},
                             headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert resp.status_code == 409 and resp.json()["error_code"] == "RESOURCE_UNAVAILABLE"
    assert await _wallet(client, ctx["buyer"]) == before
    async with SessionLocal() as db:
        assert await db.scalar(select(Order)) is None
        provider = await db.get(Provider, ctx["provider_id"])
        assert provider.is_active is False
        alert = await db.scalar(select(Alert).where(Alert.type == "provider_out_of_credit"))
        assert alert is not None and "topproxy" not in alert.message
    # Provider đã tắt → lần mua sau bị chặn ngay ở get_adapter, không hỏi nguồn nữa.
    resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 1},
                             headers={"Authorization": f"Bearer {ctx['buyer']}"})
    assert resp.status_code == 400 and resp.json()["error_code"] == "PROVIDER_NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_admin_sync_catalog_endpoint(client, mock_igbm):
    ctx = await _setup(client, upstream_amount=1, cost=1)
    resp = await client.post(f"/admin/providers/{ctx['provider_id']}/sync-catalog",
                             headers={"Authorization": f"Bearer {ctx['admin']}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["updated"] == 1 and resp.json()["error"] is None
    async with SessionLocal() as db:
        listing = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == ctx["variant"]["id"]))
        assert listing.cost_price == 2800 and listing.upstream_amount == 5026
    # Provider không phải catalog → 400.
    async with SessionLocal() as db:
        await db.execute(update(Provider).where(Provider.id == ctx["provider_id"]).values(adapter_type="mock"))
        await db.commit()
    resp = await client.post(f"/admin/providers/{ctx['provider_id']}/sync-catalog",
                             headers={"Authorization": f"Bearer {ctx['admin']}"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_three_consecutive_purchase_failures_auto_pause_variant(client, mock_igbm, monkeypatch):
    """Cầu dao theo gói: 3 đơn mua lỗi liên tiếp (SKU hết hàng phía nhà cung
    cấp, precheck bị bỏ qua để tới được adapter) → gói tự tắt + cảnh báo;
    seller bật lại → streak về 0."""
    from src.orders.service import provision_pending_order
    from src.models.product import ProductVariant
    from src.models.supplier_listing import SupplierListing

    ctx = await _setup(client, sku="133947", upstream_amount=50)
    monkeypatch.setattr("src.orders.service.spawn_provision", lambda _id: None)

    async def _no_precheck(*_a, **_k):
        return None
    monkeypatch.setattr("src.orders.service.precheck_external_purchase", _no_precheck)

    for i in range(3):
        # Gói còn active cho tới lần lỗi thứ 3 (tồn cache bị adapter set 0 sau
        # lần 1 nên đặt lại để đơn tạo được).
        async with SessionLocal() as db:
            lst = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == ctx["variant"]["id"]))
            lst.upstream_amount = 50
            await db.commit()
        resp = await client.post("/orders", json={"variant_id": ctx["variant"]["id"], "quantity": 1},
                                 headers={"Authorization": f"Bearer {ctx['buyer']}"})
        assert resp.status_code == 201, (i, resp.text)
        await provision_pending_order(resp.json()["id"])
        async with SessionLocal() as db:
            lst = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == ctx["variant"]["id"]))
            variant = await db.get(ProductVariant, ctx["variant"]["id"])
            assert lst.fail_streak == i + 1
            assert variant.is_active is (i < 2)
            assert (lst.auto_paused_at is not None) is (i == 2)

    async with SessionLocal() as db:
        alert = await db.scalar(select(Alert).where(Alert.type == "supplier_auto_paused"))
        assert alert is not None and "TỰ TẮT" in alert.message and alert.severity == "warning"
        provider = await db.get(Provider, ctx["provider_id"])
        assert provider.is_active is True  # lỗi cấp gói, không tắt provider

    # Nguồn báo "cần xử lý"; seller bật lại gói → streak reset.
    rows = (await client.get("/admin/sources", headers={"Authorization": f"Bearer {ctx['admin']}"})).json()
    src = next(r for r in rows if r["id"] == ctx["provider_id"])
    assert src["listing_auto_paused_count"] == 1 and src["attention_count"] >= 1
    listings = (await client.get(f"/admin/sources/{ctx['provider_id']}/listings",
                                 headers={"Authorization": f"Bearer {ctx['admin']}"})).json()
    row = listings[0]
    assert row["fail_streak"] == 3 and row["auto_paused_at"] and "hết hàng" in row["last_fail_reason"]
    resp = await client.patch(f"/admin/sources/listings/{row['listing_id']}", json={"is_active": True},
                              headers={"Authorization": f"Bearer {ctx['admin']}"})
    assert resp.status_code == 200
    assert resp.json()["fail_streak"] == 0 and resp.json()["auto_paused_at"] is None and resp.json()["variant_active"]
