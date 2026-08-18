import pytest

from tests.conftest import make_admin, make_seller, register_and_login


async def _admin(client, email="mgmt_admin@example.com"):
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


# ── Feature A: admin edits product content + status ──────────────────

async def _seller_product(client):
    admin_token = await _admin(client, "mgmt_a_admin@example.com")
    await client.post("/admin/categories", json={"name": "MgmtCat", "slug": "mgmtcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cat_id = (await client.get("/categories")).json()[-1]["id"]

    seller_token = await register_and_login(client, "mgmt_seller@example.com")
    await make_seller("mgmt_seller@example.com")
    seller_token = await register_and_login(client, "mgmt_seller@example.com")
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Original", "status": "draft",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    return admin_token, seller_token, product.json()["id"]


@pytest.mark.asyncio
async def test_admin_updates_any_product_content_and_status(client):
    admin_token, _, product_id = await _seller_product(client)
    resp = await client.patch(f"/admin/products/{product_id}", json={
        "title": "Edited by admin", "description": "moderated", "status": "active",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200

    detail = await client.get(f"/products/{product_id}")
    assert detail.json()["title"] == "Edited by admin"
    assert detail.json()["description"] == "moderated"
    assert detail.json()["status"] == "active"


@pytest.mark.asyncio
async def test_admin_product_update_requires_admin(client):
    _, seller_token, product_id = await _seller_product(client)
    resp = await client.patch(f"/admin/products/{product_id}", json={"title": "hack"},
                              headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_seller_updates_english_translation_without_overwriting_vi(client):
    admin_token, seller_token, product_id = await _seller_product(client)
    headers = {"Authorization": f"Bearer {seller_token}"}

    translated = await client.patch(
        f"/seller/products/{product_id}/translations/en",
        json={
            "title": "English product title",
            "description": "English product description",
            "features": ["English feature"],
        },
        headers=headers,
    )
    assert translated.status_code == 200

    management = await client.get(
        f"/seller/products/{product_id}/detail", headers=headers,
    )
    body = management.json()
    assert body["title"] == "Original"
    assert body["translations"]["vi"]["title"] == "Original"
    assert body["translations"]["en"]["title"] == "English product title"
    assert set(body["available_locales"]) == {"en", "vi"}

    await client.patch(
        f"/admin/products/{product_id}",
        json={"status": "active"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    en = await client.get(
        f"/products/{product_id}", headers={"Accept-Language": "en"},
    )
    vi = await client.get(
        f"/products/{product_id}", headers={"Accept-Language": "vi"},
    )
    assert en.json()["title"] == "English product title"
    assert vi.json()["title"] == "Original"


@pytest.mark.asyncio
async def test_admin_updates_translation_and_seller_cannot_use_admin_route(client):
    admin_token, seller_token, product_id = await _seller_product(client)
    denied = await client.patch(
        f"/admin/products/{product_id}/translations/en",
        json={"title": "Not allowed"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert denied.status_code == 403

    updated = await client.patch(
        f"/admin/products/{product_id}/translations/en",
        json={"title": "Admin English title"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert updated.status_code == 200

    detail = await client.get(
        f"/admin/products/{product_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert detail.json()["translations"]["en"]["title"] == "Admin English title"


# ── Feature B: account & role management ─────────────────────────────

@pytest.mark.asyncio
async def test_admin_lists_accounts(client):
    admin_token = await _admin(client, "mgmt_b_admin@example.com")
    await register_and_login(client, "listed_user@example.com")

    resp = await client.get("/admin/accounts?search=listed_user",
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 1
    assert any(u["email"] == "listed_user@example.com" for u in body["items"])


@pytest.mark.asyncio
async def test_admin_grants_and_revokes_roles(client):
    admin_token = await _admin(client, "mgmt_c_admin@example.com")
    reg = await client.post("/auth/register", json={"email": "role_target@example.com", "password": "StrongPass123!"})
    uid = reg.json()["id"]

    grant = await client.patch(f"/admin/accounts/{uid}/roles", json={"roles": ["buyer", "seller"]},
                               headers={"Authorization": f"Bearer {admin_token}"})
    assert grant.status_code == 200
    assert set(grant.json()["roles"]) == {"buyer", "seller"}

    revoke = await client.patch(f"/admin/accounts/{uid}/roles", json={"roles": ["buyer"]},
                                headers={"Authorization": f"Bearer {admin_token}"})
    assert set(revoke.json()["roles"]) == {"buyer"}


@pytest.mark.asyncio
async def test_role_update_rejects_invalid_role(client):
    admin_token = await _admin(client, "mgmt_d_admin@example.com")
    reg = await client.post("/auth/register", json={"email": "role_bad@example.com", "password": "StrongPass123!"})
    resp = await client.patch(f"/admin/accounts/{reg.json()['id']}/roles", json={"roles": ["wizard"]},
                              headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_admin_cannot_self_remove_admin(client):
    admin_token = await _admin(client, "mgmt_e_admin@example.com")
    me = await client.get("/me", headers={"Authorization": f"Bearer {admin_token}"})
    resp = await client.patch(f"/admin/accounts/{me.json()['id']}/roles", json={"roles": ["buyer"]},
                              headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_accounts_endpoints_require_admin(client):
    token = await register_and_login(client, "mgmt_nonadmin@example.com")
    assert (await client.get("/admin/accounts", headers={"Authorization": f"Bearer {token}"})).status_code == 403
    me = await client.get("/me", headers={"Authorization": f"Bearer {token}"})
    resp = await client.patch(f"/admin/accounts/{me.json()['id']}/roles", json={"roles": ["admin"]},
                              headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
