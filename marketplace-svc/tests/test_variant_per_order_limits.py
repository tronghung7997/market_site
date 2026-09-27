"""Per-order bounds a seller sets on a package, enforced before money moves."""
import pytest

from tests.test_orders import setup_buyable_product


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _product_of(client, seller_token):
    return (await client.get("/seller/products", headers=_auth(seller_token))).json()["items"][-1]


@pytest.mark.asyncio
async def test_seller_sets_bounds_and_buyers_see_them(client):
    buyer, seller, _, instant_id, manual_id = await setup_buyable_product(client)
    updated = await client.patch(
        f"/seller/variants/{instant_id}", json={"min_per_order": 2, "max_per_order": 2}, headers=_auth(seller),
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["min_per_order"] == 2 and updated.json()["max_per_order"] == 2

    product = await _product_of(client, seller)
    detail = (await client.get(f"/products/{product['id']}")).json()
    instant = next(v for v in detail["variants"] if v["id"] == instant_id)
    assert instant["min_per_order"] == 2 and instant["max_per_order"] == 2
    # The order form cap already folds in the per-order max (3 lines in stock).
    assert instant["max_quantity"] == 2
    manual = next(v for v in detail["variants"] if v["id"] == manual_id)
    assert manual["min_per_order"] == 1 and manual["max_per_order"] is None

    wallet_before = (await client.get("/wallet", headers=_auth(buyer))).json()["available_balance"]
    too_few = await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))
    assert too_few.status_code == 400
    assert too_few.json()["error_code"] == "ORDER_QUANTITY_RANGE"
    too_many = await client.post("/orders", json={"variant_id": instant_id, "quantity": 3}, headers=_auth(buyer))
    assert too_many.status_code == 400 and too_many.json()["error_code"] == "ORDER_QUANTITY_RANGE"
    assert (await client.get("/wallet", headers=_auth(buyer))).json()["available_balance"] == wallet_before

    ok = await client.post("/orders", json={"variant_id": instant_id, "quantity": 2}, headers=_auth(buyer))
    assert ok.status_code == 201, ok.text

    # Clearing the cap keeps the minimum.
    cleared = await client.patch(f"/seller/variants/{instant_id}", json={"max_per_order": None}, headers=_auth(seller))
    assert cleared.status_code == 200 and cleared.json()["max_per_order"] is None
    assert cleared.json()["min_per_order"] == 2


@pytest.mark.asyncio
async def test_invalid_bounds_are_rejected(client):
    _, seller, _, instant_id, _ = await setup_buyable_product(client)
    product = await _product_of(client, seller)
    backwards = await client.post(
        f"/seller/products/{product['id']}/variants",
        json={"name": "Lô", "price": 1000, "min_per_order": 5, "max_per_order": 2}, headers=_auth(seller),
    )
    assert backwards.status_code == 422
    zero = await client.patch(f"/seller/variants/{instant_id}", json={"min_per_order": 0}, headers=_auth(seller))
    assert zero.status_code == 422
    # A partial update that crosses the stored max is caught too.
    await client.patch(f"/seller/variants/{instant_id}", json={"max_per_order": 3}, headers=_auth(seller))
    crossing = await client.patch(f"/seller/variants/{instant_id}", json={"min_per_order": 4}, headers=_auth(seller))
    assert crossing.status_code == 422
    assert crossing.json()["error_code"] == "VARIANT_PER_ORDER_RANGE"


@pytest.mark.asyncio
async def test_only_the_owner_sets_bounds(client):
    buyer, _, _, instant_id, _ = await setup_buyable_product(client)
    denied = await client.patch(f"/seller/variants/{instant_id}", json={"max_per_order": 1}, headers=_auth(buyer))
    assert denied.status_code == 403
