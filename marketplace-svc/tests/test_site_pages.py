"""Admin-editable footer pages: public read, locale fallback, admin CRUD, auth."""
import pytest

from src.database import SessionLocal
from src.site_pages.service import seed_defaults
from tests.conftest import make_admin, register_and_login


@pytest.fixture
async def seeded():
    async with SessionLocal() as db:
        await seed_defaults(db)
        await db.commit()


async def _admin(client, email: str):
    await register_and_login(client, email)
    await make_admin(email)
    token = await register_and_login(client, email)
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_public_links_and_page_with_locale_fallback(client, seeded):
    links = await client.get("/public/site-pages", headers={"Accept-Language": "vi"})
    assert links.status_code == 200, links.text
    assert [row["slug"] for row in links.json()] == ["terms", "warranty", "refund", "escrow", "dispute", "privacy"]
    assert links.json()[0]["title"] == "Điều khoản sử dụng"

    en = await client.get("/public/site-pages/warranty", headers={"Accept-Language": "en"})
    assert en.status_code == 200
    assert en.json()["title"] == "Warranty policy"
    assert en.json()["body"].startswith("## General rules")

    missing = await client.get("/public/site-pages/nope")
    assert missing.status_code == 404

    headers = await _admin(client, "pages-admin@test.com")
    blanked = await client.patch(
        "/admin/site-pages/warranty", json={"title_en": "", "body_en": ""}, headers=headers,
    )
    assert blanked.status_code == 200, blanked.text
    fallback = await client.get("/public/site-pages/warranty", headers={"Accept-Language": "en"})
    assert fallback.json()["title"] == "Chính sách bảo hành"
    assert fallback.json()["body"].startswith("## Quy định chung")


@pytest.mark.asyncio
async def test_admin_endpoints_require_admin(client, seeded):
    anon = await client.get("/admin/site-pages")
    assert anon.status_code in (401, 403)
    buyer = await register_and_login(client, "pages-buyer@test.com")
    forbidden = await client.patch(
        "/admin/site-pages/terms", json={"body_vi": "x"},
        headers={"Authorization": f"Bearer {buyer}"},
    )
    assert forbidden.status_code == 403


@pytest.mark.asyncio
async def test_admin_crud_reset_and_footer_visibility(client, seeded):
    headers = await _admin(client, "pages-admin2@test.com")

    listing = await client.get("/admin/site-pages", headers=headers)
    assert listing.status_code == 200
    terms = next(row for row in listing.json()["items"] if row["slug"] == "terms")
    assert terms["is_system"] is True and terms["customized"] is False

    edited = await client.patch(
        "/admin/site-pages/terms", json={"body_vi": "## Mới\n\nNội dung mới."}, headers=headers,
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["customized"] is True
    public = await client.get("/public/site-pages/terms", headers={"Accept-Language": "vi"})
    assert public.json()["body"] == "## Mới\n\nNội dung mới."

    empty = await client.patch("/admin/site-pages/terms", json={"body_vi": "   "}, headers=headers)
    assert empty.status_code == 422

    reset = await client.post("/admin/site-pages/terms/reset", headers=headers)
    assert reset.status_code == 200
    assert reset.json()["customized"] is False

    created = await client.post(
        "/admin/site-pages",
        json={"slug": "faq", "title_vi": "Câu hỏi thường gặp", "body_vi": "Hỏi & đáp", "sort_order": 5},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["is_system"] is False
    dup = await client.post(
        "/admin/site-pages", json={"slug": "faq", "title_vi": "x", "body_vi": "y"}, headers=headers,
    )
    assert dup.status_code == 409
    bad_slug = await client.post(
        "/admin/site-pages", json={"slug": "Bad Slug", "title_vi": "x", "body_vi": "y"}, headers=headers,
    )
    assert bad_slug.status_code == 422

    links = await client.get("/public/site-pages")
    assert [row["slug"] for row in links.json()][0] == "faq"

    hidden = await client.patch("/admin/site-pages/faq", json={"show_in_footer": False}, headers=headers)
    assert hidden.status_code == 200
    links = await client.get("/public/site-pages")
    assert "faq" not in [row["slug"] for row in links.json()]
    still_readable = await client.get("/public/site-pages/faq")
    assert still_readable.status_code == 200

    no_reset = await client.post("/admin/site-pages/faq/reset", headers=headers)
    assert no_reset.status_code == 422

    protected = await client.delete("/admin/site-pages/terms", headers=headers)
    assert protected.status_code == 422
    deleted = await client.delete("/admin/site-pages/faq", headers=headers)
    assert deleted.status_code == 204
    gone = await client.get("/public/site-pages/faq")
    assert gone.status_code == 404
