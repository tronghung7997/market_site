import pytest
from tests.conftest import make_admin, make_seller, register_and_login

INTERNAL_HEADERS = {"X-Internal-Key": "test-internal-key"}


async def setup_variant(client):
    admin_token = await register_and_login(client, "res_admin@example.com")
    await make_admin("res_admin@example.com")
    admin_token = await register_and_login(client, "res_admin@example.com")

    await client.post("/admin/categories", json={"name": "ResCat", "slug": "rescat"},
                      headers={"Authorization": f"Bearer {admin_token}"})

    seller_token = await register_and_login(client, "res_seller@example.com")
    await make_seller("res_seller@example.com")
    seller_token = await register_and_login(client, "res_seller@example.com")

    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Resource Test Product", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    variant = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Test Variant", "price": 1000, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    variant_id = variant.json()["id"]

    return seller_token, variant_id


@pytest.mark.asyncio
async def test_bulk_add_resources(client):
    seller_token, variant_id = await setup_variant(client)
    resp = await client.post(f"/seller/variants/{variant_id}/resources", json={
        "items": ["uid1|pass1|2fa1", "uid2|pass2|2fa2", "uid3|pass3|2fa3"],
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 201
    assert resp.json()["count"] == 3


@pytest.mark.asyncio
async def test_list_resources(client):
    seller_token, variant_id = await setup_variant(client)
    await client.post(f"/seller/variants/{variant_id}/resources", json={
        "items": ["data1", "data2"],
    }, headers={"Authorization": f"Bearer {seller_token}"})
    resp = await client.get(f"/seller/variants/{variant_id}/resources",
                            headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200
    assert len(resp.json()) >= 2


@pytest.mark.asyncio
async def test_delete_resource(client):
    seller_token, variant_id = await setup_variant(client)
    await client.post(f"/seller/variants/{variant_id}/resources", json={
        "items": ["to_delete"],
    }, headers={"Authorization": f"Bearer {seller_token}"})
    resources = await client.get(f"/seller/variants/{variant_id}/resources",
                                 headers={"Authorization": f"Bearer {seller_token}"})
    res_id = resources.json()[-1]["id"]
    resp = await client.delete(f"/seller/resources/{res_id}",
                               headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_internal_acquire(client):
    """Regression: /internal/resources/acquire must pass order_id=None, duration_days=None."""
    seller_token, variant_id = await setup_variant(client)
    await client.post(f"/seller/variants/{variant_id}/resources", json={
        "items": ["acq1|pw1", "acq2|pw2"],
    }, headers={"Authorization": f"Bearer {seller_token}"})

    resp = await client.post("/internal/resources/acquire", json={
        "variant_id": variant_id, "quantity": 2,
    }, headers=INTERNAL_HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["resources"]) == 2
    assert all("resource_id" in r and "data" in r for r in data["resources"])


# ---------------------------------------------------------------------------
# Seller inventory — summary + inline edit
# ---------------------------------------------------------------------------


async def _seller_with_variant(client, email: str):
    """Like setup_variant, but per-email so a test can hold two distinct sellers."""
    admin_token = await register_and_login(client, "inv_admin@example.com")
    await make_admin("inv_admin@example.com")
    admin_token = await register_and_login(client, "inv_admin@example.com")
    await client.post("/admin/categories", json={"name": "InvCat", "slug": "invcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cat_id = (await client.get("/categories")).json()[-1]["id"]

    token = await register_and_login(client, email)
    await make_seller(email)
    token = await register_and_login(client, email)

    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": f"Kho {email}", "status": "active",
    }, headers={"Authorization": f"Bearer {token}"})
    product_id = product.json()["id"]

    variant = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Gói test", "price": 1000, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {token}"})
    return token, product_id, variant.json()["id"]


@pytest.mark.asyncio
async def test_inventory_summary_counts_by_variant(client):
    seller_token, _, variant_id = await _seller_with_variant(client, "inv1@example.com")
    await client.post(f"/seller/variants/{variant_id}/resources",
                      json={"items": ["a|1", "b|2", "c|3"]},
                      headers={"Authorization": f"Bearer {seller_token}"})

    resp = await client.get("/seller/inventory/summary",
                            headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200, resp.text
    rows = [r for r in resp.json() if r["variant_id"] == variant_id]
    assert len(rows) == 1
    assert rows[0]["available"] == 3
    assert rows[0]["assigned"] == 0
    assert rows[0]["product_title"]


@pytest.mark.asyncio
async def test_inventory_summary_includes_variants_with_no_stock(client):
    """A sold-out variant is the thing a seller most needs to see; an inner join
    would hide it."""
    seller_token, _, variant_id = await _seller_with_variant(client, "inv2@example.com")

    resp = await client.get("/seller/inventory/summary",
                            headers={"Authorization": f"Bearer {seller_token}"})
    rows = [r for r in resp.json() if r["variant_id"] == variant_id]
    assert len(rows) == 1
    assert rows[0]["available"] == 0


@pytest.mark.asyncio
async def test_inventory_summary_only_shows_own_products(client):
    seller_token, _, variant_id = await _seller_with_variant(client, "inv3@example.com")
    await client.post(f"/seller/variants/{variant_id}/resources", json={"items": ["x|1"]},
                      headers={"Authorization": f"Bearer {seller_token}"})

    other_token, _, _ = await _seller_with_variant(client, "inv4@example.com")
    resp = await client.get("/seller/inventory/summary",
                            headers={"Authorization": f"Bearer {other_token}"})
    assert all(r["variant_id"] != variant_id for r in resp.json())


@pytest.mark.asyncio
async def test_update_available_resource(client):
    seller_token, _, variant_id = await _seller_with_variant(client, "inv5@example.com")
    await client.post(f"/seller/variants/{variant_id}/resources", json={"items": ["old|pass"]},
                      headers={"Authorization": f"Bearer {seller_token}"})
    res = (await client.get(f"/seller/variants/{variant_id}/resources",
                            headers={"Authorization": f"Bearer {seller_token}"})).json()[0]

    resp = await client.patch(f"/seller/resources/{res['id']}", json={"data": "  new|pass  "},
                              headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"] == "new|pass"


@pytest.mark.asyncio
async def test_update_rejects_blank_data(client):
    seller_token, _, variant_id = await _seller_with_variant(client, "inv6@example.com")
    await client.post(f"/seller/variants/{variant_id}/resources", json={"items": ["x|1"]},
                      headers={"Authorization": f"Bearer {seller_token}"})
    res = (await client.get(f"/seller/variants/{variant_id}/resources",
                            headers={"Authorization": f"Bearer {seller_token}"})).json()[0]

    resp = await client.patch(f"/seller/resources/{res['id']}", json={"data": "   "},
                              headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_cannot_update_someone_elses_resource(client):
    seller_token, _, variant_id = await _seller_with_variant(client, "inv7@example.com")
    await client.post(f"/seller/variants/{variant_id}/resources", json={"items": ["x|1"]},
                      headers={"Authorization": f"Bearer {seller_token}"})
    res = (await client.get(f"/seller/variants/{variant_id}/resources",
                            headers={"Authorization": f"Bearer {seller_token}"})).json()[0]

    other_token, _, _ = await _seller_with_variant(client, "inv8@example.com")
    resp = await client.patch(f"/seller/resources/{res['id']}", json={"data": "hacked"},
                              headers={"Authorization": f"Bearer {other_token}"})
    assert resp.status_code in (403, 404)


@pytest.mark.asyncio
async def test_cannot_edit_a_resource_already_delivered(client):
    """Order.delivered_data is a snapshot taken at delivery, so editing the
    resource cannot reach the buyer holding the old value. Blocking the edit beats
    letting the seller think they fixed it."""
    from sqlalchemy import update as sa_update

    from src.database import SessionLocal
    from src.models.resource import Resource, ResourceStatus

    seller_token, _, variant_id = await _seller_with_variant(client, "inv9@example.com")
    await client.post(f"/seller/variants/{variant_id}/resources", json={"items": ["sold|pass"]},
                      headers={"Authorization": f"Bearer {seller_token}"})
    res = (await client.get(f"/seller/variants/{variant_id}/resources",
                            headers={"Authorization": f"Bearer {seller_token}"})).json()[0]

    async with SessionLocal() as db:
        await db.execute(sa_update(Resource).where(Resource.id == res["id"]).values(
            status=ResourceStatus.assigned))
        await db.commit()

    resp = await client.patch(f"/seller/resources/{res['id']}", json={"data": "new|pass"},
                              headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 400
    assert "khiếu nại" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_inventory_summary_counts_sold_separately(client):
    from sqlalchemy import update as sa_update

    from src.database import SessionLocal
    from src.models.resource import Resource, ResourceStatus

    seller_token, _, variant_id = await _seller_with_variant(client, "inv10@example.com")
    await client.post(f"/seller/variants/{variant_id}/resources",
                      json={"items": ["a|1", "b|2"]},
                      headers={"Authorization": f"Bearer {seller_token}"})
    res = (await client.get(f"/seller/variants/{variant_id}/resources",
                            headers={"Authorization": f"Bearer {seller_token}"})).json()[0]
    async with SessionLocal() as db:
        await db.execute(sa_update(Resource).where(Resource.id == res["id"]).values(
            status=ResourceStatus.assigned))
        await db.commit()

    rows = (await client.get("/seller/inventory/summary",
                             headers={"Authorization": f"Bearer {seller_token}"})).json()
    row = next(r for r in rows if r["variant_id"] == variant_id)
    assert row["available"] == 1
    assert row["assigned"] == 1
