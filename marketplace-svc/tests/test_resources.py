import asyncio
from unittest.mock import AsyncMock

import pytest
from tests.conftest import make_admin, make_seller, register_and_login

from src.config import settings

INTERNAL_HEADERS = {"X-Internal-Key": settings.internal_api_key}


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
async def test_bulk_add_deduplicates_payload_and_existing_variant_resources(client):
    seller_token, variant_id = await setup_variant(client)
    headers = {"Authorization": f"Bearer {seller_token}"}

    first = await client.post(
        f"/seller/variants/{variant_id}/resources",
        json={"items": ["same|credential", "same|credential", "other|credential"]},
        headers=headers,
    )
    second = await client.post(
        f"/seller/variants/{variant_id}/resources",
        json={"items": ["same|credential", "new|credential"]},
        headers=headers,
    )

    assert first.status_code == 201, first.text
    assert first.json()["count"] == 2
    assert second.status_code == 201, second.text
    assert second.json()["count"] == 1
    resources = await client.get(
        f"/seller/variants/{variant_id}/resources", headers=headers,
    )
    assert sorted(item["data"] for item in resources.json()) == [
        "new|credential", "other|credential", "same|credential",
    ]


@pytest.mark.asyncio
async def test_bulk_add_normalizes_whitespace_and_ignores_blank_lines(client):
    seller_token, variant_id = await setup_variant(client)
    headers = {"Authorization": f"Bearer {seller_token}"}

    response = await client.post(
        f"/seller/variants/{variant_id}/resources",
        json={"items": ["  normalized|credential  ", "   ", "normalized|credential"]},
        headers=headers,
    )

    assert response.status_code == 201, response.text
    assert response.json()["count"] == 1
    resources = await client.get(
        f"/seller/variants/{variant_id}/resources", headers=headers,
    )
    assert [item["data"] for item in resources.json()] == ["normalized|credential"]


