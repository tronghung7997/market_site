"""Admin side of media: the upload cap setting, the moderation console
(stats, list, takedown) and seller tier badges."""

import io
import os

import pytest
from PIL import Image
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import SellerTier
from src.models.log_entry import LogEntry
from tests.conftest import make_admin, make_seller, register_and_login, set_seller_tier


def _png(size=(320, 240), *, noise=False) -> bytes:
    buffer = io.BytesIO()
    if noise:  # incompressible, so the file is as large as its pixels
        Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3)).save(buffer, "PNG")
    else:
        Image.new("RGB", size, (90, 120, 30)).save(buffer, "PNG")
    return buffer.getvalue()


async def _headers(client, email, role=None):
    await register_and_login(client, email)
    if role == "seller":
        await make_seller(email)
    elif role == "admin":
        await make_admin(email)
    return {"Authorization": f"Bearer {await register_and_login(client, email)}"}


async def _upload(client, headers, purpose, data=None):
    return await client.post(
        f"/media/uploads?purpose={purpose}", content=data or _png(), headers={**headers, "Content-Type": "image/png"},
    )


@pytest.mark.asyncio
async def test_admin_sets_the_upload_cap_within_the_env_ceiling(client):
    admin = await _headers(client, "cap-admin@example.com", "admin")
    buyer = await _headers(client, "cap-buyer@example.com")
    big = _png((800, 800), noise=True)
    assert len(big) > 1024 * 1024

    lowered = await client.patch("/admin/site-status", json={"media_max_upload_mb": 1}, headers=admin)
    assert lowered.status_code == 200 and lowered.json()["media_max_upload_mb"] == 1
    refused = await _upload(client, buyer, "chat_attachment", big)
    assert refused.status_code == 413
    assert refused.json()["error_code"] == "MEDIA_TOO_LARGE" and refused.json()["params"]["max_mb"] == 1
    assert (await _upload(client, buyer, "chat_attachment")).status_code == 201

    above_env = await client.patch("/admin/site-status", json={"media_max_upload_mb": 11}, headers=admin)
    assert above_env.status_code == 422
    assert (await client.patch("/admin/site-status", json={"media_max_upload_mb": 5}, headers=buyer)).status_code in (401, 403)


@pytest.mark.asyncio
async def test_admin_upload_cap_applies_to_every_attachment_purpose(client):
    """Chat images, dispute evidence, wallet proofs and catalogue images all
    upload through /media/uploads, so the one admin cap refuses each of them."""
    admin = await _headers(client, "cap-all-admin@example.com", "admin")
    seller = await _headers(client, "cap-all-seller@example.com", "seller")
    buyer = await _headers(client, "cap-all-buyer@example.com")
    assert (await client.patch("/admin/site-status", json={"media_max_upload_mb": 1}, headers=admin)).status_code == 200
    big = _png((800, 800), noise=True)
    assert len(big) > 1024 * 1024
    cases = [
        (buyer, "chat_attachment"), (buyer, "dispute_evidence"), (seller, "chat_attachment"),
        (seller, "dispute_evidence"), (seller, "product_image"), (seller, "seller_logo"), (buyer, "avatar"),
        (admin, "payout_receipt"), (admin, "adjustment_proof"), (admin, "post_cover"),
    ]
    for headers, purpose in cases:
        refused = await _upload(client, headers, purpose, big)
        assert refused.status_code == 413, (purpose, refused.text)
        assert refused.json()["error_code"] == "MEDIA_TOO_LARGE" and refused.json()["params"]["max_mb"] == 1
        assert (await _upload(client, headers, purpose)).status_code == 201, purpose


