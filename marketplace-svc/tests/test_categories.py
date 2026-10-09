import pytest
from tests.conftest import make_admin, register_and_login


@pytest.mark.asyncio
async def test_list_categories_public(client):
    resp = await client.get("/categories")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_create_category_requires_admin(client):
    token = await register_and_login(client, "cat_nonadmin@example.com")
    resp = await client.post("/admin/categories", json={"name": "Test", "slug": "test"},
                             headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_root_category(client):
    token = await register_and_login(client, "cat_admin@example.com")
    await make_admin("cat_admin@example.com")
    token = await register_and_login(client, "cat_admin@example.com")
    resp = await client.post("/admin/categories", json={"name": "Twitter", "slug": "twitter"},
                             headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Twitter"
    assert resp.json()["parent_id"] is None


@pytest.mark.asyncio
async def test_create_child_category(client):
    token = await register_and_login(client, "cat_admin2@example.com")
    await make_admin("cat_admin2@example.com")
    token = await register_and_login(client, "cat_admin2@example.com")

    parent = await client.post("/admin/categories", json={"name": "Telegram", "slug": "telegram"},
                               headers={"Authorization": f"Bearer {token}"})
    parent_id = parent.json()["id"]

    child = await client.post("/admin/categories", json={"name": "Telegram USA", "slug": "telegram-usa", "parent_id": parent_id},
                              headers={"Authorization": f"Bearer {token}"})
    assert child.status_code == 201
    assert child.json()["parent_id"] == parent_id


@pytest.mark.asyncio
async def test_list_categories_returns_tree(client):
    resp = await client.get("/categories")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_category_commission_rate_persisted_on_create(client):
    token = await register_and_login(client, "cat_cr_admin@example.com")
    await make_admin("cat_cr_admin@example.com")
    token = await register_and_login(client, "cat_cr_admin@example.com")
    resp = await client.post("/admin/categories", json={
        "name": "CR Cat", "slug": "cr-cat", "commission_rate": 6.5,
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    assert resp.json()["commission_rate"] == 6.5


@pytest.mark.asyncio
async def test_category_commission_rate_update_persists(client):
    token = await register_and_login(client, "cat_cr_admin2@example.com")
    await make_admin("cat_cr_admin2@example.com")
    token = await register_and_login(client, "cat_cr_admin2@example.com")
    cat = await client.post("/admin/categories", json={
        "name": "CR Upd", "slug": "cr-upd",
    }, headers={"Authorization": f"Bearer {token}"})
    cat_id = cat.json()["id"]
    assert cat.json()["commission_rate"] is None

    resp = await client.patch(f"/admin/categories/{cat_id}", json={
        "commission_rate": 8.0,
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["commission_rate"] == 8.0


@pytest.mark.asyncio
async def test_category_commission_rate_left_untouched_when_omitted(client):
    token = await register_and_login(client, "cat_cr_admin3@example.com")
    await make_admin("cat_cr_admin3@example.com")
    token = await register_and_login(client, "cat_cr_admin3@example.com")
    cat = await client.post("/admin/categories", json={
        "name": "CR Keep", "slug": "cr-keep", "commission_rate": 4.0,
    }, headers={"Authorization": f"Bearer {token}"})
    cat_id = cat.json()["id"]

    resp = await client.patch(f"/admin/categories/{cat_id}", json={
        "name": "CR Keep Renamed",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["commission_rate"] == 4.0


@pytest.mark.asyncio
async def test_category_icon_allowlist_and_clear(client):
    token = await register_and_login(client, "cat_icon_admin@example.com")
    await make_admin("cat_icon_admin@example.com")
    token = await register_and_login(client, "cat_icon_admin@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    created = await client.post("/admin/categories", json={
        "name": "Icon Cat", "slug": "icon-cat-facebook-allowlist", "icon": "facebook",
    }, headers=headers)
    assert created.status_code == 201
    assert created.json()["icon"] == "facebook"
    cat_id = created.json()["id"]

    listed = await client.get("/categories")
    assert listed.status_code == 200
    assert any(row["id"] == cat_id and row["icon"] == "facebook" for row in listed.json())

    rejected = await client.post("/admin/categories", json={
        "name": "Bad Icon", "slug": "bad-icon", "icon": "https://evil.example/x.png",
    }, headers=headers)
    assert rejected.status_code == 422

    cleared = await client.patch(f"/admin/categories/{cat_id}", json={"icon": None}, headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["icon"] is None


NO_SEO = {"seo_title": None, "seo_description": None, "intro": None}


async def _content_admin(client, email="cat_content_admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return {"Authorization": f"Bearer {await register_and_login(client, email)}"}


@pytest.mark.asyncio
async def test_category_page_content_per_language_with_english_falling_back(client):
    admin = await _content_admin(client)
    cat = (await client.post("/admin/categories", json={"name": "Proxy", "slug": "proxy-content"}, headers=admin)).json()

    empty = await client.get("/categories/proxy-content/content")
    assert empty.status_code == 200
    assert empty.json() == {"slug": "proxy-content", "locale": "en", "description": None, "guide": None, "faq": None, **NO_SEO}

    saved = await client.patch(f"/admin/categories/{cat['id']}", json={"content": {
        "vi": {
            "description": "  Proxy dân cư và datacenter  ",
            "guide": "## Nên chọn gói nào?\nDân cư cho tài khoản.",
            "faq": [{"q": "Xoay IP được không?", "a": "Được, theo gói."}, {"q": " ", "a": "blank rows are dropped"}],
        },
        "en": {"description": "Residential and datacenter proxies"},
    }}, headers=admin)
    assert saved.status_code == 200, saved.text

    vi = (await client.get("/categories/proxy-content/content", params={"locale": "vi"})).json()
    assert vi["description"] == "Proxy dân cư và datacenter"
    assert vi["faq"] == [{"q": "Xoay IP được không?", "a": "Được, theo gói."}]
    en = (await client.get("/categories/proxy-content/content", params={"locale": "en"})).json()
    assert en["description"] == "Residential and datacenter proxies"
    assert en["guide"].startswith("## Nên chọn gói nào?")  # no English guide yet → Vietnamese
    assert (await client.get(f"/categories/{cat['id']}/content")).status_code == 200

    stored = (await client.get(f"/admin/categories/{cat['id']}/content", headers=admin)).json()
    assert stored["en"] == {"description": "Residential and datacenter proxies", "guide": None, "faq": None, **NO_SEO}
    assert stored["vi"]["guide"].startswith("## Nên")

    # A locale sent again replaces that language as a whole; the name is untouched.
    await client.patch(f"/admin/categories/{cat['id']}", json={"content": {"vi": {"description": "Chỉ mô tả"}}}, headers=admin)
    vi = (await client.get("/categories/proxy-content/content", params={"locale": "vi"})).json()
    assert vi == {"slug": "proxy-content", "locale": "vi", "description": "Chỉ mô tả", "guide": None, "faq": None, **NO_SEO}
    names = [c["name"] for c in (await client.get("/categories", params={"locale": "vi"})).json()]
    assert "Proxy" in names


@pytest.mark.asyncio
async def test_category_content_validation_access_and_hidden_categories(client):
    admin = await _content_admin(client, "cat_content_admin2@example.com")
    cat = (await client.post("/admin/categories", json={"name": "Mail", "slug": "mail-content"}, headers=admin)).json()
    too_long = await client.patch(f"/admin/categories/{cat['id']}", json={"content": {"vi": {"description": "x" * 301}}}, headers=admin)
    assert too_long.status_code == 422
    bad_locale = await client.patch(f"/admin/categories/{cat['id']}", json={"content": {"fr": {"description": "x"}}}, headers=admin)
    assert bad_locale.status_code == 422
    too_many = await client.patch(f"/admin/categories/{cat['id']}", json={"content": {"vi": {
        "faq": [{"q": f"q{i}", "a": "a"} for i in range(13)],
    }}}, headers=admin)
    assert too_many.status_code == 422

    buyer = {"Authorization": f"Bearer {await register_and_login(client, 'cat_content_buyer@example.com')}"}
    assert (await client.get(f"/admin/categories/{cat['id']}/content", headers=buyer)).status_code == 403
    assert (await client.patch(f"/admin/categories/{cat['id']}", json={"content": {"vi": {"description": "x"}}}, headers=buyer)).status_code == 403

    await client.patch(f"/admin/categories/{cat['id']}", json={"is_active": False}, headers=admin)
    assert (await client.get("/categories/mail-content/content")).status_code == 404
    assert (await client.get("/categories/no-such-slug/content")).status_code == 404


@pytest.mark.asyncio
async def test_category_seo_fields_never_borrow_the_other_language(client):
    admin = await _content_admin(client, "cat_seo_admin@example.com")
    cat = (await client.post("/admin/categories", json={"name": "Proxy tĩnh", "slug": "proxy-tinh"}, headers=admin)).json()
    saved = await client.patch(f"/admin/categories/{cat['id']}", json={"content": {
        "vi": {"seo_title": " Thuê proxy tĩnh giá rẻ ", "seo_description": "Proxy tĩnh IPv4 dân cư.", "intro": "**Proxy tĩnh** giữ một IP."},
        "en": {"seo_title": "Static proxies"},
    }}, headers=admin)
    assert saved.status_code == 200, saved.text
    vi = (await client.get("/categories/proxy-tinh/content", params={"locale": "vi"})).json()
    assert vi["seo_title"] == "Thuê proxy tĩnh giá rẻ" and vi["intro"] == "**Proxy tĩnh** giữ một IP."
    en = (await client.get("/categories/proxy-tinh/content", params={"locale": "en"})).json()
    assert en["seo_title"] == "Static proxies"
    # Head tags stay empty instead of Vietnamese; body copy still falls back.
    assert en["seo_description"] is None
    assert en["intro"] == "**Proxy tĩnh** giữ một IP."

    for field, size in (("seo_title", 71), ("seo_description", 171), ("intro", 2001)):
        too_long = await client.patch(f"/admin/categories/{cat['id']}", json={"content": {"vi": {field: "x" * size}}}, headers=admin)
        assert too_long.status_code == 422, field


@pytest.mark.asyncio
async def test_renamed_slug_redirects_and_live_slug_wins(client):
    admin = await _content_admin(client, "cat_redirect_admin@example.com")
    root = (await client.post("/admin/categories", json={"name": "Mạng xã hội", "slug": "social"}, headers=admin)).json()
    assert (await client.get("/categories/social/redirect")).status_code == 404

    renamed = await client.patch(f"/admin/categories/{root['id']}", json={"slug": "accounts"}, headers=admin)
    assert renamed.status_code == 200, renamed.text
    assert (await client.get("/categories/social/redirect")).json() == {"slug": "accounts"}
    # A second rename keeps the oldest URL working (no chain to follow).
    await client.patch(f"/admin/categories/{root['id']}", json={"slug": "tai-khoan"}, headers=admin)
    assert (await client.get("/categories/social/redirect")).json() == {"slug": "tai-khoan"}
    assert (await client.get("/categories/accounts/redirect")).json() == {"slug": "tai-khoan"}
    assert (await client.get("/categories/redirects")).json() == [
        {"slug": "tai-khoan", "old_slug": "accounts"}, {"slug": "tai-khoan", "old_slug": "social"},
    ]
    # Hidden target: no redirect (its page is a 404 too).
    await client.patch(f"/admin/categories/{root['id']}", json={"is_active": False}, headers=admin)
    assert (await client.get("/categories/social/redirect")).status_code == 404
    assert (await client.get("/categories/redirects")).json() == []
    await client.patch(f"/admin/categories/{root['id']}", json={"is_active": True}, headers=admin)

    # A new category taking an old slug owns it again.
    await client.post("/admin/categories", json={"name": "Social mới", "slug": "social"}, headers=admin)
    assert (await client.get("/categories/social/redirect")).status_code == 404
    assert (await client.get("/categories/accounts/redirect")).json() == {"slug": "tai-khoan"}

    # Deleting a sub-category sends its URLs to the parent.
    child = (await client.post("/admin/categories", json={"name": "Threads", "slug": "threads-old", "parent_id": root["id"]}, headers=admin)).json()
    await client.patch(f"/admin/categories/{child['id']}", json={"slug": "threads"}, headers=admin)
    assert (await client.delete(f"/admin/categories/{child['id']}", headers=admin)).status_code == 204
    assert (await client.get("/categories/threads/redirect")).json() == {"slug": "tai-khoan"}
    assert (await client.get("/categories/threads-old/redirect")).json() == {"slug": "tai-khoan"}

    buyer = {"Authorization": f"Bearer {await register_and_login(client, 'cat_redirect_buyer@example.com')}"}
    assert (await client.patch(f"/admin/categories/{root['id']}", json={"slug": "hijack"}, headers=buyer)).status_code == 403
    assert (await client.get("/categories/tai-khoan/redirect")).status_code == 404
