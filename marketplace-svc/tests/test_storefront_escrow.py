"""The storefront shows the buyer protection an order really gets, not the
seller's raw product setting (which may be 0 and is raised to the floor)."""
from datetime import datetime

import pytest
from sqlalchemy import update

from src.database import SessionLocal
from src.models.product import Product, ProductVariant
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_public_escrow_days_match_the_order_hold(client):
    buyer, _, _, instant_id, _ = await setup_buyable_product(client)
    async with SessionLocal() as db:
        product_id = await db.scalar(
            ProductVariant.__table__.select().with_only_columns(ProductVariant.product_id)
            .where(ProductVariant.id == instant_id)
        )
        await db.execute(update(Product).where(Product.id == product_id).values(escrow_days=0))
        await db.commit()
        public_key = (await db.get(Product, product_id)).public_key

    detail = (await client.get(f"/products/{public_key}")).json()
    listed = next(p for p in (await client.get("/products", params={"per_page": 50})).json()["items"] if p["id"] == product_id)
    assert detail["escrow_days"] >= 1
    assert listed["escrow_days"] == detail["escrow_days"]

    order = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))).json()
    held = datetime.fromisoformat(order["escrow_expires_at"]) - datetime.fromisoformat(order["delivered_at"])
    assert round(held.total_seconds() / 86400) == detail["escrow_days"]


@pytest.mark.asyncio
async def test_me_carries_the_key_that_marks_own_listings(client):
    _, seller, _, instant_id, _ = await setup_buyable_product(client)
    me = (await client.get("/me", headers=_auth(seller))).json()
    listed = (await client.get("/products", params={"per_page": 50})).json()["items"]
    assert me["public_key"] and any(p["seller_key"] == me["public_key"] for p in listed)


@pytest.mark.asyncio
async def test_catalog_summary_carries_each_category_from_price(client):
    await setup_buyable_product(client)
    summary = (await client.get("/products/catalog-summary")).json()
    row = next(r for r in summary["category_counts"] if r["count"] > 0)
    assert row["price_from"] == 1000


@pytest.mark.asyncio
async def test_a_completed_real_order_counts_as_sold(client):
    buyer, _, _, instant_id, _ = await setup_buyable_product(client)
    order = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 2}, headers=_auth(buyer))).json()
    async with SessionLocal() as db:
        product_id = await db.scalar(
            ProductVariant.__table__.select().with_only_columns(ProductVariant.product_id)
            .where(ProductVariant.id == instant_id)
        )
        before = (await db.get(Product, product_id)).sold_count or 0
    assert (await client.post(f"/orders/{order['id']}/confirm", headers=_auth(buyer))).status_code == 200
    async with SessionLocal() as db:
        assert (await db.get(Product, product_id)).sold_count == before + 2


@pytest.mark.asyncio
async def test_delivery_type_filter_matches_the_card_tags(client):
    await setup_buyable_product(client)  # one product with an instant and a manual package
    listed = lambda **params: client.get("/products", params={"per_page": 50, **params})  # noqa: E731
    sla = (await listed(fulfillment="sla")).json()["items"]
    instant = (await listed(fulfillment="instant")).json()["items"]
    assert [p["title"] for p in sla] == ["Order Test"] and [p["title"] for p in instant] == ["Order Test"]
    assert (await listed(fulfillment="api")).json()["total"] == 0
    assert (await listed(fulfillment="bogus")).status_code == 422


@pytest.mark.asyncio
async def test_sellers_can_check_listing_text_for_contact_details(client):
    from tests.conftest import register_and_login

    _, seller, _, _, _ = await setup_buyable_product(client)
    check = lambda text, token=seller: client.post("/seller/content-check", json={"text": text}, headers=_auth(token))  # noqa: E731
    found = (await check("Tài khoản zalo 0912 345 678 xem t.me/abc hoặc https://x.io")).json()["matches"]
    assert "phone" in found and "link" in found
    assert (await check("Gmail cổ 2015, bảo hành 7 ngày")).json()["matches"] == []
    buyer = await register_and_login(client, "content-check-buyer@example.com")
    assert (await check("0912345678", buyer)).status_code == 403
