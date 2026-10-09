"""Review photos (F30) and the schema.org review data on the product payload (F31)."""
import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.order import Order
from src.models.product import ProductVariant
from src.models.review import Review
from tests.conftest import register_and_login
from tests.test_media_admin import _upload
from tests.test_orders import setup_buyable_product


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _order(client, buyer_token, variant_id) -> int:
    order = await client.post("/orders", json={"variant_id": variant_id, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 201, order.text
    return order.json()["id"]


async def _photo(client, token) -> str:
    upload = await _upload(client, _auth(token), "review_image")
    assert upload.status_code in (200, 201), upload.text
    assert upload.json()["url"]  # public purpose: the storefront serves it
    return upload.json()["id"]


async def _product_key(variant_id: int) -> str:
    from src.models.product import Product

    async with SessionLocal() as db:
        variant = await db.get(ProductVariant, variant_id)
        product = await db.get(Product, variant.product_id)
        return product.public_key


@pytest.mark.asyncio
async def test_buyer_attaches_up_to_three_photos_shown_publicly_and_to_admin(client):
    buyer, _seller, admin, variant_id, _ = await setup_buyable_product(client)
    order_id = await _order(client, buyer, variant_id)
    photos = [await _photo(client, buyer) for _ in range(3)]

    review = await client.post(
        f"/orders/{order_id}/review", json={"rating": 5, "comment": "Đúng mô tả", "image_ids": photos}, headers=_auth(buyer),
    )
    assert review.status_code == 201, review.text
    assert [image["id"] for image in review.json()["images"]] == photos
    assert all(image["url"] and image["thumb_url"] for image in review.json()["images"])

    product_id = review.json()["product_id"]
    public = (await client.get(f"/products/{product_id}/reviews")).json()["items"][0]
    assert [image["id"] for image in public["images"]] == photos
    admin_row = (await client.get("/admin/reviews", headers=_auth(admin))).json()["items"][0]
    assert len(admin_row["images"]) == 3

    # Moderation: a hidden review takes its photos off the storefront with it.
    hidden = await client.patch(
        f"/admin/reviews/{review.json()['id']}/visibility", json={"hidden": True, "reason": "ảnh không phù hợp"},
        headers=_auth(admin),
    )
    assert hidden.status_code == 200 and len(hidden.json()["images"]) == 3
    assert (await client.get(f"/products/{product_id}/reviews")).json()["items"] == []
    assert (await client.get("/reviews/latest")).json() == []


@pytest.mark.asyncio
async def test_photo_rules(client):
    buyer, _seller, _admin, variant_id, _ = await setup_buyable_product(client)
    intruder = await register_and_login(client, "review-photo-intruder@example.com")

    # Someone else's upload cannot be attached.
    order_id = await _order(client, buyer, variant_id)
    theirs = await _photo(client, intruder)
    stolen = await client.post(
        f"/orders/{order_id}/review", json={"rating": 5, "image_ids": [theirs]}, headers=_auth(buyer),
    )
    assert stolen.status_code == 422 and stolen.json()["error_code"] == "MEDIA_NOT_ATTACHABLE"
    # Nothing was saved: the order can still be reviewed.
    async with SessionLocal() as db:
        assert await db.scalar(select(Review).where(Review.order_id == order_id)) is None

    # Another purpose is refused, and so is a fourth photo.
    chat_image = (await _upload(client, _auth(buyer), "chat_attachment")).json()["id"]
    wrong = await client.post(f"/orders/{order_id}/review", json={"rating": 5, "image_ids": [chat_image]}, headers=_auth(buyer))
    assert wrong.status_code == 422
    four = [await _photo(client, buyer) for _ in range(4)]
    too_many = await client.post(f"/orders/{order_id}/review", json={"rating": 5, "image_ids": four}, headers=_auth(buyer))
    assert too_many.status_code == 422

    # Not the buyer of the order: 403 before any photo is looked at.
    mine = await _photo(client, intruder)
    not_owner = await client.post(f"/orders/{order_id}/review", json={"rating": 5, "image_ids": [mine]}, headers=_auth(intruder))
    assert not_owner.status_code == 403
    assert (await client.post(f"/orders/{order_id}/review", json={"rating": 5, "image_ids": [mine]})).status_code == 401

    # A trust-seed order never gets photos.
    seeded_order = await _order(client, buyer, variant_id)
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == seeded_order).values(is_seeded=True))
        await db.commit()
    seeded = await client.post(
        f"/orders/{seeded_order}/review", json={"rating": 5, "image_ids": [four[0]]}, headers=_auth(buyer),
    )
    assert seeded.status_code == 400 and seeded.json()["error_code"] == "REVIEW_NOT_ELIGIBLE"

    # A review without photos still works.
    plain = await client.post(f"/orders/{order_id}/review", json={"rating": 4, "comment": "ok"}, headers=_auth(buyer))
    assert plain.status_code == 201 and plain.json()["images"] == []


@pytest.mark.asyncio
async def test_product_seo_counts_real_buyer_reviews_only(client):
    buyer, seller, _admin, variant_id, _ = await setup_buyable_product(client)
    restock = await client.post(
        f"/seller/variants/{variant_id}/resources", json={"items": [f"more{i}|pw{i}" for i in range(4)]}, headers=_auth(seller),
    )
    assert restock.status_code in (200, 201), restock.text
    key = await _product_key(variant_id)
    empty = (await client.get(f"/products/{key}")).json()["seo"]
    assert empty == {"rating_value": None, "review_count": 0, "reviews": []}

    for rating, comment in ((5, "Nhanh"), (3, "   "), (1, "Lỗi"), (5, "Seeded"), (5, "Auto")):
        order_id = await _order(client, buyer, variant_id)
        made = await client.post(f"/orders/{order_id}/review", json={"rating": rating, "comment": comment}, headers=_auth(buyer))
        assert made.status_code == 201, made.text
    async with SessionLocal() as db:
        await db.execute(update(Review).where(Review.comment == "Seeded").values(is_seeded=True))
        await db.execute(update(Review).where(Review.comment == "Auto").values(is_auto=True))
        await db.execute(update(Review).where(Review.comment == "Lỗi").values(is_hidden=True))
        await db.commit()

    seo = (await client.get(f"/products/{key}")).json()["seo"]
    # Real, visible: 5 and 3 → 4.0 over 2; only written ones are sampled.
    assert seo["rating_value"] == 4.0 and seo["review_count"] == 2
    assert [(r["rating"], r["body"]) for r in seo["reviews"]] == [(5, "Nhanh")]
    assert "@" not in seo["reviews"][0]["author"]
