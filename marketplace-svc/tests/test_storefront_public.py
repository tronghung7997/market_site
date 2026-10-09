"""Storefront reads for the home and shop pages: marketplace stats, the latest
reviews strip and the per-shop review list. All public, no row ids beyond what
product reviews already expose."""
import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductStatus
from src.models.review import Review
from src.runtime_config import clear_all_process_config_caches
from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _buy_and_review(client, buyer_token, variant_id, rating, comment, *, confirm=False):
    order = await client.post("/orders", json={"variant_id": variant_id, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 201, order.text
    order_id = order.json()["id"]
    if confirm:
        confirmed = await client.post(f"/orders/{order_id}/confirm", headers=_auth(buyer_token))
        assert confirmed.status_code == 200, confirmed.text
    review = await client.post(
        f"/orders/{order_id}/review", json={"rating": rating, "comment": comment}, headers=_auth(buyer_token),
    )
    assert review.status_code == 201, review.text
    return review.json()


async def _second_product(client, seller_token, category_id, title="Second Product"):
    product = await client.post("/seller/products", json={
        "category_id": category_id, "title": title, "status": "active", "escrow_hours": 48,
    }, headers=_auth(seller_token))
    assert product.status_code in (200, 201), product.text
    product_id = product.json()["id"]
    variant = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Second Var", "price": 2000, "delivery_mode": "instant",
    }, headers=_auth(seller_token))
    variant_id = variant.json()["id"]
    await client.post(f"/seller/variants/{variant_id}/resources", json={"items": ["a|1", "b|2"]}, headers=_auth(seller_token))
    return product_id, variant_id


@pytest.mark.asyncio
async def test_marketplace_stats_count_only_what_the_storefront_shows(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    await _buy_and_review(client, buyer_token, instant_variant_id, 4, "fine", confirm=True)
    await _buy_and_review(client, buyer_token, instant_variant_id, 2, "late")  # delivered, not completed
    category_id = (await client.get("/categories")).json()[-1]["id"]
    draft = await client.post("/seller/products", json={
        "category_id": category_id, "title": "Hidden Draft", "status": "draft", "escrow_hours": 48,
    }, headers=_auth(seller_token))
    assert draft.status_code in (200, 201), draft.text

    clear_all_process_config_caches()
    stats = await client.get("/public/marketplace-stats")
    assert stats.status_code == 200, stats.text
    assert stats.json() == {
        "products_on_sale": 1,
        "sellers_on_sale": 1,
        "completed_orders": 1,
        "review_count": 2,
        "rating_avg": 3.0,
    }

    # A hidden review leaves the count and the average, like on the product page.
    async with SessionLocal() as db:
        await db.execute(update(Review).where(Review.rating == 2).values(is_hidden=True))
        await db.commit()
    clear_all_process_config_caches()
    body = (await client.get("/public/marketplace-stats")).json()
    assert body["review_count"] == 1 and body["rating_avg"] == 4.0

    # Trust-seed orders are not real sales.
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.status == OrderStatus.completed).values(is_seeded=True))
        await db.commit()
    clear_all_process_config_caches()
    assert (await client.get("/public/marketplace-stats")).json()["completed_orders"] == 0


@pytest.mark.asyncio
async def test_marketplace_stats_on_an_empty_marketplace(client):
    body = (await client.get("/public/marketplace-stats")).json()
    assert body == {
        "products_on_sale": 0, "sellers_on_sale": 0, "completed_orders": 0, "review_count": 0, "rating_avg": None,
    }


