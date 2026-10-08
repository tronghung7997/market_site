"""Seller-set availability of made-to-order ("theo yêu cầu") packages.

`manual_stock` is how many units the package still takes on (None = no limit):
orders take from it atomically, a sold-out package refuses orders before any
money moves, and only an order cancelled before delivery gives units back.
"""
import pytest
from sqlalchemy.orm import undefer

from src.database import SessionLocal
from src.models.order import Order, OrderStatus
from src.models.product import ProductVariant
from tests.conftest import make_seller, register_and_login
from tests.test_orders import _age_order, setup_buyable_product


def _h(token):
    return {"Authorization": f"Bearer {token}"}


async def _public_variant(client, seller_token, variant_id):
    product = (await client.get("/seller/products", headers=_h(seller_token))).json()["items"][-1]
    detail = (await client.get(f"/products/{product['id']}")).json()
    return next(v for v in detail["variants"] if v["id"] == variant_id)


async def _stock(variant_id: int) -> int | None:
    async with SessionLocal() as db:
        return (await db.get(ProductVariant, variant_id)).manual_stock


async def _balance(client, buyer_token) -> int:
    return (await client.get("/wallet", headers=_h(buyer_token))).json()["available_balance"]


@pytest.mark.asyncio
async def test_seller_limit_is_shown_to_buyers_and_can_be_lifted(client):
    _, seller, _, _, manual_id = await setup_buyable_product(client)

    unlimited = await _public_variant(client, seller, manual_id)
    assert unlimited["stock_state"] == "manual" and "stock_count" not in unlimited

    set_limit = await client.patch(f"/seller/variants/{manual_id}", json={"manual_stock": 3}, headers=_h(seller))
    assert set_limit.status_code == 200, set_limit.text
    assert set_limit.json()["manual_stock"] == 3

    limited = await _public_variant(client, seller, manual_id)
    assert limited["stock_state"] == "manual"
    assert limited["stock_count"] == 3 and limited["max_quantity"] == 3
    assert "manual_stock" not in limited, "the raw setting is for the seller's editor only"

    lifted = await client.patch(f"/seller/variants/{manual_id}", json={"manual_stock": None}, headers=_h(seller))
    assert lifted.status_code == 200
    assert "manual_stock" not in lifted.json()
    assert "stock_count" not in await _public_variant(client, seller, manual_id)


@pytest.mark.asyncio
async def test_orders_take_units_and_a_sold_out_package_refuses_before_charging(client):
    buyer, seller, _, _, manual_id = await setup_buyable_product(client)
    await client.patch(f"/seller/variants/{manual_id}", json={"manual_stock": 2}, headers=_h(seller))

    too_many = await client.post("/orders/quote", json={"variant_id": manual_id, "quantity": 3}, headers=_h(buyer))
    assert too_many.status_code == 409 and too_many.json()["error_code"] == "RESOURCE_UNAVAILABLE"

    order = await client.post("/orders", json={"variant_id": manual_id, "quantity": 2}, headers=_h(buyer))
    assert order.status_code == 201, order.text
    assert await _stock(manual_id) == 0
    async with SessionLocal() as db:
        assert (await db.get(Order, order.json()["id"], options=[undefer(Order.delivered_data)])).stock_held == 2

    sold_out = await _public_variant(client, seller, manual_id)
    assert sold_out["stock_state"] == "out" and sold_out["stock_count"] == 0 and sold_out["max_quantity"] == 0

    before = await _balance(client, buyer)
    refused = await client.post("/orders", json={"variant_id": manual_id, "quantity": 1}, headers=_h(buyer))
    assert refused.status_code == 409 and refused.json()["error_code"] == "RESOURCE_UNAVAILABLE"
    assert await _balance(client, buyer) == before, "no money moves for a sold-out package"


@pytest.mark.asyncio
async def test_unlimited_package_keeps_taking_orders(client):
    buyer, _, _, _, manual_id = await setup_buyable_product(client)
    for _ in range(2):
        resp = await client.post("/orders", json={"variant_id": manual_id, "quantity": 2}, headers=_h(buyer))
        assert resp.status_code == 201
    assert await _stock(manual_id) is None


@pytest.mark.asyncio
async def test_sla_cancel_gives_held_units_back(client):
    from src.scheduler import sla_check_job

    buyer, seller, _, _, manual_id = await setup_buyable_product(client)
    await client.patch(f"/seller/variants/{manual_id}", json={"manual_stock": 5}, headers=_h(seller))
    order = (await client.post("/orders", json={"variant_id": manual_id, "quantity": 2}, headers=_h(buyer))).json()
    assert await _stock(manual_id) == 3
    await _age_order(order["id"], 25 * 3600)

    await sla_check_job()

    async with SessionLocal() as db:
        cancelled = await db.get(Order, order["id"], options=[undefer(Order.delivered_data)])
        assert cancelled.status == OrderStatus.cancelled and cancelled.stock_held == 0
    assert await _stock(manual_id) == 5
    await sla_check_job()
    assert await _stock(manual_id) == 5, "giving back is idempotent"


