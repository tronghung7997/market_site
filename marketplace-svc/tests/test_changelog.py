"""Admin changelog: CRUD, publish stamps, unread marker, validation, auth."""
import pytest

from tests.conftest import make_admin, register_and_login


async def _admin(client, email: str):
    await register_and_login(client, email)
    await make_admin(email)
    token = await register_and_login(client, email)
    return {"Authorization": f"Bearer {token}"}


def _body(**over):
    body = {
        "version": "v1.42",
        "released_on": "2026-10-05",
        "title": "Báo cáo doanh thu không còn lẫn đơn thử nghiệm",
        "items": [
            {"kind": "new", "text": "Chuyển nguồn hàng giữa shop", "audience": ["admin"]},
            {"kind": "fixed", "text": "Sổ nhật ký bỏ qua đơn thử", "audience": ["accounting"]},
        ],
        "dev_notes": "0a7a0d2 feat(admin): retire seed accounts",
        "status": "published",
    }
    body.update(over)
    return body


@pytest.mark.asyncio
async def test_publish_unread_and_mark_seen(client):
    a = await _admin(client, "cl-a@test.com")
    b = await _admin(client, "cl-b@test.com")

    created = await client.post("/admin/changelog", json=_body(), headers=a)
    assert created.status_code == 201, created.text
    rel = created.json()
    assert rel["published_at"] and rel["status"] == "published"
    assert rel["author"] and rel["items"][0]["kind"] == "new"

    draft = await client.post("/admin/changelog", json=_body(version="v1.43", status="draft"), headers=a)
    assert draft.status_code == 201 and draft.json()["published_at"] is None

    latest = await client.get("/admin/changelog/latest", headers=b)
    assert latest.status_code == 200
    assert [r["version"] for r in latest.json()["items"]] == ["v1.42"]  # drafts never in the popover
    assert latest.json()["unread_count"] == 1 and latest.json()["items"][0]["unread"] is True

    full = (await client.get("/admin/changelog", headers=b)).json()
    assert [r["version"] for r in full["items"]] == ["v1.43", "v1.42"]  # drafts first

    assert (await client.post("/admin/changelog/seen", headers=b)).status_code == 204
    after = (await client.get("/admin/changelog/latest", headers=b)).json()
    assert after["unread_count"] == 0 and after["items"][0]["unread"] is False
    # Marker is per admin.
    assert (await client.get("/admin/changelog/latest", headers=a)).json()["unread_count"] == 1

    published = await client.patch(f"/admin/changelog/{draft.json()['id']}", json={"status": "published"}, headers=a)
    assert published.status_code == 200 and published.json()["published_at"]
    assert (await client.get("/admin/changelog/latest", headers=b)).json()["unread_count"] == 1


@pytest.mark.asyncio
async def test_update_delete_and_validation(client):
    a = await _admin(client, "cl-c@test.com")
    rel = (await client.post("/admin/changelog", json=_body(), headers=a)).json()

    dup = await client.post("/admin/changelog", json=_body(version="V1.42"), headers=a)
    assert dup.status_code == 409

    bad_kind = await client.post("/admin/changelog", json=_body(version="v2", items=[{"kind": "x", "text": "y"}]), headers=a)
    assert bad_kind.status_code == 422
    blank = await client.post("/admin/changelog", json=_body(version="v3", items=[{"kind": "new", "text": "  "}]), headers=a)
    assert blank.status_code == 422
    bad_version = await client.post("/admin/changelog", json=_body(version="v 4"), headers=a)
    assert bad_version.status_code == 422

    edited = await client.patch(f"/admin/changelog/{rel['id']}", json={"title": "Mới", "status": "draft"}, headers=a)
    assert edited.status_code == 200
    assert edited.json()["title"] == "Mới" and edited.json()["published_at"] == rel["published_at"]

    assert (await client.delete(f"/admin/changelog/{rel['id']}", headers=a)).status_code == 204
    assert (await client.patch(f"/admin/changelog/{rel['id']}", json={"title": "x"}, headers=a)).status_code == 404


@pytest.mark.asyncio
async def test_changelog_requires_admin(client):
    assert (await client.get("/admin/changelog")).status_code in (401, 403)
    buyer = {"Authorization": f"Bearer {await register_and_login(client, 'cl-buyer@test.com')}"}
    assert (await client.get("/admin/changelog/latest", headers=buyer)).status_code == 403
    assert (await client.post("/admin/changelog", json=_body(), headers=buyer)).status_code == 403
    assert (await client.post("/admin/changelog/seen", headers=buyer)).status_code == 403
