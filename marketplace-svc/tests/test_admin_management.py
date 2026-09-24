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


# ── Feature A2: bulk product actions, audit trail, list columns ───────

@pytest.mark.asyncio
async def test_admin_bulk_status_logs_history_and_reports_skips(client):
    admin_token, seller_token, product_id = await _seller_product(client)
    admin = {"Authorization": f"Bearer {admin_token}"}

    paused = await client.post("/admin/products/bulk", json={
        "ids": [product_id, product_id, 999999], "action": "pause", "reason": "Kiểm tra nội dung",
    }, headers=admin)
    assert paused.status_code == 200
    body = paused.json()
    assert body["updated"] == [product_id]
    assert body["skipped"] == [{"id": 999999, "reason": "not_found"}]
    assert (await client.get(f"/admin/products/{product_id}", headers=admin)).json()["status"] == "paused"

    again = await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "pause"}, headers=admin)
    assert again.json() == {"updated": [], "skipped": [{"id": product_id, "reason": "unchanged"}]}

    history = await client.get(f"/admin/products/{product_id}/activity", headers=admin)
    assert history.status_code == 200
    first = history.json()[0]
    assert first["event"] == "admin_product_status_changed"
    assert first["actor_email"] == "mgmt_a_admin@example.com"
    assert first["details"]["from"] == "draft"
    assert first["details"]["to"] == "paused"
    assert first["details"]["reason"] == "Kiểm tra nội dung"
    assert "ip" not in first["details"]


@pytest.mark.asyncio
async def test_admin_bulk_moves_category_and_validates_input(client):
    admin_token, _, product_id = await _seller_product(client)
    admin = {"Authorization": f"Bearer {admin_token}"}
    await client.post("/admin/categories", json={"name": "MgmtCat2", "slug": "mgmtcat2"}, headers=admin)
    target = next(c for c in (await client.get("/categories")).json() if c["slug"] == "mgmtcat2")

    missing = await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "set_category"}, headers=admin)
    assert missing.status_code == 422
    bogus = await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "delete"}, headers=admin)
    assert bogus.status_code == 422
    empty = await client.post("/admin/products/bulk", json={"ids": [], "action": "pause"}, headers=admin)
    assert empty.status_code == 422

    moved = await client.post("/admin/products/bulk", json={
        "ids": [product_id], "action": "set_category", "category_id": target["id"],
    }, headers=admin)
    assert moved.status_code == 200
    assert moved.json()["updated"] == [product_id]

    listed = await client.get("/admin/products", params={"search": "Original"}, headers=admin)
    row = next(item for item in listed.json()["items"] if item["id"] == product_id)
    assert row["category_id"] == target["id"]
    assert row["category_name"] == "MgmtCat2"
    assert row["variant_count"] == 0
    assert "price_from" in row and "stock_count" in row and "strategy_name" in row


@pytest.mark.asyncio
async def test_admin_bulk_and_activity_require_admin(client):
    _, seller_token, product_id = await _seller_product(client)
    seller = {"Authorization": f"Bearer {seller_token}"}
    denied = await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "suspend"}, headers=seller)
    assert denied.status_code == 403
    assert (await client.get(f"/admin/products/{product_id}/activity", headers=seller)).status_code == 403
    assert (await client.post("/admin/products/bulk", json={"ids": [product_id], "action": "suspend"})).status_code == 401


@pytest.mark.asyncio
async def test_admin_patch_rejects_unknown_status_and_suspend_records_reason(client):
    admin_token, _, product_id = await _seller_product(client)
    admin = {"Authorization": f"Bearer {admin_token}"}
    bad = await client.patch(f"/admin/products/{product_id}", json={"status": "deleted"}, headers=admin)
    assert bad.status_code == 422

    suspended = await client.post(
        f"/admin/products/{product_id}/suspend", json={"reason": "Vi phạm chính sách"}, headers=admin,
    )
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "suspended"
    no_body = await client.post(f"/admin/products/{product_id}/suspend", headers=admin)
    assert no_body.status_code == 200

    edited = await client.patch(f"/admin/products/{product_id}", json={"title": "Renamed"}, headers=admin)
    assert edited.status_code == 200
    events = [e["event"] for e in (await client.get(f"/admin/products/{product_id}/activity", headers=admin)).json()]
    assert events[:2] == ["admin_product_content_updated", "admin_product_status_changed"]


@pytest.mark.asyncio
async def test_admin_translation_edit_logs_only_changed_fields(client):
    admin_token, _, product_id = await _seller_product(client)
    admin = {"Authorization": f"Bearer {admin_token}"}
    await client.patch(f"/admin/products/{product_id}/translations/vi", json={
        "title": "Original", "description": "Mô tả mới",
    }, headers=admin)
    # Lưu lại y nguyên thì không sinh thêm dòng lịch sử.
    await client.patch(f"/admin/products/{product_id}/translations/vi", json={
        "title": "Original", "description": "Mô tả mới",
    }, headers=admin)
    escrow = (await client.get(f"/admin/products/{product_id}", headers=admin)).json()["escrow_days"]
    await client.patch(f"/admin/products/{product_id}", json={"escrow_days": escrow}, headers=admin)

    history = (await client.get(f"/admin/products/{product_id}/activity", headers=admin)).json()
    content = [e for e in history if e["event"] == "admin_product_content_updated"]
    assert len(content) == 1
    assert content[0]["details"] == {"fields": ["description"], "locale": "vi"}


@pytest.mark.asyncio
async def test_hidden_product_preview_is_owner_and_admin_only(client):
    admin_token, seller_token, product_id = await _seller_product(client)   # status draft
    admin = {"Authorization": f"Bearer {admin_token}"}
    seller = {"Authorization": f"Bearer {seller_token}"}
    ref = (await client.get(f"/admin/products/{product_id}", headers=admin)).json()["public_key"]

    # Khách và mọi người khác vẫn thấy 404 như trước.
    assert (await client.get(f"/products/{ref}")).status_code == 404

    own = await client.get(f"/seller/products/{ref}/preview", headers=seller)
    assert own.status_code == 200
    assert own.json()["id"] == product_id
    assert own.json()["status"] == "draft"

    by_admin = await client.get(f"/admin/products/{ref}/preview", headers=admin)
    assert by_admin.status_code == 200
    assert by_admin.json()["title"] == "Original"

    await register_and_login(client, "mgmt_other_seller@example.com")
    await make_seller("mgmt_other_seller@example.com")
    other = {"Authorization": f"Bearer {await register_and_login(client, 'mgmt_other_seller@example.com')}"}
    assert (await client.get(f"/seller/products/{ref}/preview", headers=other)).status_code == 404
    assert (await client.get(f"/admin/products/{ref}/preview", headers=seller)).status_code == 403

    buyer = {"Authorization": f"Bearer {await register_and_login(client, 'mgmt_preview_buyer@example.com')}"}
    assert (await client.get(f"/seller/products/{ref}/preview", headers=buyer)).status_code == 403
    assert (await client.get(f"/seller/products/{ref}/preview")).status_code == 401
