import pytest
from tests.conftest import make_admin, make_seller, register_and_login


async def setup_seller_with_category(client):
    admin_token = await register_and_login(client, "prod_admin@example.com")
    await make_admin("prod_admin@example.com")
    admin_token = await register_and_login(client, "prod_admin@example.com")

    cat = await client.post("/admin/categories", json={"name": "ProdCat", "slug": "prodcat"},
                            headers={"Authorization": f"Bearer {admin_token}"})
    cat_id = cat.json()["id"]

    seller_token = await register_and_login(client, "prod_seller@example.com")
    await make_seller("prod_seller@example.com")
    seller_token = await register_and_login(client, "prod_seller@example.com")

    return seller_token, admin_token, cat_id


@pytest.mark.asyncio
async def test_create_product(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Twitter New", "description": "Best twitter",
        "escrow_days": 3,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 201
    assert resp.json()["title"] == "Twitter New"
    assert resp.json()["escrow_days"] == 3


@pytest.mark.asyncio
async def test_add_variant(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Twitter Variant Test",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    variant = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Full 2FA + Cookies", "price": 990, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert variant.status_code == 201
    assert variant.json()["price"] == 990
    assert variant.json()["delivery_mode"] == "instant"


@pytest.mark.asyncio
async def test_list_products_public(client):
    resp = await client.get("/products")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_product_detail_includes_variants(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Detail Test", "status": "active",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Variant A", "price": 500,
    }, headers={"Authorization": f"Bearer {seller_token}"})

    resp = await client.get(f"/products/{product_id}")
    assert resp.status_code == 200
    assert len(resp.json()["variants"]) >= 1


@pytest.mark.asyncio
async def test_buyer_cannot_create_product(client):
    buyer_token = await register_and_login(client, "prod_buyer@example.com")
    resp = await client.post("/seller/products", json={
        "category_id": 1, "title": "Nope",
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_product_commission_rate_persisted_on_create(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Commission Product",
        "commission_rate": 7.5,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 201
    assert resp.json()["commission_rate"] == 7.5


@pytest.mark.asyncio
async def test_product_commission_rate_update_persists(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Commission Update",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    assert product.json()["commission_rate"] is None

    resp = await client.patch(f"/seller/products/{product_id}", json={
        "commission_rate": 12.0,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200
    assert resp.json()["commission_rate"] == 12.0


@pytest.mark.asyncio
async def test_product_commission_rate_left_untouched_when_omitted(client):
    seller_token, _, cat_id = await setup_seller_with_category(client)
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Commission Keep", "commission_rate": 9.0,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]
    assert product.json()["commission_rate"] == 9.0

    resp = await client.patch(f"/seller/products/{product_id}", json={
        "title": "Commission Keep Renamed",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200
    assert resp.json()["commission_rate"] == 9.0