@pytest.mark.asyncio
async def test_admin_refund_before_delivery_gives_back_but_not_after(client):
    buyer, seller, admin, _, manual_id = await setup_buyable_product(client)
    await client.patch(f"/seller/variants/{manual_id}", json={"manual_stock": 4}, headers=_h(seller))

    pending = (await client.post("/orders", json={"variant_id": manual_id, "quantity": 1}, headers=_h(buyer))).json()
    refund = await client.post(f"/admin/orders/{pending['id']}/refund", json={"note": "khách đổi ý"}, headers=_h(admin))
    assert refund.status_code == 204, refund.text
    assert await _stock(manual_id) == 4

    delivered = (await client.post("/orders", json={"variant_id": manual_id, "quantity": 1}, headers=_h(buyer))).json()
    assert (await client.post(f"/seller/orders/{delivered['id']}/accept", headers=_h(seller))).status_code == 200
    done = await client.post(f"/seller/orders/{delivered['id']}/deliver", json={"data": "acc|pass"}, headers=_h(seller))
    assert done.status_code == 200
    async with SessionLocal() as db:
        assert (await db.get(Order, delivered["id"], options=[undefer(Order.delivered_data)])).stock_held == 0
    assert await _stock(manual_id) == 3

    late_refund = await client.post(f"/admin/orders/{delivered['id']}/refund", json={"note": "lỗi"}, headers=_h(admin))
    assert late_refund.status_code == 204
    assert await _stock(manual_id) == 3, "units the seller already delivered are used"


@pytest.mark.asyncio
async def test_limit_validation_instant_packages_and_ownership(client):
    _, seller, _, instant_id, manual_id = await setup_buyable_product(client)

    negative = await client.patch(f"/seller/variants/{manual_id}", json={"manual_stock": -1}, headers=_h(seller))
    assert negative.status_code == 422

    instant = await client.patch(f"/seller/variants/{instant_id}", json={"manual_stock": 9}, headers=_h(seller))
    assert instant.status_code == 200
    assert "manual_stock" not in instant.json(), "instant stock is its uploaded lines"
    assert await _stock(instant_id) is None

    other = await register_and_login(client, "ms_other_seller@example.com")
    await make_seller("ms_other_seller@example.com")
    other = await register_and_login(client, "ms_other_seller@example.com")
    foreign = await client.patch(f"/seller/variants/{manual_id}", json={"manual_stock": 0}, headers=_h(other))
    assert foreign.status_code == 403
    assert await _stock(manual_id) is None

    anonymous = await client.patch(f"/seller/variants/{manual_id}", json={"manual_stock": 0})
    assert anonymous.status_code == 401


@pytest.mark.asyncio
async def test_seller_console_counts_limited_packages_and_never_flags_unlimited_ones(client):
    _, seller, _, instant_id, manual_id = await setup_buyable_product(client)
    # A made-to-order-only product next to the mixed one from the fixture.
    product = (await client.get("/seller/products", headers=_h(seller))).json()["items"][-1]
    solo = await client.post("/seller/products", json={
        "category_id": product["category_id"], "title": "Solo manual", "status": "active", "escrow_days": 2,
    }, headers=_h(seller))
    solo_variant = await client.post(f"/seller/products/{solo.json()['id']}/variants", json={
        "name": "Làm theo đơn", "price": 2000, "delivery_mode": "manual",
    }, headers=_h(seller))
    solo_id = solo_variant.json()["id"]

    def counts():
        return client.get("/seller/products", headers=_h(seller))

    unlimited = (await counts()).json()
    assert unlimited["counts"]["out_of_stock"] == 0, "an unlimited made-to-order product is never out"
    # Only a made-to-order-only product is exempt; the mixed one keeps its
    # low/out flags for the instant packages' restock reminders.
    assert {item["id"]: item["stock_unlimited"] for item in unlimited["items"]} == {
        solo.json()["id"]: True, product["id"]: False,
    }

    await client.patch(f"/seller/variants/{solo_id}", json={"manual_stock": 0}, headers=_h(seller))
    sold_out = (await counts()).json()
    assert sold_out["counts"]["out_of_stock"] == 1
    out_tab = (await client.get("/seller/products?status=out_of_stock", headers=_h(seller))).json()
    assert [item["id"] for item in out_tab["items"]] == [solo.json()["id"]]

    await client.patch(f"/seller/variants/{solo_id}", json={"manual_stock": 7}, headers=_h(seller))
    rows = {item["id"]: item for item in (await counts()).json()["items"]}
    assert rows[solo.json()["id"]]["total_stock"] == 7
    assert rows[product["id"]]["total_stock"] == 3, "the mixed product keeps its 3 instant lines"
