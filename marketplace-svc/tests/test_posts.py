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