@pytest.mark.asyncio
async def test_bulk_add_rejects_a_different_seller(client):
    seller_token, variant_id = await setup_variant(client)
    other_token = await register_and_login(client, "res_other@example.com")
    await make_seller("res_other@example.com")
    other_token = await register_and_login(client, "res_other@example.com")

    response = await client.post(
        f"/seller/variants/{variant_id}/resources",
        json={"items": ["must|not|be|added"]},
        headers={"Authorization": f"Bearer {other_token}"},
    )

    assert response.status_code == 403, response.text
    owner_resources = await client.get(
        f"/seller/variants/{variant_id}/resources",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert owner_resources.json() == []


@pytest.mark.asyncio
async def test_concurrent_bulk_add_serializes_duplicate_credentials(client):
    seller_token, variant_id = await setup_variant(client)
    headers = {"Authorization": f"Bearer {seller_token}"}

    first, second = await asyncio.gather(
        client.post(
            f"/seller/variants/{variant_id}/resources",
            json={"items": ["concurrent|credential"]},
            headers=headers,
        ),
        client.post(
            f"/seller/variants/{variant_id}/resources",
            json={"items": ["concurrent|credential"]},
            headers=headers,
        ),
    )

    assert first.status_code == second.status_code == 201
    assert first.json()["count"] + second.json()["count"] == 1
    resources = await client.get(
        f"/seller/variants/{variant_id}/resources", headers=headers,
    )
    assert [item["data"] for item in resources.json()] == ["concurrent|credential"]


@pytest.mark.asyncio
async def test_bulk_add_rejects_manual_delivery_variant(client):
    seller_token, variant_id = await setup_variant(client)
    changed = await client.patch(
        f"/seller/variants/{variant_id}",
        json={"delivery_mode": "manual"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert changed.status_code == 200, changed.text

    response = await client.post(
        f"/seller/variants/{variant_id}/resources",
        json={"items": ["unused|credential"]},
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert response.status_code == 400, response.text
    assert response.json()["error_code"] == "INVENTORY_NOT_INSTANT"


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
    assert resp.headers.get("x-total-count") == str(len(resp.json()))

    page = await client.get(
        f"/seller/variants/{variant_id}/resources",
        params={"page": 1, "per_page": 1},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert page.status_code == 200
    assert len(page.json()) == 1
    assert int(page.headers["x-total-count"]) >= 2


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


@pytest.mark.asyncio
@pytest.mark.no_db
async def test_release_resources_never_commits_caller_transaction():
    from src.models.resource import ResourceStatus
    from src.resources.service import release_resources

    resource = type("ResourceStub", (), {"status": ResourceStatus.assigned})()
    db = AsyncMock()
    db.get.return_value = resource

    await release_resources([1], db)

    assert resource.status == ResourceStatus.available
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_mark_resource_error_is_idempotent(client):
    from sqlalchemy import select

    from src.database import SessionLocal
    from src.models.alert import Alert

    seller_token, variant_id = await setup_variant(client)
    await client.post(
        f"/seller/variants/{variant_id}/resources",
        json={"items": ["retryable-error"]},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    resource = (
        await client.get(
            f"/seller/variants/{variant_id}/resources",
            headers={"Authorization": f"Bearer {seller_token}"},
        )
    ).json()[0]

    first = await client.post(
        f"/seller/resources/{resource['id']}/error",
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    second = await client.post(
        f"/seller/resources/{resource['id']}/error",
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    async with SessionLocal() as db:
        incidents = list((await db.execute(
            select(Alert).where(
                Alert.fingerprint == f"resource:{resource['id']}:resource_error",
                Alert.is_active.is_(True),
            )
        )).scalars().all())
    assert len(incidents) == 1
    assert incidents[0].occurrence_count == 2


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
async def test_inventory_summary_excludes_legacy_variant_when_effective_pricing_is_dynamic(client):
    from src.database import SessionLocal
    from src.models.pricing_config import PricingConfig
    from src.models.product import Product

    seller_token, product_id, variant_id = await _seller_with_variant(
        client, "inv_dynamic_legacy@example.com",
    )
    # Simulate data written before mixed pricing/variant states were blocked.
    async with SessionLocal() as db:
        product = await db.get(Product, product_id)
        product.service_type = "proxy"
        db.add(PricingConfig(
            service_type="proxy",
            strategy="config",
            params={
                "base_price": 10000,
                "type_mult": {"residential": 1.0},
                "network_mult": {"shared": 1.0},
            },
            is_active=True,
        ))
        await db.commit()

    response = await client.get(
        "/seller/inventory/summary",
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert response.status_code == 200, response.text
    assert all(row["variant_id"] != variant_id for row in response.json()["items"])


@pytest.mark.asyncio
async def test_inventory_summary_excludes_manual_delivery_variants(client):
    seller_token, _, variant_id = await _seller_with_variant(client, "inv_manual@example.com")
    changed = await client.patch(
        f"/seller/variants/{variant_id}",
        json={"delivery_mode": "manual"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    assert changed.status_code == 200, changed.text

    response = await client.get(
        "/seller/inventory/summary",
        headers={"Authorization": f"Bearer {seller_token}"},
    )

    assert response.status_code == 200, response.text
    assert all(row["variant_id"] != variant_id for row in response.json()["items"])


@pytest.mark.asyncio
async def test_inventory_summary_counts_by_variant(client):
    seller_token, _, variant_id = await _seller_with_variant(client, "inv1@example.com")
    await client.post(f"/seller/variants/{variant_id}/resources",
                      json={"items": ["a|1", "b|2", "c|3"]},
                      headers={"Authorization": f"Bearer {seller_token}"})

    resp = await client.get("/seller/inventory/summary",
                            headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200, resp.text
    rows = [r for r in resp.json()["items"] if r["variant_id"] == variant_id]
    assert len(rows) == 1
    assert rows[0]["available"] == 3
    assert rows[0]["assigned"] == 0
    assert rows[0]["archived"] == 0
    assert rows[0]["product_title"]


@pytest.mark.asyncio
async def test_inventory_summary_counts_archived_resources_separately(client):
    seller_token, _, variant_id = await _seller_with_variant(client, "inv_archived_count@example.com")
    headers = {"Authorization": f"Bearer {seller_token}"}
    await client.post(
        f"/seller/variants/{variant_id}/resources",
        json={"items": ["visible|resource", "archived|resource"]},
        headers=headers,
    )
    resources = (await client.get(
        f"/seller/variants/{variant_id}/resources",
        headers=headers,
    )).json()
    archived_id = next(resource["id"] for resource in resources if resource["data"] == "archived|resource")
    archived = await client.post(f"/seller/resources/{archived_id}/archive", headers=headers)
    assert archived.status_code == 200, archived.text

    rows = (await client.get("/seller/inventory/summary", headers=headers)).json()["items"]
    row = next(item for item in rows if item["variant_id"] == variant_id)

    assert row["available"] == 1
    assert row["assigned"] == 0
    assert row["archived"] == 1


@pytest.mark.asyncio
async def test_inventory_summary_includes_variants_with_no_stock(client):
    """A sold-out variant is the thing a seller most needs to see; an inner join
    would hide it."""
    seller_token, _, variant_id = await _seller_with_variant(client, "inv2@example.com")

    resp = await client.get("/seller/inventory/summary",
                            headers={"Authorization": f"Bearer {seller_token}"})
    rows = [r for r in resp.json()["items"] if r["variant_id"] == variant_id]
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
    assert all(r["variant_id"] != variant_id for r in resp.json()["items"])


@pytest.mark.asyncio
async def test_inventory_summary_defaults_to_active_products(client):
    seller_token, product_id, variant_id = await _seller_with_variant(
        client, "inventory_active_scope@example.com",
    )
    headers = {"Authorization": f"Bearer {seller_token}"}

    paused = await client.put(
        f"/seller/products/{product_id}/status",
        json={"status": "paused"},
        headers=headers,
    )
    assert paused.status_code == 200, paused.text

    default_scope = await client.get("/seller/inventory/summary", headers=headers)
    assert default_scope.status_code == 200, default_scope.text
    assert all(row["variant_id"] != variant_id for row in default_scope.json()["items"])
    assert default_scope.json()["total"] == 0

    all_scope = await client.get(
        "/seller/inventory/summary?product_status=all",
        headers=headers,
    )
    assert all_scope.status_code == 200, all_scope.text
    assert {row["variant_id"] for row in all_scope.json()["items"]} == {variant_id}

    direct_scope = await client.get(
        f"/seller/inventory/summary?product_id={product_id}",
        headers=headers,
    )
    assert direct_scope.status_code == 200, direct_scope.text
    assert {row["variant_id"] for row in direct_scope.json()["items"]} == {variant_id}


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
    assert resp.json()["error_code"] == "RESOURCE_NOT_EDITABLE"


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
                             headers={"Authorization": f"Bearer {seller_token}"})).json()["items"]
    row = next(r for r in rows if r["variant_id"] == variant_id)
    assert row["available"] == 1
    assert row["assigned"] == 1


@pytest.mark.asyncio
async def test_resource_default_page_is_bounded_and_export_streams_all(client):
    seller_token, _, variant_id = await _seller_with_variant(client, "inv_export@example.com")
    headers = {"Authorization": f"Bearer {seller_token}"}
    values = [f"resource-{index}|password" for index in range(75)]
    added = await client.post(
        f"/seller/variants/{variant_id}/resources",
        json={"items": values},
        headers=headers,
    )
    assert added.status_code == 201, added.text

    page = await client.get(f"/seller/variants/{variant_id}/resources", headers=headers)
    assert len(page.json()) == 50
    assert page.headers["x-total-count"] == "75"

    exported = await client.get(
        f"/seller/variants/{variant_id}/resources/export?format=txt",
        headers=headers,
    )
    assert exported.status_code == 200, exported.text
    assert len(exported.text.strip().splitlines()) == 75
    assert "attachment;" in exported.headers["content-disposition"]

    buyer_token = await register_and_login(client, "inv_export_buyer@example.com")
    forbidden = await client.get(
        f"/seller/variants/{variant_id}/resources/export?format=txt",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert forbidden.status_code == 403

    too_big = await client.get(
        f"/seller/variants/{variant_id}/resources?per_page=200",
        headers=headers,
    )
    assert too_big.status_code == 422


@pytest.mark.asyncio
async def test_inventory_summary_is_paginated_and_searchable(client):
    seller_token, product_id, _ = await _seller_with_variant(client, "inv_page@example.com")
    headers = {"Authorization": f"Bearer {seller_token}"}
    cat_id = (await client.get("/categories")).json()[-1]["id"]
    second = await client.post(
        "/seller/products",
        json={"category_id": cat_id, "title": "Searchable second", "status": "active"},
        headers=headers,
    )
    assert second.status_code == 201, second.text
    variant = await client.post(
        f"/seller/products/{second.json()['id']}/variants",
        json={"name": "Searchable pack", "price": 1000, "delivery_mode": "instant"},
        headers=headers,
    )
    assert variant.status_code == 201, variant.text
    renamed = await client.patch(
        f"/seller/products/{product_id}",
        json={"title": "Searchable first"},
        headers=headers,
    )
    assert renamed.status_code == 200, renamed.text

    response = await client.get(
        "/seller/inventory/summary?search=Searchable&page=1&per_page=1",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2
    assert {row["product_id"] for row in response.json()["items"]} == {product_id}
    page_two = await client.get(
        "/seller/inventory/summary?search=Searchable&page=2&per_page=1",
        headers=headers,
    )
    assert page_two.json()["items"][0]["product_id"] != product_id
    assert "counts" in response.json()

    by_product_id = await client.get(
        f"/seller/inventory/summary?search={product_id}",
        headers=headers,
    )
    assert by_product_id.status_code == 200
    assert {row["product_id"] for row in by_product_id.json()["items"]} == {product_id}

    invalid_stock = await client.get(
        "/seller/inventory/summary?stock=bogus", headers=headers,
    )
    assert invalid_stock.status_code == 422


@pytest.mark.asyncio
async def test_list_resources_filtering_by_status_and_search(client):
    from sqlalchemy import update as sa_update
    from src.database import SessionLocal
    from src.models.resource import Resource, ResourceStatus

    seller_token, _, variant_id = await _seller_with_variant(client, "filter_search@example.com")
    headers = {"Authorization": f"Bearer {seller_token}"}
    await client.post(f"/seller/variants/{variant_id}/resources",
                      json={"items": ["user1|pass1|uid100", "user2|pass2|uid200", "user3|pass3|uid300"]},
                      headers=headers)

    buyer_token = await register_and_login(client, "buyer_search@example.com")
    await client.post("/wallet/demo-topup", headers={"Authorization": f"Bearer {buyer_token}"}, json={"amount": 100000})
    order = (await client.post("/orders", headers={"Authorization": f"Bearer {buyer_token}"},
                               json={"variant_id": variant_id, "quantity": 1})).json()
    order_id = order["id"]

    all_res = (await client.get(f"/seller/variants/{variant_id}/resources", headers=headers)).json()
    assigned_res = next(r for r in all_res if r["status"] == "assigned")
    avail_res = [r for r in all_res if r["status"] == "available"]
    err_res = avail_res[0]

    async with SessionLocal() as db:
        await db.execute(sa_update(Resource).where(Resource.id == err_res["id"]).values(status=ResourceStatus.error, order_id=order_id))
        await db.commit()

    # Filter by error
    error_list = await client.get(f"/seller/variants/{variant_id}/resources", params={"status": "error"}, headers=headers)
    assert error_list.status_code == 200
    assert len(error_list.json()) == 1
    assert error_list.json()[0]["id"] == err_res["id"]

    # Search by data text
    search_res = await client.get(f"/seller/variants/{variant_id}/resources", params={"search": assigned_res["data"]}, headers=headers)
    assert search_res.status_code == 200
    assert any(r["id"] == assigned_res["id"] for r in search_res.json())

    # Search by order_id
    search_order = await client.get(f"/seller/variants/{variant_id}/resources", params={"search": f"#{order_id}"}, headers=headers)
    assert search_order.status_code == 200
    found_ids = [r["id"] for r in search_order.json()]
    assert assigned_res["id"] in found_ids or err_res["id"] in found_ids
    exported = await client.get(
        f"/seller/variants/{variant_id}/resources/export",
        params={"format": "txt", "search": f"#{order_id}"},
        headers=headers,
    )
    assert exported.status_code == 200
    listed_data = {row["data"] for row in search_order.json()}
    exported_data = {line for line in exported.text.strip().splitlines() if line}
    assert exported_data == listed_data

    invalid = await client.get(
        f"/seller/variants/{variant_id}/resources",
        params={"status": "bogus"},
        headers=headers,
    )
    assert invalid.status_code == 422

    cannot_restock_order_history = await client.post(
        f"/seller/resources/{err_res['id']}/restock",
        json={"data": "fixed-but-historical"},
        headers=headers,
    )
    assert cannot_restock_order_history.status_code == 400
    history = (await client.get(f"/orders/{order_id}/resources", headers=headers)).json()
    assert any(item["id"] == err_res["id"] for item in history)


@pytest.mark.asyncio
async def test_restock_and_archive_resource(client):
    from sqlalchemy import update as sa_update
    from src.database import SessionLocal
    from src.models.resource import Resource, ResourceStatus

    seller_token, _, variant_id = await _seller_with_variant(client, "restock_arch@example.com")
    headers = {"Authorization": f"Bearer {seller_token}"}
    await client.post(f"/seller/variants/{variant_id}/resources",
                      json={"items": ["broken|acc|1", "broken|acc|2"]},
                      headers=headers)
    all_res = (await client.get(f"/seller/variants/{variant_id}/resources", headers=headers)).json()
    r1, r2 = all_res[0], all_res[1]

    async with SessionLocal() as db:
        await db.execute(sa_update(Resource).where(Resource.id == r1["id"]).values(status=ResourceStatus.error))
        await db.execute(sa_update(Resource).where(Resource.id == r2["id"]).values(status=ResourceStatus.error))
        await db.commit()

    # Restock r1 with updated data
    restocked = await client.post(f"/seller/resources/{r1['id']}/restock", json={"data": "fixed|acc|1"}, headers=headers)
    assert restocked.status_code == 200
    data = restocked.json()
    assert data["status"] == "available"
    assert data["order_id"] is None
    assert data["data"] == "fixed|acc|1"
    assert data["is_archived"] is False

    # Archive r2
    archived = await client.post(f"/seller/resources/{r2['id']}/archive", headers=headers)
    assert archived.status_code == 200
    assert archived.json()["is_archived"] is True

    # Check that archived item is excluded from normal listing
    active_items = (await client.get(f"/seller/variants/{variant_id}/resources", headers=headers)).json()
    assert all(item["id"] != r2["id"] for item in active_items)

    archived_items = (await client.get(
        f"/seller/variants/{variant_id}/resources",
        params={"archived_only": "true"},
        headers=headers,
    )).json()
    assert [item["id"] for item in archived_items] == [r2["id"]]

    restored = await client.post(f"/seller/resources/{r2['id']}/restore", headers=headers)
    assert restored.status_code == 200
    assert restored.json()["is_archived"] is False
    assert restored.json()["status"] == "error"

    # Bulk actions
    bulk_resp = await client.post(
        f"/seller/variants/{variant_id}/resources/bulk-action",
        json={"action": "archive", "resource_ids": [r1["id"]]},
        headers=headers,
    )
    assert bulk_resp.status_code == 200
    assert bulk_resp.json()["count"] == 1

    atomic_failure = await client.post(
        f"/seller/variants/{variant_id}/resources/bulk-action",
        json={"action": "restore", "resource_ids": [r1["id"], 999999999]},
        headers=headers,
    )
    assert atomic_failure.status_code == 400
    still_archived = (await client.get(
        f"/seller/variants/{variant_id}/resources",
        params={"archived_only": "true"},
        headers=headers,
    )).json()
    assert any(item["id"] == r1["id"] for item in still_archived)

    public_products = (await client.get("/products")).json()["items"]
    public_variant = next(
        variant
        for product in public_products
        for variant in product["variants"]
        if variant["id"] == variant_id
    )
    assert public_variant["stock_count"] == 0
