"""Seller-facing payloads and routes carry public keys / order codes, never
row ids: inventory packages, seller product detail, ledger rows, resources."""
import re

import pytest

from tests.test_orders import setup_buyable_product

_KEY_RE = re.compile(r"^[0-9a-z]{8}$")


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_variant_keys_resolve_inventory_and_product_routes(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)

    mine = (await client.get("/seller/products", headers=_auth(seller_token))).json()
    product_id = mine["items"][0]["id"]
    detail = (await client.get(f"/seller/products/{product_id}/detail", headers=_auth(seller_token))).json()
    product_key = detail["public_key"]
    variant = next(v for v in detail["variants"] if v["id"] == instant_variant_id)
    variant_key = variant["public_key"]
    assert _KEY_RE.match(variant_key) and not variant_key.isdigit()

    # Seller product detail by key (what /seller/products/{key} loads).
    by_key = await client.get(f"/seller/products/{product_key}/detail", headers=_auth(seller_token))
    assert by_key.status_code == 200 and by_key.json()["id"] == product_id
    assert (await client.get("/seller/products/zzzzzzz1/detail", headers=_auth(seller_token))).status_code == 404

    # Inventory package by key or legacy id; rows and siblings expose keys.
    pkg_by_key = await client.get(f"/seller/inventory/packages/{variant_key}", headers=_auth(seller_token))
    pkg_by_id = await client.get(f"/seller/inventory/packages/{instant_variant_id}", headers=_auth(seller_token))
    assert pkg_by_key.status_code == pkg_by_id.status_code == 200, pkg_by_key.text
    pkg = pkg_by_key.json()
    assert pkg["variant_id"] == instant_variant_id
    assert pkg["variant_key"] == variant_key and pkg["product_key"] == product_key
    assert all(s["variant_key"] for s in pkg["siblings"])
    assert (await client.get("/seller/inventory/packages/zzzzzzz1", headers=_auth(seller_token))).status_code == 404

    listed = (await client.get("/seller/inventory/packages", params={"search": variant_key}, headers=_auth(seller_token))).json()
    assert [row["variant_id"] for row in listed["items"]] == [instant_variant_id]

    # Sold resources point at their order by code and the seller can search by it.
    order = (await client.post("/orders", json={"variant_id": instant_variant_id, "quantity": 1}, headers=_auth(buyer_token))).json()
    rows = (await client.get(f"/seller/variants/{instant_variant_id}/resources", headers=_auth(seller_token))).json()
    sold = [r for r in rows if r["order_id"] == order["id"]]
    assert sold and all(r["order_code"] == order["order_code"] for r in sold)
    found = (await client.get(
        f"/seller/variants/{instant_variant_id}/resources", params={"search": f"#{order['order_code']}"}, headers=_auth(seller_token),
    )).json()
    assert [r["id"] for r in found] == [r["id"] for r in sold]

    # Seller orders filter by product key (URL `?product=`), facets carry keys.
    page = (await client.get("/seller/orders", params={"product": product_key}, headers=_auth(seller_token))).json()
    assert [o["id"] for o in page["items"]] == [order["id"]]
    assert page["products"][0]["public_key"] == product_key
    empty = (await client.get("/seller/orders", params={"product": "zzzzzzz1"}, headers=_auth(seller_token))).json()
    assert empty["items"] == []


@pytest.mark.asyncio
async def test_ledger_rows_name_orders_by_code(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    order = (await client.post("/orders", json={"variant_id": instant_variant_id, "quantity": 1}, headers=_auth(buyer_token))).json()
    confirmed = await client.post(f"/orders/{order['order_code']}/confirm", headers=_auth(buyer_token))
    assert confirmed.status_code == 200, confirmed.text

    buyer_rows = (await client.get("/wallet/transactions", headers=_auth(buyer_token))).json()
    hold = next(t for t in buyer_rows if t["type"] == "purchase_hold")
    assert hold["reference_id"] == f"order-{order['id']}"
    assert hold["order_code"] == order["order_code"]
    assert hold["reference_label"] == order["order_code"]

    seller_rows = (await client.get("/wallet/transactions", headers=_auth(seller_token))).json()
    release = next(t for t in seller_rows if t["type"] == "purchase_release")
    assert release["order_code"] == order["order_code"]
    assert release["reference_label"] == order["order_code"]
