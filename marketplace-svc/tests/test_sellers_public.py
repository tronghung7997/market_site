"""Seller public identity: /sellers/{handle}-{key}, no account ids on the wire."""
import re
import uuid

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account, ApplicationStatus, SellerApplication
from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product
from tests.test_products import _create_public_product, setup_seller_with_category

_KEY_RE = re.compile(r"^[0-9a-z]{8}$")


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _key_for(email: str) -> str:
    async with SessionLocal() as db:
        return await db.scalar(select(Account.public_key).where(Account.email == email))


async def _approve_business_name(email: str, name: str) -> None:
    async with SessionLocal() as db:
        account_id = await db.scalar(select(Account.id).where(Account.email == email))
        db.add(SellerApplication(account_id=account_id, business_name=name, status=ApplicationStatus.approved))
        await db.commit()


@pytest.mark.asyncio
async def test_seller_profile_resolves_by_key_and_legacy_id_but_never_leaks_account_id(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    await _create_public_product(client, seller_token, cat_id)
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    key = await _key_for("prod_seller@example.com")
    assert _KEY_RE.match(key) and not key.isdigit()

    top = (await client.get("/sellers/top")).json()
    card = next(s for s in top if s["public_key"] == key)
    assert "account_id" not in card
    assert card["handle"] is None and card["canonical_path"] == f"/sellers/{key}"

    by_key = await client.get(f"/sellers/{key}")
    by_id = await client.get(f"/sellers/{seller_id}")
    assert by_key.status_code == 200 and by_id.status_code == 200
    assert by_key.json()["public_key"] == by_id.json()["public_key"] == key
    assert "account_id" not in by_key.json()

    assert (await client.get("/sellers/zzzzzzzz")).status_code == 404
    assert (await client.get("/sellers/not-a-ref")).status_code == 404
    buyer_token = await register_and_login(client, "plain_buyer@example.com")
    buyer_id = (await client.get("/me", headers=_auth(buyer_token))).json()["id"]
    assert (await client.get(f"/sellers/{buyer_id}")).status_code == 404


@pytest.mark.asyncio
async def test_business_name_becomes_the_url_handle(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    await _create_public_product(client, seller_token, cat_id)
    await _approve_business_name("prod_seller@example.com", "Orbit Store — Proxy & VPN!")
    key = await _key_for("prod_seller@example.com")

    profile = (await client.get(f"/sellers/{key}")).json()
    assert profile["handle"] == "orbit-store-proxy-vpn"
    assert profile["canonical_path"] == f"/sellers/orbit-store-proxy-vpn-{key}"
    assert profile["display_name"] == "Orbit Store — Proxy & VPN!"
    # Handle is decorative: a stale one still resolves (the page redirects).
    assert (await client.get(f"/sellers/old-name-{key}")).status_code == 200
    assert (await client.get(f"/sellers/orbit-store-proxy-vpn-{key}")).json()["public_key"] == key


@pytest.mark.asyncio
async def test_public_products_carry_seller_key_instead_of_seller_id(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    body = await _create_public_product(client, seller_token, cat_id)
    key = await _key_for("prod_seller@example.com")

    listed = (await client.get(f"/products?category_id={cat_id}")).json()["items"]
    row = next(p for p in listed if p["id"] == body["id"])
    assert "seller_id" not in row
    assert row["seller_key"] == key and row["seller_path"] == f"/sellers/{key}"

    detail = (await client.get(body["canonical_path"])).json()
    assert "seller_id" not in detail and detail["seller_key"] == key

    # Management payloads keep the id (the seller owns it; admin needs it).
    own = (await client.get(f"/seller/products/{body['id']}/detail", headers=_auth(seller_token))).json()
    assert own["seller_id"] == (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    assert body["seller_id"] == own["seller_id"]

    # Public seller filter takes the key (or handle-key); unknown refs are empty pages.
    assert [p["id"] for p in (await client.get(f"/products?seller={key}")).json()["items"]] == [body["id"]]
    assert (await client.get(f"/products?seller=anything-{key}")).json()["total"] == 1
    assert (await client.get("/products?seller=nope1234")).json() == {"items": [], "total": 0, "page": 1, "per_page": 50}


@pytest.mark.asyncio
async def test_chat_counterparts_are_public_keys(client):
    buyer_token, seller_token, _, _, _ = await setup_buyable_product(client)
    product = (await client.get("/seller/products", headers=_auth(seller_token))).json()["items"][-1]
    buyer_email = (await client.get("/me", headers=_auth(buyer_token))).json()["email"]
    seller_email = (await client.get("/me", headers=_auth(seller_token))).json()["email"]
    buyer_key, seller_key = await _key_for(buyer_email), await _key_for(seller_email)

    opened = await client.post(
        "/chat/inquiries",
        json={"product_id": product["id"], "initial_message": "hi", "client_message_id": str(uuid.uuid4())},
        headers=_auth(buyer_token),
    )
    assert opened.status_code == 201, opened.text
    assert opened.json()["counterpart"]["id"] == seller_key

    seller_rooms = (await client.get("/chat/conversations?perspective=seller", headers=_auth(seller_token))).json()["items"]
    room = next(r for r in seller_rooms if r["id"] == opened.json()["id"])
    assert room["counterpart"]["id"] == buyer_key
    assert room["counterpart"]["label"] == f"Khách hàng #{buyer_key}"
    detail = (await client.get(f"/chat/conversations/{room['id']}", headers=_auth(seller_token))).json()
    assert detail["counterpart"]["id"] == buyer_key
