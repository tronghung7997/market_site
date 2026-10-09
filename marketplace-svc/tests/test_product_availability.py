"""Availability of made-to-order (manual) packages vs instant stock — one rule
(src/products/availability.py) across the storefront, checkout, the seller's
product table and dashboard, and the admin product list."""
import pytest
from sqlalchemy import update

from src.database import SessionLocal
from src.models.provider import Provider
from src.orders.constants import MAX_ORDER_QUANTITY
from src.products.availability import (
    product_availability,
    seller_stock_state,
    variant_max_quantity,
    variant_stock_state,
)
from tests.conftest import make_admin, make_seller, register_and_login


# ── pure rules ────────────────────────────────────────────────────────────────

@pytest.mark.no_db
def test_variant_states():
    assert variant_stock_state("manual", 0) == "manual"
    assert variant_stock_state("manual", 0, source_paused=True) == "manual"
    assert variant_stock_state("instant", 0) == "out"
    assert variant_stock_state("instant", 0, source_paused=True) == "paused"
    assert variant_stock_state("instant", 10) == "low"
    assert variant_stock_state("instant", 11) == "in_stock"


@pytest.mark.no_db
def test_variant_max_quantity():
    assert variant_max_quantity("manual", 0, None) == MAX_ORDER_QUANTITY
    assert variant_max_quantity("manual", 0, 50) == 50
    assert variant_max_quantity("in_stock", 30, 10) == 10
    assert variant_max_quantity("low", 3, None) == 3
    assert variant_max_quantity("out", 0, 50) == 0
    assert variant_max_quantity("paused", 0, None) == 0


@pytest.mark.no_db
def test_product_rollup():
    assert product_availability(["out", "manual"], inventory_managed=True) == "manual"
    assert product_availability(["out", "low", "manual"], inventory_managed=True) == "low"
    assert product_availability(["out", "paused"], inventory_managed=True) == "paused"
    assert product_availability(["out"], inventory_managed=True) == "out"
    assert product_availability([], inventory_managed=True) == "out"
    assert product_availability([], inventory_managed=False) == "auto"
    assert product_availability([], inventory_managed=False, provider_active=False) == "paused"
    assert seller_stock_state(managed=True, stock=0, has_manual=True, low_threshold=20) == "manual"
    assert seller_stock_state(managed=True, stock=0, has_manual=False, low_threshold=20) == "out"
    assert seller_stock_state(managed=True, stock=5, has_manual=True, low_threshold=20) == "low"
    assert seller_stock_state(managed=False, stock=0, has_manual=False, low_threshold=20) == "not_managed"


# ── end to end ────────────────────────────────────────────────────────────────

def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _setup(client):
    """Mirrors the demo "Twitter cổ 2020" product: two instant packages with
    no sellable stock plus a made-to-order bulk package, and a second product
    with an empty instant package only."""
    await register_and_login(client, "av_admin@example.com")
    await make_admin("av_admin@example.com")
    admin = await register_and_login(client, "av_admin@example.com")
    cat = (await client.post("/admin/categories", json={"name": "AvCat", "slug": "avcat"}, headers=_h(admin))).json()
    await register_and_login(client, "av_seller@example.com")
    await make_seller("av_seller@example.com")
    seller = await register_and_login(client, "av_seller@example.com")

    mixed = (await client.post("/seller/products", json={
        "category_id": cat["id"], "title": "Twitter cổ 2020", "status": "active",
    }, headers=_h(seller))).json()
    ids = {}
    for body in (
        {"name": "Email + cookies", "price": 25000, "delivery_mode": "instant"},
        {"name": "Full 2FA + email", "price": 59000, "delivery_mode": "instant"},
        {"name": "Đặt sỉ theo yêu cầu (50+)", "price": 290000, "delivery_mode": "manual",
         "sla_hours": 24, "max_per_order": 50},
    ):
        resp = await client.post(f"/seller/products/{mixed['id']}/variants", json=body, headers=_h(seller))
        assert resp.status_code == 201, resp.text
        ids[body["name"]] = resp.json()["id"]

    empty = (await client.post("/seller/products", json={
        "category_id": cat["id"], "title": "Chỉ giao ngay", "status": "active",
    }, headers=_h(seller))).json()
    resp = await client.post(f"/seller/products/{empty['id']}/variants", json={
        "name": "Gói A", "price": 10000, "delivery_mode": "instant",
    }, headers=_h(seller))
    ids["empty"] = resp.json()["id"]

    await client.post("/auth/register", json={"email": "av_buyer@example.com", "password": "StrongPass123!"})
    buyer = await register_and_login(client, "av_buyer@example.com")
    buyer_id = (await client.get("/me", headers=_h(buyer))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": buyer_id, "amount": 1_000_000},
                      headers=_h(admin))
    return {"admin": admin, "seller": seller, "buyer": buyer, "cat": cat["id"],
            "mixed": mixed, "empty": empty, "ids": ids}


