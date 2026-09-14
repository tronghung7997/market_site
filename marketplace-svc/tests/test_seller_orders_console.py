"""GET /seller/orders — paginated seller console listing."""
import pytest

from tests.conftest import make_seller, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _seed(client):
    """3 instant orders (1 completed, 1 delivered+disputed, 1 delivered) + 1 pending manual."""
    buyer_token, seller_token, admin_token, instant_vid, manual_vid = await setup_buyable_product(client)
    buyer, seller = _auth(buyer_token), _auth(seller_token)
    ids = {}
    r = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    ids["completed"] = r.json()["id"]
    assert (await client.post(f"/orders/{ids['completed']}/confirm", headers=buyer)).status_code == 200
    r = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    ids["disputed"] = r.json()["id"]
    opened = await client.post(f"/orders/{ids['disputed']}/dispute", json={"reason": "Broken"}, headers=buyer)
    assert opened.status_code in (200, 201), opened.text
    r = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    ids["delivered"] = r.json()["id"]
    r = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1}, headers=buyer)
    ids["pending"] = r.json()["id"]
    return buyer, seller, ids


@pytest.mark.asyncio
async def test_seller_orders_paginated_with_counts_and_facets(client):
    _, seller, ids = await _seed(client)
    resp = await client.get("/seller/orders", headers=seller)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 4
    assert body["page"] == 1 and body["per_page"] == 20
    assert [o["id"] for o in body["items"]] == [ids["pending"], ids["delivered"], ids["disputed"], ids["completed"]]
    assert body["counts"] == {
        "all": 4, "disputed": 1, "action_required": 1, "escrow": 1, "completed": 1, "cancelled": 0,
        "disputes_awaiting_seller": 1,
    }
    assert [p["title"] for p in body["products"]] == ["Order Test"]
    disputed = next(o for o in body["items"] if o["id"] == ids["disputed"])
    assert disputed["has_dispute"] is True
    assert disputed["dispute_awaiting_seller"] is True
    assert disputed["fulfillment"]["kind"] == "instant"
    pending = next(o for o in body["items"] if o["id"] == ids["pending"])
    assert pending["fulfillment"]["kind"] == "manual"

    page2 = await client.get("/seller/orders", params={"per_page": 3, "page": 2}, headers=seller)
    assert page2.json()["total"] == 4
    assert [o["id"] for o in page2.json()["items"]] == [ids["completed"]]


@pytest.mark.asyncio
async def test_seller_orders_tabs_filters_and_sort(client):
    _, seller, ids = await _seed(client)

    async def ids_for(**params):
        r = await client.get("/seller/orders", params=params, headers=seller)
        assert r.status_code == 200, r.text
        return [o["id"] for o in r.json()["items"]]

    assert await ids_for(tab="disputed") == [ids["disputed"]]
    assert await ids_for(tab="escrow") == [ids["delivered"]]
    assert await ids_for(tab="action_required") == [ids["pending"]]
    assert await ids_for(tab="completed") == [ids["completed"]]
    assert await ids_for(tab="cancelled") == []
    assert await ids_for(kind="manual") == [ids["pending"]]
    assert set(await ids_for(kind="instant")) == {ids["completed"], ids["disputed"], ids["delivered"]}
    assert await ids_for(search=f"#{ids['completed']}") == [ids["completed"]]
    assert await ids_for(search="Manual Var") == [ids["pending"]]
    assert len(await ids_for(search="ord_buyer@")) == 4
    assert await ids_for(search="nothing-matches") == []
    assert (await ids_for(sort="oldest"))[:1] == [ids["completed"]]
    assert (await ids_for(sort="amount_desc"))[:1] == [ids["pending"]]  # 5000 vs 1000
    assert await ids_for(date_from="2999-01-01") == []
    assert len(await ids_for(date_to="2999-01-01")) == 4

    product_id = (await client.get("/seller/orders", headers=seller)).json()["products"][0]["id"]
    assert len(await ids_for(product_id=product_id)) == 4
    assert await ids_for(product_id=999999) == []

    # Counts are store-wide, not filtered.
    r = await client.get("/seller/orders", params={"tab": "cancelled"}, headers=seller)
    assert r.json()["total"] == 0 and r.json()["counts"]["all"] == 4

    assert (await client.get("/seller/orders", params={"tab": "bogus"}, headers=seller)).status_code == 422
    assert (await client.get("/seller/orders", params={"sort": "bogus"}, headers=seller)).status_code == 422


@pytest.mark.asyncio
async def test_seller_orders_scoped_and_role_guarded(client):
    buyer, _, _ = await _seed(client)
    assert (await client.get("/seller/orders", headers=buyer)).status_code == 403
    await register_and_login(client, "console_other@example.com")
    await make_seller("console_other@example.com")
    other = await register_and_login(client, "console_other@example.com")
    body = (await client.get("/seller/orders", headers=_auth(other))).json()
    assert body["total"] == 0 and body["items"] == [] and body["products"] == []
    assert body["counts"]["all"] == 0
