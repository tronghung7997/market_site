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