@pytest.mark.asyncio
async def test_storefront_never_shows_made_to_order_as_out_of_stock(client):
    ctx = await _setup(client)
    detail = (await client.get(ctx["mixed"]["canonical_path"])).json()
    states = {v["name"]: v["stock_state"] for v in detail["variants"]}
    assert states == {"Email + cookies": "out", "Full 2FA + email": "out", "Đặt sỉ theo yêu cầu (50+)": "manual"}
    bulk = next(v for v in detail["variants"] if v["delivery_mode"] == "manual")
    assert bulk["max_quantity"] == 50 and "stock_count" not in bulk
    assert detail["availability"] == "manual"

    listed = {p["id"]: p for p in (await client.get(f"/products?category_id={ctx['cat']}")).json()["items"]}
    assert listed[ctx["mixed"]["id"]]["availability"] == "manual"
    assert listed[ctx["empty"]["id"]]["availability"] == "out"

    # "Còn hàng" keeps the made-to-order product and drops the dry one.
    in_stock = (await client.get(f"/products?category_id={ctx['cat']}&in_stock=true")).json()["items"]
    assert [p["id"] for p in in_stock] == [ctx["mixed"]["id"]]

    # The "from" price is the cheapest package a buyer can order (290k), not
    # the sold-out 25k one; a product with nothing orderable keeps its price.
    above = (await client.get(f"/products?category_id={ctx['cat']}&min_price=100000")).json()["items"]
    assert [p["id"] for p in above] == [ctx["mixed"]["id"]]
    below = (await client.get(f"/products?category_id={ctx['cat']}&max_price=20000")).json()["items"]
    assert [p["id"] for p in below] == [ctx["empty"]["id"]]


@pytest.mark.asyncio
async def test_checkout_takes_made_to_order_within_bounds_and_blocks_dry_stock(client):
    ctx = await _setup(client)
    bulk, dry = ctx["ids"]["Đặt sỉ theo yêu cầu (50+)"], ctx["ids"]["Email + cookies"]

    resp = await client.post("/orders", json={"variant_id": bulk, "quantity": 3}, headers=_h(ctx["buyer"]))
    assert resp.status_code in (200, 201), resp.text
    assert resp.json()["status"] == "pending"

    over = await client.post("/orders", json={"variant_id": bulk, "quantity": 51}, headers=_h(ctx["buyer"]))
    assert over.status_code == 400

    sold_out = await client.post("/orders", json={"variant_id": dry, "quantity": 1}, headers=_h(ctx["buyer"]))
    assert sold_out.status_code == 409 and sold_out.json()["error_code"] == "RESOURCE_UNAVAILABLE"

    anonymous = await client.post("/orders", json={"variant_id": bulk, "quantity": 1})
    assert anonymous.status_code == 401


@pytest.mark.asyncio
async def test_seller_and_admin_views_label_made_to_order_not_out_of_stock(client):
    ctx = await _setup(client)
    bulk = ctx["ids"]["Đặt sỉ theo yêu cầu (50+)"]
    resp = await client.post("/orders", json={"variant_id": bulk, "quantity": 2}, headers=_h(ctx["buyer"]))
    assert resp.status_code in (200, 201), resp.text

    page = (await client.get("/seller/products", headers=_h(ctx["seller"]))).json()
    rows = {p["id"]: p for p in page["items"]}
    mixed, empty = rows[ctx["mixed"]["id"]], rows[ctx["empty"]["id"]]
    assert mixed["stock_state"] == "manual" and mixed["manual_variant_count"] == 1
    assert mixed["awaiting_delivery"] == 1
    assert empty["stock_state"] == "out" and empty["awaiting_delivery"] == 0
    assert page["counts"]["out_of_stock"] == 1
    out_tab = (await client.get("/seller/products?status=out_of_stock", headers=_h(ctx["seller"]))).json()
    assert [p["id"] for p in out_tab["items"]] == [ctx["empty"]["id"]]

    dashboard = (await client.get("/seller/dashboard", params={"range": "30d"}, headers=_h(ctx["seller"]))).json()
    assert dashboard["inventory"]["out_of_stock"] == 1 and dashboard["inventory"]["made_to_order"] == 1
    top = {p["public_key"]: p for p in dashboard["top_products"]}
    assert top[ctx["mixed"]["public_key"]]["stock_state"] == "manual"

    admin_rows = {p["id"]: p for p in (await client.get("/admin/products", headers=_h(ctx["admin"]))).json()["items"]}
    assert admin_rows[ctx["mixed"]["id"]]["stock_state"] == "manual"
    assert admin_rows[ctx["empty"]["id"]]["stock_state"] == "out"

    # Seller and admin views stay behind their roles.
    assert (await client.get("/seller/products", headers=_h(ctx["buyer"]))).status_code == 403
    assert (await client.get("/admin/products", headers=_h(ctx["seller"]))).status_code == 403
    assert (await client.get("/seller/products")).status_code == 401


