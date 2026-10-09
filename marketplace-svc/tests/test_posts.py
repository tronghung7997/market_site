"""Blog posts: admin-written, public only once published."""
import pytest

from tests.test_media_admin import _headers, _upload


def _post(**over):
    body = {
        "slug": "huong-dan-nap-tien",
        "category": "guide",
        "vi": {"title": "Hướng dẫn nạp tiền", "excerpt": "Ba bước để ví được cộng.", "body": "## Bước 1\nNhập số tiền."},
        "en": {"title": "", "excerpt": "", "body": ""},
    }
    return {**body, **over}


@pytest.mark.asyncio
async def test_draft_is_private_until_published(client):
    admin = await _headers(client, "blog-admin@example.com", "admin")
    created = await client.post("/admin/posts", json=_post(), headers=admin)
    assert created.status_code == 201, created.text
    post = created.json()
    assert post["status"] == "draft" and post["published_at"] is None
    assert (await client.get("/public/posts")).json()["total"] == 0
    assert (await client.get("/public/posts/huong-dan-nap-tien")).status_code == 404

    published = await client.put(f"/admin/posts/{post['id']}", json=_post(publish=True), headers=admin)
    assert published.status_code == 200 and published.json()["status"] == "published"
    listing = (await client.get("/public/posts?locale=vi")).json()
    assert listing["total"] == 1 and listing["items"][0]["title"] == "Hướng dẫn nạp tiền"
    assert "body" not in listing["items"][0]
    # English falls back to Vietnamese field by field.
    detail = (await client.get("/public/posts/huong-dan-nap-tien?locale=en")).json()
    assert detail["title"] == "Hướng dẫn nạp tiền" and detail["body"].startswith("## Bước 1")
    assert (await client.get("/public/posts?category=news")).json()["total"] == 0
    assert [p["slug"] for p in (await client.get("/public/post-slugs")).json()] == ["huong-dan-nap-tien"]

    # Unpublishing takes it off the storefront again.
    await client.put(f"/admin/posts/{post['id']}", json=_post(publish=False), headers=admin)
    assert (await client.get("/public/posts")).json()["total"] == 0


@pytest.mark.asyncio
async def test_post_rules(client):
    admin = await _headers(client, "blog-admin2@example.com", "admin")
    buyer = await _headers(client, "blog-buyer@example.com")
    assert (await client.post("/admin/posts", json=_post(), headers=buyer)).status_code == 403
    assert (await client.post("/admin/posts", json=_post(slug="Bad Slug"), headers=admin)).status_code == 422
    empty = _post(publish=True, vi={"title": "", "excerpt": "", "body": ""})
    incomplete = await client.post("/admin/posts", json=empty, headers=admin)
    assert incomplete.status_code == 422 and incomplete.json()["error_code"] == "POST_INCOMPLETE"
    assert (await client.post("/admin/posts", json=_post(), headers=admin)).status_code == 201
    taken = await client.post("/admin/posts", json=_post(), headers=admin)
    assert taken.status_code == 409 and taken.json()["error_code"] == "POST_SLUG_TAKEN"
    assert (await client.put("/admin/posts/999999", json=_post(), headers=admin)).status_code == 404


@pytest.mark.asyncio
async def test_cover_image_and_delete(client):
    admin = await _headers(client, "blog-admin3@example.com", "admin")
    buyer = await _headers(client, "blog-buyer3@example.com")
    assert (await _upload(client, buyer, "post_cover")).status_code == 403
    upload = await _upload(client, admin, "post_cover")
    assert upload.status_code in (200, 201), upload.text
    created = (await client.post(
        "/admin/posts", json=_post(publish=True, cover_image_id=upload.json()["id"]), headers=admin,
    )).json()
    assert created["cover"]["url"]
    listed = (await client.get("/public/posts")).json()["items"][0]
    assert listed["cover"]["url"] == created["cover"]["url"]

    assert (await client.delete(f"/admin/posts/{created['id']}", headers=admin)).status_code == 204
    assert (await client.get("/public/posts")).json()["total"] == 0


