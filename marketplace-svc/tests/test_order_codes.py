"""Order codes (ORD-XXXXXXXX) and viewer-scoped counterparty exposure."""
import re
import uuid

import pytest

from src.orders.codes import mask_email, parse_order_ref
from tests.conftest import make_admin, register_and_login
from tests.test_orders import setup_buyable_product

_CODE_RE = re.compile(r"^ORD-[0-9A-Z]{8}$")


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.no_db
def test_parse_order_ref_and_mask_email():
    assert parse_order_ref("212") == ("id", 212)
    assert parse_order_ref("ORD-K7F3Q9X2") == ("code", "ORD-K7F3Q9X2")
    assert parse_order_ref("ord-k7f3q9x2") == ("code", "ORD-K7F3Q9X2")
    assert parse_order_ref("k7f3q9x2") == ("code", "ORD-K7F3Q9X2")
    assert parse_order_ref("12345678") == ("id", 12345678)
    assert parse_order_ref("nope") is None and parse_order_ref("") is None
    assert mask_email("buyer.name@gmail.com") == "bu***@gmail.com"
    assert mask_email("ab@x.io") == "***@x.io"
    assert mask_email(None) is None


@pytest.mark.asyncio
async def test_order_code_is_the_public_reference(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    created = await client.post("/orders", json={"variant_id": instant_variant_id, "quantity": 1}, headers=_auth(buyer_token))
    assert created.status_code == 201, created.text
    order = created.json()
    code = order["order_code"]
    assert _CODE_RE.match(code)

    # Every order-scoped route takes the code (any case, prefix optional) or the legacy id.
    by_code = await client.get(f"/orders/{code}", headers=_auth(buyer_token))
    by_lower = await client.get(f"/orders/{code.lower()}", headers=_auth(buyer_token))
    by_id = await client.get(f"/orders/{order['id']}", headers=_auth(buyer_token))
    assert by_code.status_code == by_lower.status_code == by_id.status_code == 200
    assert by_code.json()["id"] == by_id.json()["id"] == order["id"]
    assert (await client.get("/orders/ORD-ZZZZZZZZ", headers=_auth(buyer_token))).status_code == 404
    assert (await client.get("/orders/not-a-ref", headers=_auth(buyer_token))).status_code == 404

    # Search by code on both consoles.
    buyer_list = (await client.get("/orders", params={"search": f"#{code}"}, headers=_auth(buyer_token))).json()
    assert [o["id"] for o in buyer_list["items"]] == [order["id"]]
    seller_list = (await client.get("/seller/orders", params={"search": code.lower()}, headers=_auth(seller_token))).json()
    assert [o["id"] for o in seller_list["items"]] == [order["id"]]

    # Confirm by code; the chat room carries the code too.
    confirmed = await client.post(f"/orders/{code}/confirm", headers=_auth(buyer_token))
    assert confirmed.status_code == 200, confirmed.text
    room = await client.post(f"/chat/orders/{code}", headers=_auth(buyer_token))
    assert room.status_code in (200, 201), room.text
    assert room.json()["order"]["code"] == code


@pytest.mark.asyncio
async def test_counterparty_exposure_depends_on_viewer(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    buyer_email = (await client.get("/me", headers=_auth(buyer_token))).json()["email"]
    seller_email = (await client.get("/me", headers=_auth(seller_token))).json()["email"]
    order = (await client.post("/orders", json={"variant_id": instant_variant_id, "quantity": 1}, headers=_auth(buyer_token))).json()
    code = order["order_code"]

    buyer_view = (await client.get(f"/orders/{code}", headers=_auth(buyer_token))).json()
    assert buyer_view["seller_email"] is None
    assert buyer_view["seller_name"] and "@" not in buyer_view["seller_name"]
    assert buyer_view["seller_path"].startswith("/sellers/")
    buyer_rows = (await client.get("/orders", headers=_auth(buyer_token))).json()["items"]
    assert all(row["seller_email"] is None for row in buyer_rows)

    seller_view = (await client.get(f"/orders/{code}", headers=_auth(seller_token))).json()
    assert seller_view["buyer_email"] == mask_email(buyer_email) and "***" in seller_view["buyer_email"]
    assert seller_view["buyer_key"] and seller_view["buyer_email"] != buyer_email
    seller_rows = (await client.get("/seller/orders", headers=_auth(seller_token))).json()["items"]
    assert all("***" in (row["buyer_email"] or "***") for row in seller_rows)

    # Disputes: seller sees the masked address, the buyer no echo, admin everything.
    opened = await client.post(f"/orders/{code}/dispute", json={"reason": "broken"}, headers=_auth(buyer_token))
    assert opened.status_code in (200, 201), opened.text
    assert opened.json()["buyer_email"] is None and opened.json()["order_code"] == code
    seller_dispute = (await client.get(f"/seller/orders/{code}/dispute", headers=_auth(seller_token))).json()
    assert seller_dispute["buyer_email"] == mask_email(buyer_email)
    seller_page = (await client.get("/seller/disputes", headers=_auth(seller_token))).json()
    assert all("***" in (row["buyer_email"] or "***") for row in seller_page["items"])

    admin_token = await register_and_login(client, "codes_admin@example.com")
    await make_admin("codes_admin@example.com")
    admin_token = await register_and_login(client, "codes_admin@example.com")
    admin_detail = (await client.get(f"/admin/orders/{order['id']}", headers=_auth(admin_token))).json()
    assert admin_detail["buyer_email"] == buyer_email and admin_detail["seller_email"] == seller_email
    admin_dispute = (await client.get(f"/admin/disputes/{opened.json()['id']}", headers=_auth(admin_token))).json()
    assert admin_dispute["order"]["buyer_email"] == buyer_email and admin_dispute["order"]["order_code"] == code