@pytest.mark.asyncio
async def test_paused_provider_product_reads_paused(client):
    ctx = await _setup(client)
    async with SessionLocal() as db:
        provider = Provider(name="Paused source", type="proxy", config={}, priority=1, is_active=False,
                            adapter_type="mock")
        db.add(provider)
        await db.flush()
        provider_id = provider.id
        await db.commit()
    proxy = (await client.post("/seller/products", json={
        "category_id": ctx["cat"], "title": "Proxy theo cấu hình", "status": "active",
    }, headers=_h(ctx["seller"]))).json()
    resp = await client.put(f"/admin/products/{proxy['id']}/operations", json={
        "provider_id": provider_id, "pricing_strategy": "config",
        "pricing_params": {"base_price": 10000},
    }, headers=_h(ctx["admin"]))
    assert resp.status_code == 200, resp.text
    listed = {p["id"]: p for p in (await client.get(f"/products?category_id={ctx['cat']}")).json()["items"]}
    assert listed[proxy["id"]]["availability"] == "paused"
    in_stock = (await client.get(f"/products?category_id={ctx['cat']}&in_stock=true")).json()["items"]
    assert proxy["id"] not in [p["id"] for p in in_stock]

    async with SessionLocal() as db:
        await db.execute(update(Provider).where(Provider.id == provider_id).values(is_active=True))
        await db.commit()
    listed = {p["id"]: p for p in (await client.get(f"/products?category_id={ctx['cat']}")).json()["items"]}
    assert listed[proxy["id"]]["availability"] == "auto"


@pytest.mark.no_db
def test_seller_limit_on_made_to_order():
    assert variant_stock_state("manual", 0, manual_stock=None) == "manual"
    assert variant_stock_state("manual", 0, manual_stock=4) == "manual"
    assert variant_stock_state("manual", 0, manual_stock=0) == "out"
    assert variant_max_quantity("manual", 0, None, manual_stock=4) == 4
    assert variant_max_quantity("manual", 0, 2, manual_stock=4) == 2
    assert seller_stock_state(managed=True, stock=0, has_manual=False, low_threshold=20, unlimited=True) == "manual"
    assert seller_stock_state(managed=True, stock=3, has_manual=True, low_threshold=20) == "low"


@pytest.mark.asyncio
async def test_used_up_seller_limit_reads_out_everywhere(client):
    ctx = await _setup(client)
    bulk = ctx["ids"]["Đặt sỉ theo yêu cầu (50+)"]
    resp = await client.patch(f"/seller/variants/{bulk}", json={"manual_stock": 2}, headers=_h(ctx["seller"]))
    assert resp.status_code == 200, resp.text
    detail = (await client.get(ctx["mixed"]["canonical_path"])).json()
    package = next(v for v in detail["variants"] if v["id"] == bulk)
    assert package["stock_state"] == "manual" and package["stock_count"] == 2 and package["max_quantity"] == 2
    assert detail["availability"] == "manual"

    order = await client.post("/orders", json={"variant_id": bulk, "quantity": 2}, headers=_h(ctx["buyer"]))
    assert order.status_code == 201, order.text

    detail = (await client.get(ctx["mixed"]["canonical_path"])).json()
    package = next(v for v in detail["variants"] if v["id"] == bulk)
    assert package["stock_state"] == "out" and package["max_quantity"] == 0
    assert detail["availability"] == "out"
    in_stock = (await client.get(f"/products?category_id={ctx['cat']}&in_stock=true")).json()["items"]
    assert ctx["mixed"]["id"] not in [p["id"] for p in in_stock]
    refused = await client.post("/orders", json={"variant_id": bulk, "quantity": 1}, headers=_h(ctx["buyer"]))
    assert refused.status_code == 409 and refused.json()["error_code"] == "RESOURCE_UNAVAILABLE"

    rows = {p["id"]: p for p in (await client.get("/seller/products", headers=_h(ctx["seller"]))).json()["items"]}
    assert rows[ctx["mixed"]["id"]]["stock_state"] == "out"
    admin_rows = {p["id"]: p for p in (await client.get("/admin/products", headers=_h(ctx["admin"]))).json()["items"]}
    assert admin_rows[ctx["mixed"]["id"]]["stock_state"] == "out"