@pytest.mark.asyncio
async def test_console_lists_counts_and_takes_down_images(client):
    admin = await _headers(client, "console-admin@example.com", "admin")
    seller = await _headers(client, "console-seller@example.com", "seller")
    buyer = await _headers(client, "console-buyer@example.com")
    product_image = (await _upload(client, seller, "product_image")).json()
    chat_image = (await _upload(client, buyer, "chat_attachment")).json()

    stats = (await client.get("/admin/media/stats", headers=admin)).json()
    assert stats["count"] == 2 and stats["bytes"] > 0
    assert {row["key"] for row in stats["by_purpose"]} == {"product_image", "chat_attachment"}
    assert stats["by_storage"][0]["key"] == "db"
    assert (await client.get("/admin/media/stats", headers=seller)).status_code == 403

    listed = (await client.get("/admin/media", params={"purpose": "chat_attachment"}, headers=admin)).json()
    assert listed["total"] == 1 and listed["items"][0]["id"] == chat_image["id"]
    assert listed["items"][0]["owner_email"] == "console-buyer@example.com"
    by_owner = (await client.get("/admin/media", params={"owner": "console-seller"}, headers=admin)).json()
    assert [item["id"] for item in by_owner["items"]] == [product_image["id"]]

    # Admins can look at a private image; nobody else can through this route.
    content = await client.get(f"/admin/media/{chat_image['id']}/content", headers=admin)
    assert content.status_code == 200 and content.headers["content-type"] == "image/webp"
    assert (await client.get(f"/admin/media/{chat_image['id']}/content", headers=buyer)).status_code == 403

    public_key = product_image["url"].removeprefix("/media/")
    assert (await client.get(f"/public/media/{public_key}")).status_code == 200
    short = await client.post(f"/admin/media/{product_image['id']}/remove", json={"reason": "x"}, headers=admin)
    assert short.status_code == 422
    removed = await client.post(f"/admin/media/{product_image['id']}/remove", json={"reason": "Lộ số điện thoại"}, headers=admin)
    assert removed.status_code == 200 and removed.json()["status"] == "removed"
    assert (await client.get(f"/public/media/{public_key}")).status_code == 404
    assert (await client.get(f"/admin/media/{product_image['id']}/content", headers=admin)).status_code == 404
    again = await client.post(f"/admin/media/{product_image['id']}/remove", json={"reason": "Lộ số điện thoại"}, headers=admin)
    assert again.status_code == 200
    assert (await client.post(f"/admin/media/{chat_image['id']}/remove", json={"reason": "spam"}, headers=seller)).status_code == 403

    removed_rows = (await client.get("/admin/media", params={"status": "removed"}, headers=admin)).json()["items"]
    assert removed_rows[0]["removed_reason"] == "Lộ số điện thoại"
    async with SessionLocal() as db:
        events = list(await db.scalars(select(LogEntry.metadata_).where(LogEntry.message.contains(product_image["id"]))))
    assert [event["event"] for event in events] == ["media_removed"]
    assert events[0]["purpose"] == "product_image" and events[0]["reason"] == "Lộ số điện thoại"


@pytest.mark.asyncio
async def test_tier_badge_is_set_by_admin_and_shown_on_sellers(client):
    admin = await _headers(client, "badge-admin@example.com", "admin")
    seller = await _headers(client, "badge-seller@example.com", "seller")
    await set_seller_tier("badge-seller@example.com", SellerTier.verified)
    assert (await _upload(client, seller, "tier_badge")).status_code == 403
    badge = (await _upload(client, admin, "tier_badge", _png((300, 200)))).json()
    assert (badge["w"], badge["h"]) == (128, 128)

    saved = await client.patch("/admin/seller-tier-config", json={"tiers": {"verified": {"badge_image_id": badge["id"]}}}, headers=admin)
    assert saved.status_code == 200, saved.text
    verified = next(rule for rule in saved.json()["tiers"] if rule["tier"] == "verified")
    assert verified["badge"]["url"] == badge["url"]
    public = (await client.get("/public/seller-tiers")).json()
    assert next(rule for rule in public["tiers"] if rule["tier"] == "verified")["badge"]["id"] == badge["id"]

    profile = (await client.patch("/seller/profile", json={"business_name": "Shop Huy Hiệu"}, headers=seller)).json()
    shop = (await client.get(f"/sellers/{profile['canonical_path'].rsplit('/', 1)[-1]}")).json()
    assert shop["tier_badge"]["id"] == badge["id"]

    cleared = await client.patch("/admin/seller-tier-config", json={"tiers": {"verified": {"badge_image_id": None}}}, headers=admin)
    assert next(rule for rule in cleared.json()["tiers"] if rule["tier"] == "verified")["badge"] is None