@pytest.mark.asyncio
async def test_latest_reviews_show_written_reviews_on_products_on_sale(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    written = await _buy_and_review(client, buyer_token, instant_variant_id, 5, "Delivered in a minute")
    await _buy_and_review(client, buyer_token, instant_variant_id, 4, "   ")  # blank comment

    rows = (await client.get("/reviews/latest")).json()
    assert [r["id"] for r in rows] == [written["id"]]
    row = rows[0]
    assert row["comment"] == "Delivered in a minute"
    assert row["product_title"] == "Order Test"
    assert row["product_path"].startswith("/products/") and row["variant_name"] == "Instant Var"
    assert "buyer_id" not in row and "order_id" not in row
    assert "@" not in row["reviewer_label"]

    # Auto-reviews say nothing and hidden ones are gone.
    async with SessionLocal() as db:
        await db.execute(update(Review).where(Review.id == written["id"]).values(is_auto=True))
        await db.commit()
    assert (await client.get("/reviews/latest")).json() == []
    async with SessionLocal() as db:
        await db.execute(update(Review).where(Review.id == written["id"]).values(is_auto=False, is_hidden=True))
        await db.commit()
    assert (await client.get("/reviews/latest")).json() == []

    # A product taken off sale drops out of the strip.
    async with SessionLocal() as db:
        await db.execute(update(Review).where(Review.id == written["id"]).values(is_hidden=False))
        await db.execute(update(Product).values(status=ProductStatus.paused))
        await db.commit()
    assert (await client.get("/reviews/latest")).json() == []

    assert (await client.get("/reviews/latest", params={"limit": 13})).status_code == 422


@pytest.mark.asyncio
async def test_seller_reviews_cover_every_product_of_the_shop(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    category_id = (await client.get("/categories")).json()[-1]["id"]
    second_id, second_variant = await _second_product(client, seller_token, category_id)
    first = await _buy_and_review(client, buyer_token, instant_variant_id, 5, "great")
    second = await _buy_and_review(client, buyer_token, second_variant, 3, "ok")

    seller_key = (await client.get(f"/products/{second_id}")).json()["seller_key"]
    page = await client.get(f"/sellers/{seller_key}/reviews")
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["total"] == 2
    assert [r["id"] for r in body["items"]] == [second["id"], first["id"]]
    assert {r["product_title"] for r in body["items"]} == {"Order Test", "Second Product"}
    assert body["summary"]["average"] == 4.0
    assert body["summary"]["counts"]["5"] == 1 and body["summary"]["counts"]["3"] == 1

    only_five = (await client.get(f"/sellers/{seller_key}/reviews", params={"rating": 5})).json()
    assert only_five["total"] == 1 and only_five["items"][0]["id"] == first["id"]
    assert only_five["summary"]["average"] == 4.0  # summary ignores the filter

    paged = (await client.get(f"/sellers/{seller_key}/reviews", params={"per_page": 1, "page": 2})).json()
    assert paged["total"] == 2 and [r["id"] for r in paged["items"]] == [first["id"]]

    # Off-sale products keep their reviews but lose the link.
    async with SessionLocal() as db:
        await db.execute(update(Product).where(Product.id == second_id).values(status=ProductStatus.paused))
        await db.commit()
    rows = (await client.get(f"/sellers/{seller_key}/reviews")).json()["items"]
    paused_row = next(r for r in rows if r["id"] == second["id"])
    assert paused_row["product_path"] is None and paused_row["product_title"] == "Second Product"


@pytest.mark.asyncio
async def test_seller_reviews_answer_404_for_unknown_or_non_seller_refs(client):
    assert (await client.get("/sellers/zzzzzzzz/reviews")).status_code == 404
    assert (await client.get("/sellers/not-a-ref/reviews")).status_code == 404
    await register_and_login(client, "rev_plain_buyer@example.com")
    async with SessionLocal() as db:
        buyer_key = await db.scalar(select(Account.public_key).where(Account.email == "rev_plain_buyer@example.com"))
    assert (await client.get(f"/sellers/{buyer_key}/reviews")).status_code == 404


@pytest.mark.asyncio
async def test_product_list_min_rating_hides_unrated_and_lower_rated(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    category_id = (await client.get("/categories")).json()[-1]["id"]
    second_id, second_variant = await _second_product(client, seller_token, category_id)
    await _second_product(client, seller_token, category_id, title="Never Rated")
    await _buy_and_review(client, buyer_token, instant_variant_id, 5, "great")
    await _buy_and_review(client, buyer_token, second_variant, 3, "ok")

    def titles(page):
        return sorted(item["title"] for item in page["items"])

    assert titles((await client.get("/products", params={"min_rating": 4})).json()) == ["Order Test"]
    three_up = (await client.get("/products", params={"min_rating": 3})).json()
    assert titles(three_up) == ["Order Test", "Second Product"] and three_up["total"] == 2
    assert len((await client.get("/products")).json()["items"]) == 3
    assert (await client.get("/products", params={"min_rating": 6})).status_code == 422
