"""Public images attached by features: product gallery, category image, shop
logo/banner and account avatar (upload → save on the owner → public payloads)."""

import io

import pytest
from PIL import Image
from sqlalchemy import select

from src.database import SessionLocal
from src.models.log_entry import LogEntry
from src.models.media import MediaObject
from tests.conftest import make_admin, make_seller, register_and_login


def _png(size=(900, 600)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (20, 90, 160)).save(buffer, "PNG")
    return buffer.getvalue()


async def _headers(client, email, role=None):
    await register_and_login(client, email)
    if role == "seller":
        await make_seller(email)
    elif role == "admin":
        await make_admin(email)
    return {"Authorization": f"Bearer {await register_and_login(client, email)}"}


async def _upload(client, headers, purpose="product_image", size=(900, 600)) -> dict:
    response = await client.post(
        f"/media/uploads?purpose={purpose}", content=_png(size), headers={**headers, "Content-Type": "image/png"},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _statuses(ids) -> dict[str, str]:
    async with SessionLocal() as db:
        return dict((await db.execute(
            select(MediaObject.public_id, MediaObject.status).where(MediaObject.public_id.in_(ids))
        )).all())


@pytest.mark.asyncio
async def test_product_gallery_is_saved_ordered_and_shown_on_public_payloads(client):
    admin = await _headers(client, "gal-admin@example.com", "admin")
    category = (await client.post("/admin/categories", json={"name": "Gal", "slug": "gal"}, headers=admin)).json()
    seller = await _headers(client, "gal-seller@example.com", "seller")
    first, second = await _upload(client, seller), await _upload(client, seller)

    created = await client.post("/seller/products", json={
        "category_id": category["id"], "title": "Gallery product", "description": "d",
        "cover_id": "proxy", "gallery": [first["id"], second["id"]], "status": "active",
    }, headers=seller)
    assert created.status_code == 201, created.text
    images = created.json()["images"]
    assert images["cover_id"] == "proxy"
    assert [image["id"] for image in images["gallery"]] == [first["id"], second["id"]]
    assert images["cover"] == images["gallery"][0] and images["cover"]["url"] == first["url"]
    product = created.json()
    assert await _statuses([first["id"], second["id"]]) == {first["id"]: "attached", second["id"]: "attached"}

    detail = (await client.get(product["canonical_path"])).json()
    assert [image["id"] for image in detail["images"]["gallery"]] == [first["id"], second["id"]]
    listing = (await client.get("/products", params={"search": "Gallery product"})).json()
    row = next(item for item in listing["items"] if item["id"] == product["id"])
    assert row["images"]["cover"]["thumb_url"] == first["thumb_url"] and "gallery" not in row["images"]

    # Reorder + drop one; changing only the cover icon keeps the gallery.
    updated = await client.patch(f"/seller/products/{product['id']}", json={"gallery": [second["id"]]}, headers=seller)
    assert [image["id"] for image in updated.json()["images"]["gallery"]] == [second["id"]]
    assert await _statuses([first["id"]]) == {first["id"]: "detached"}
    icon_only = await client.patch(f"/seller/products/{product['id']}", json={"cover_id": "token"}, headers=seller)
    assert icon_only.json()["images"]["cover_id"] == "token"
    assert [image["id"] for image in icon_only.json()["images"]["gallery"]] == [second["id"]]

    # Another seller's upload, or a non-product image, cannot be attached.
    other = await _headers(client, "gal-other@example.com", "seller")
    foreign = await _upload(client, other)
    avatar = await _upload(client, seller, "avatar")
    for media_id in (foreign["id"], avatar["id"]):
        rejected = await client.patch(
            f"/seller/products/{product['id']}", json={"gallery": [second["id"], media_id]}, headers=seller,
        )
        assert rejected.status_code == 422 and rejected.json()["error_code"] == "MEDIA_NOT_ATTACHABLE"
    too_many = await client.patch(f"/seller/products/{product['id']}", json={"gallery": ["a" * 16] * 9}, headers=seller)
    assert too_many.status_code == 422
    malformed = await client.patch(f"/seller/products/{product['id']}", json={"gallery": ["../etc"]}, headers=seller)
    assert malformed.status_code == 422

    # Admin keeps the seller's image and adds one of their own; the edit is logged.
    admin_upload = await _upload(client, admin)
    by_admin = await client.patch(
        f"/admin/products/{product['id']}", json={"gallery": [admin_upload["id"], second["id"]]}, headers=admin,
    )
    assert by_admin.status_code == 200, by_admin.text
    assert [image["id"] for image in by_admin.json()["images"]["gallery"]] == [admin_upload["id"], second["id"]]
    async with SessionLocal() as db:
        events = list(await db.scalars(
            select(LogEntry.metadata_).where(LogEntry.message == f"admin_product_content_updated product={product['id']}")
        ))
    assert [event["fields"] for event in events] == [["gallery"]]


@pytest.mark.asyncio
async def test_category_image_replaces_and_clears(client):
    admin = await _headers(client, "cat-img-admin@example.com", "admin")
    image = await _upload(client, admin, "category_image", (400, 300))
    created = await client.post(
        "/admin/categories", json={"name": "Ảnh", "slug": "anh", "icon": "proxy", "image_id": image["id"]}, headers=admin,
    )
    assert created.status_code == 201, created.text
    assert created.json()["image"]["url"] == image["url"] and (created.json()["image"]["w"], created.json()["image"]["h"]) == (300, 300)
    tree = (await client.get("/categories")).json()
    assert any(node.get("image", {}) and node["image"]["id"] == image["id"] for node in tree)

    cleared = await client.patch(f"/admin/categories/{created.json()['id']}", json={"image_id": None}, headers=admin)
    assert cleared.json()["image"] is None and cleared.json()["icon"] == "proxy"
    assert await _statuses([image["id"]]) == {image["id"]: "detached"}

    seller = await _headers(client, "cat-img-seller@example.com", "seller")
    denied = await client.post("/media/uploads?purpose=category_image", content=_png(), headers={**seller, "Content-Type": "image/png"})
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_shop_logo_and_banner_show_on_the_public_seller_page(client):
    seller = await _headers(client, "logo-seller@example.com", "seller")
    logo = await _upload(client, seller, "seller_logo", (800, 500))
    banner = await _upload(client, seller, "seller_banner", (2400, 1200))
    saved = await client.patch(
        "/seller/profile", json={"business_name": "Shop Ảnh", "logo_id": logo["id"], "banner_id": banner["id"]}, headers=seller,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["logo"]["id"] == logo["id"] and saved.json()["banner"]["id"] == banner["id"]
    assert (banner["w"], banner["h"]) == (1920, 640)

    public = (await client.get(f"/sellers/{saved.json()['canonical_path'].rsplit('/', 1)[-1]}")).json()
    assert public["logo"]["url"] == logo["url"] and public["banner"]["url"] == banner["url"]

    # Wrong purpose is refused; null removes one image and keeps the other.
    wrong = await client.patch("/seller/profile", json={"logo_id": banner["id"]}, headers=seller)
    assert wrong.status_code == 422
    removed = await client.patch("/seller/profile", json={"banner_id": None}, headers=seller)
    assert removed.json()["banner"] is None and removed.json()["logo"]["id"] == logo["id"]


@pytest.mark.asyncio
async def test_account_avatar_round_trip(client):
    buyer = await _headers(client, "avatar-buyer@example.com")
    avatar = await _upload(client, buyer, "avatar", (640, 480))
    assert (avatar["w"], avatar["h"]) == (256, 256)
    saved = await client.patch("/me", json={"avatar_id": avatar["id"]}, headers=buyer)
    assert saved.status_code == 200, saved.text
    assert saved.json()["avatar"]["url"] == avatar["url"]
    assert (await client.get("/me", headers=buyer)).json()["avatar"]["id"] == avatar["id"]

    other = await _headers(client, "avatar-thief@example.com")
    stolen = await client.patch("/me", json={"avatar_id": avatar["id"]}, headers=other)
    assert stolen.status_code == 422

    cleared = await client.patch("/me", json={"avatar_id": None}, headers=buyer)
    assert cleared.json()["avatar"] is None
