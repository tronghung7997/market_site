"""A review an admin hides leaves every rating figure, not just the list."""
import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account
from tests.test_orders import setup_buyable_product


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_hidden_review_leaves_product_shop_and_dashboard_ratings(client):
    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    reviews = []
    for stars in (5, 1):
        order = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_h(buyer))).json()
        review = await client.post(f"/orders/{order['id']}/review", json={"rating": stars, "comment": "ok"}, headers=_h(buyer))
        assert review.status_code in (200, 201), review.text
        reviews.append(review.json())
    product_id = order["product_id"]
    async with SessionLocal() as db:
        seller_key = await db.scalar(select(Account.public_key).where(Account.email == "ord_seller@example.com"))

    async def figures():
        detail = (await client.get(f"/products/{product_id}")).json()
        summary = (await client.get(f"/products/{product_id}/reviews")).json()["summary"]
        shop = (await client.get(f"/sellers/{seller_key}")).json()
        dashboard = (await client.get("/seller/dashboard?range=7d", headers=_h(seller))).json()["reviews"]
        return (
            (detail["rating_avg"], detail["rating_count"]),
            (summary["average"], summary["counts"]["1"]),
            (shop["rating_avg"], shop["review_count"]),
            (dashboard["rating_avg"], dashboard["rating_count"]),
        )

    assert await figures() == ((3.0, 2), (3.0, 1), (3.0, 2), (3.0, 2))

    one_star = reviews[1]["id"]
    hidden = await client.patch(f"/admin/reviews/{one_star}/visibility", json={"hidden": True, "reason": "spam"}, headers=_h(admin))
    assert hidden.status_code == 200, hidden.text
    assert await figures() == ((5.0, 1), (5.0, 0), (5.0, 1), (5.0, 1))

    # Only an admin moderates.
    assert (await client.patch(f"/admin/reviews/{one_star}/visibility", json={"hidden": False}, headers=_h(seller))).status_code == 403
    assert await figures() == ((5.0, 1), (5.0, 0), (5.0, 1), (5.0, 1))

    restored = await client.patch(f"/admin/reviews/{one_star}/visibility", json={"hidden": False}, headers=_h(admin))
    assert restored.status_code == 200
    assert await figures() == ((3.0, 2), (3.0, 1), (3.0, 2), (3.0, 2))