@pytest.mark.asyncio
async def test_scheduled_post_stays_private_until_its_time(client):
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import update

    from src.database import SessionLocal
    from src.models.post import Post

    admin = await _headers(client, "blog-admin4@example.com", "admin")
    later = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    created = await client.post("/admin/posts", json=_post(publish=True, published_at=later), headers=admin)
    assert created.status_code == 201, created.text
    post = created.json()
    assert post["status"] == "published" and post["scheduled"] is True
    # Not in the list, not by slug, and not in the sitemap (F35).
    assert (await client.get("/public/posts")).json()["total"] == 0
    assert (await client.get("/public/posts/huong-dan-nap-tien")).status_code == 404
    assert (await client.get("/public/post-slugs")).json() == []
    # Editing without a time keeps the schedule.
    edited = await client.put(f"/admin/posts/{post['id']}", json=_post(publish=True), headers=admin)
    assert edited.json()["scheduled"] is True and edited.json()["published_at"] == post["published_at"]

    # The clock passes the scheduled time: public without any job.
    async with SessionLocal() as db:
        await db.execute(
            update(Post).where(Post.id == post["id"]).values(published_at=datetime.now(timezone.utc) - timedelta(minutes=1))
        )
        await db.commit()
    assert (await client.get("/public/posts")).json()["total"] == 1
    assert (await client.get("/public/posts/huong-dan-nap-tien")).status_code == 200
    assert [p["slug"] for p in (await client.get("/public/post-slugs")).json()] == ["huong-dan-nap-tien"]
    assert (await client.get("/admin/posts", headers=admin)).json()[0]["scheduled"] is False


@pytest.mark.asyncio
async def test_meta_fields_tags_and_canonical(client):
    admin = await _headers(client, "blog-admin5@example.com", "admin")
    body = _post(
        publish=True,
        vi={"title": "Hướng dẫn nạp tiền", "excerpt": "Ba bước.", "body": "Nội dung", "meta_title": " Nạp tiền nhanh ",
            "meta_description": ""},
        en={"title": "Top up", "excerpt": "", "body": "", "meta_title": "", "meta_description": "Top up your wallet."},
        tags=["Proxy", " proxy ", "TikTok  shadowban"],
        canonical_url="https://example.com/original",
    )
    created = await client.post("/admin/posts", json=body, headers=admin)
    assert created.status_code == 201, created.text
    assert created.json()["tags"] == ["proxy", "tiktok shadowban"]
    assert created.json()["vi"]["meta_title"] == "Nạp tiền nhanh"

    vi = (await client.get("/public/posts/huong-dan-nap-tien?locale=vi")).json()
    assert vi["seo"] == {"meta_title": "Nạp tiền nhanh", "meta_description": "Ba bước.", "canonical_url": "https://example.com/original"}
    assert vi["tags"] == ["proxy", "tiktok shadowban"]
    en = (await client.get("/public/posts/huong-dan-nap-tien?locale=en")).json()
    # en meta_title is empty: the en title; en meta_description is its own.
    assert en["seo"]["meta_title"] == "Top up" and en["seo"]["meta_description"] == "Top up your wallet."


@pytest.mark.asyncio
@pytest.mark.parametrize("over", [
    {"vi": {"title": "T", "excerpt": "", "body": "B", "meta_title": "x" * 71}},
    {"vi": {"title": "T", "excerpt": "", "body": "B", "meta_description": "x" * 171}},
    {"tags": ["x" * 41]},
    {"tags": [f"t{i}" for i in range(11)]},
    {"canonical_url": "javascript:alert(1)"},
    {"canonical_url": "/vi/blog/relative"},
])
async def test_seo_field_validation(client, over):
    admin = await _headers(client, "blog-admin6@example.com", "admin")
    assert (await client.post("/admin/posts", json=_post(**over), headers=admin)).status_code == 422
