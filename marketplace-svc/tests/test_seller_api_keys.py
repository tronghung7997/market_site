import pytest
from tests.conftest import make_admin, make_seller, register_and_login, set_seller_tier


async def _trusted_seller(client, email):
    token = await register_and_login(client, email)
    await make_seller(email)
    await set_seller_tier(email, "trusted")
    return await register_and_login(client, email)


async def _trusted_seller_with_product(client, seller_email, admin_email, buyer_email):
    """Trusted-tier seller with an active category, an instant variant, a
    manual variant, and a funded buyer — enough to exercise accept/deliver
    and bulk resource upload end to end."""
    admin_token = await register_and_login(client, admin_email)
    await make_admin(admin_email)
    admin_token = await register_and_login(client, admin_email)

    cat_slug = admin_email.split("@")[0]
    await client.post("/admin/categories", json={"name": cat_slug, "slug": cat_slug},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    seller_token = await _trusted_seller(client, seller_email)

    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "API Key Test Product", "status": "active", "escrow_days": 2,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    product_id = product.json()["id"]

    instant_variant = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Instant", "price": 1000, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    instant_variant_id = instant_variant.json()["id"]

    manual_variant = await client.post(f"/seller/products/{product_id}/variants", json={
        "name": "Manual", "price": 5000, "delivery_mode": "manual", "sla_hours": 24,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    manual_variant_id = manual_variant.json()["id"]

    buyer_token = await register_and_login(client, buyer_email)
    buyer_id = (await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})).json()["id"]
    await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 100000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    api_key = (await client.post("/seller/api-keys",
                                 headers={"Authorization": f"Bearer {seller_token}"})).json()["key"]

    return seller_token, buyer_token, api_key, instant_variant_id, manual_variant_id


@pytest.mark.asyncio
async def test_create_api_key_requires_trusted_tier(client):
    token = await register_and_login(client, "apikey1@example.com")
    await make_seller("apikey1@example.com")
    token = await register_and_login(client, "apikey1@example.com")  # still tier "new"

    resp = await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_api_key_success_returns_plaintext_once(client):
    token = await _trusted_seller(client, "apikey2@example.com")

    resp = await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["key"].startswith("sk_live_")
    assert body["key_prefix"].startswith(body["key"][:12])
    assert body["key_prefix"].endswith(body["key"][-4:])

    listing = await client.get("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})
    assert listing.status_code == 200
    items = listing.json()
    assert len(items) == 1
    assert "key" not in items[0]
    assert "key_hash" not in items[0]


@pytest.mark.asyncio
async def test_api_key_authenticates_seller_orders(client):
    token = await _trusted_seller(client, "apikey3@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()

    resp = await client.get("/seller/orders", headers={"X-Seller-Api-Key": created["key"]})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_seller_orders_rejects_missing_auth(client):
    resp = await client.get("/seller/orders")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_seller_orders_jwt_still_works_without_api_key(client):
    token = await _trusted_seller(client, "apikey4@example.com")
    resp = await client.get("/seller/orders", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_revoked_api_key_is_rejected(client):
    token = await _trusted_seller(client, "apikey5@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token}"})).json()

    revoke_resp = await client.delete(f"/seller/api-keys/{created['id']}",
                                      headers={"Authorization": f"Bearer {token}"})
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["revoked_at"] is not None

    resp = await client.get("/seller/orders", headers={"X-Seller-Api-Key": created["key"]})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_cannot_revoke_another_sellers_key(client):
    token_a = await _trusted_seller(client, "apikey6a@example.com")
    token_b = await _trusted_seller(client, "apikey6b@example.com")
    created = (await client.post("/seller/api-keys", headers={"Authorization": f"Bearer {token_a}"})).json()

    resp = await client.delete(f"/seller/api-keys/{created['id']}",
                               headers={"Authorization": f"Bearer {token_b}"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_me_exposes_seller_tier(client):
    token = await _trusted_seller(client, "apikey7@example.com")
    resp = await client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["seller_tier"] == "trusted"

@pytest.mark.asyncio
async def test_api_key_can_accept_and_deliver_manual_order(client):
    _, buyer_token, api_key, _, manual_vid = await _trusted_seller_with_product(
        client, "apikey8s@example.com", "apikey8a@example.com", "apikey8b@example.com",
    )

    order = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    assert order.status_code == 201
    order_id = order.json()["id"]

    accept = await client.post(f"/seller/orders/{order_id}/accept", headers={"X-Seller-Api-Key": api_key})
    assert accept.status_code == 200
    assert accept.json()["status"] == "processing"

    deliver = await client.post(f"/seller/orders/{order_id}/deliver",
                               json={"data": "delivered-via-api-key"},
                               headers={"X-Seller-Api-Key": api_key})
    assert deliver.status_code == 200
    assert deliver.json()["status"] == "delivered"
    assert deliver.json()["delivered_data"] == "delivered-via-api-key"


@pytest.mark.asyncio
async def test_api_key_can_bulk_add_resources(client):
    _, _, api_key, instant_vid, _ = await _trusted_seller_with_product(
        client, "apikey9s@example.com", "apikey9a@example.com", "apikey9b@example.com",
    )

    resp = await client.post(f"/seller/variants/{instant_vid}/resources",
                             json={"items": ["stock1|pass1", "stock2|pass2"]},
                             headers={"X-Seller-Api-Key": api_key})
    assert resp.status_code == 201
    assert resp.json()["count"] == 2


@pytest.mark.asyncio
async def test_revoked_api_key_cannot_accept_or_deliver_or_upload(client):
    seller_token, buyer_token, api_key, instant_vid, manual_vid = await _trusted_seller_with_product(
        client, "apikey10s@example.com", "apikey10a@example.com", "apikey10b@example.com",
    )
    keys = (await client.get("/seller/api-keys", headers={"Authorization": f"Bearer {seller_token}"})).json()
    await client.delete(f"/seller/api-keys/{keys[0]['id']}", headers={"Authorization": f"Bearer {seller_token}"})

    order = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = order.json()["id"]

    assert (await client.post(f"/seller/orders/{order_id}/accept",
                              headers={"X-Seller-Api-Key": api_key})).status_code == 401
    assert (await client.post(f"/seller/variants/{instant_vid}/resources",
                              json={"items": ["x"]},
                              headers={"X-Seller-Api-Key": api_key})).status_code == 401
