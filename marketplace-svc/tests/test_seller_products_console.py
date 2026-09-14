"""Seller products console: sort, price span, draft tab, bulk status."""
import pytest

from tests.conftest import make_seller, register_and_login
from tests.test_products import setup_seller_with_category


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _product(client, headers, cat_id, title, status="active", prices=(), stock=0):
    created = await client.post("/seller/products", json={
        "category_id": cat_id, "title": title, "status": status, "escrow_days": 2,
    }, headers=headers)
    assert created.status_code == 201, created.text
    pid = created.json()["id"]
    for i, price in enumerate(prices):
        variant = await client.post(f"/seller/products/{pid}/variants", json={
            "name": f"{title} v{i}", "price": price, "delivery_mode": "instant",
        }, headers=headers)
        assert variant.status_code == 201, variant.text
        if i == 0 and stock:
            await client.post(f"/seller/variants/{variant.json()['id']}/resources", json={
                "items": [f"{title}-{n}" for n in range(stock)],
            }, headers=headers)
    return pid


@pytest.mark.asyncio
async def test_seller_products_sort_price_span_and_draft_tab(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    h = _auth(seller_token)
    cheap = await _product(client, h, cat_id, "Alpha cheap", prices=(1000, 3000), stock=2)
    pricey = await _product(client, h, cat_id, "Beta pricey", prices=(9000,), stock=30)
    empty = await _product(client, h, cat_id, "Gamma empty", prices=(5000,))
    draft = await _product(client, h, cat_id, "Delta draft", status="draft")

    body = (await client.get("/seller/products", headers=h)).json()
    assert body["counts"]["draft"] == 1
    assert body["counts"]["paused"] == 0
    assert body["counts"]["low_stock_threshold"] == 20
    assert body["counts"]["low_stock"] == 1  # cheap: 2 items
    assert body["counts"]["out_of_stock"] == 2  # empty + draft (no stock)
    by_id = {p["id"]: p for p in body["items"]}
    assert (by_id[cheap]["price_min"], by_id[cheap]["price_max"]) == (1000, 3000)
    assert (by_id[pricey]["price_min"], by_id[pricey]["price_max"]) == (9000, 9000)
    assert by_id[draft]["price_min"] is None

    async def order(**params):
        r = await client.get("/seller/products", params=params, headers=h)
        assert r.status_code == 200, r.text
        return [p["id"] for p in r.json()["items"]]

    assert await order(sort="title") == [cheap, pricey, draft, empty]
    assert (await order(sort="price_asc"))[:2] == [cheap, empty]
    assert (await order(sort="price_desc"))[0] == pricey
    assert (await order(sort="stock_desc"))[:2] == [pricey, cheap]
    assert await order(status="draft") == [draft]
    assert await order(status="paused") == []
    assert (await client.get("/seller/products", params={"sort": "bogus"}, headers=h)).status_code == 422


@pytest.mark.asyncio
async def test_bulk_status_reports_skipped_rows_and_respects_ownership(client):
    seller_token, admin_token, cat_id = await setup_seller_with_category(client)
    h = _auth(seller_token)
    a = await _product(client, h, cat_id, "Bulk A")
    b = await _product(client, h, cat_id, "Bulk B")
    suspended = await _product(client, h, cat_id, "Bulk suspended")
    assert (await client.post(f"/admin/products/{suspended}/suspend", headers=_auth(admin_token))).status_code == 200

    await register_and_login(client, "bulk_other@example.com")
    await make_seller("bulk_other@example.com")
    other = _auth(await register_and_login(client, "bulk_other@example.com"))
    foreign = await _product(client, other, cat_id, "Foreign")

    resp = await client.post("/seller/products/bulk-status", json={
        "ids": [a, b, suspended, foreign, 999999, a], "status": "paused",
    }, headers=h)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["updated"] == [a, b]
    assert body["skipped"] == [
        {"id": suspended, "reason": "suspended"},
        {"id": foreign, "reason": "not_owner"},
        {"id": 999999, "reason": "not_found"},
    ]
    listing = (await client.get("/seller/products", params={"status": "paused"}, headers=h)).json()
    assert {p["id"] for p in listing["items"]} == {a, b}
    foreign_row = (await client.get("/seller/products", headers=other)).json()["items"][0]
    assert foreign_row["status"] == "active"

    back = await client.post("/seller/products/bulk-status", json={"ids": [a, b], "status": "active"}, headers=h)
    assert back.json()["updated"] == [a, b]
    assert (await client.post("/seller/products/bulk-status", json={"ids": [], "status": "active"}, headers=h)).status_code == 422
    assert (await client.post("/seller/products/bulk-status", json={"ids": [a], "status": "suspended"}, headers=h)).status_code == 422
