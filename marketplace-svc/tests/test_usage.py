import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.provider import Provider
from src.models.usage import OrderBalance, UsageRecord, UsageRecordStatus

from .conftest import make_admin, make_seller, register_and_login

from src.config import settings

INTERNAL_HEADERS = {"X-Internal-Key": settings.internal_api_key}


async def setup_credit_product(client, package_size=5, credit_price=100):
    """Admin + seller + mock-adapter product (service_type=endpoint, strategy=credit),
    buyer funded — mirrors setup_adapter_product in test_orders.py."""
    admin_token = await register_and_login(client, "usage_admin@example.com")
    await make_admin("usage_admin@example.com")
    admin_token = await register_and_login(client, "usage_admin@example.com")

    await client.post("/admin/categories", json={"name": "UsageCat", "slug": "usagecat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    provider_resp = await client.post("/admin/providers", json={
        "name": "Usage Test Provider", "type": "endpoint", "config": {}, "priority": 1,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert provider_resp.status_code == 201, provider_resp.text
    provider_id = provider_resp.json()["id"]
    async with SessionLocal() as db:
        await db.execute(update(Provider).where(Provider.id == provider_id).values(adapter_type="mock"))
        await db.commit()

    seller_token = await register_and_login(client, "usage_seller@example.com")
    await make_seller("usage_seller@example.com")
    seller_token = await register_and_login(client, "usage_seller@example.com")

    product_resp = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "Scraper API", "status": "active",
        "escrow_days": 2, "service_type": "endpoint",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    assert product_resp.status_code == 201, product_resp.text
    product_id = product_resp.json()["id"]

    ops_resp = await client.put(f"/admin/products/{product_id}/operations", json={
        "provider_id": provider_id,
        "pricing_strategy": "credit",
        "pricing_params": {
            "credit_price": credit_price,
            "packages": [{"size": package_size, "label": f"{package_size} requests"}],
        },
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert ops_resp.status_code == 200, ops_resp.text

    buyer_token = await register_and_login(client, "usage_buyer@example.com")
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]
    await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 500000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    return admin_token, seller_token, buyer_token, product_id


async def buy_package(client, buyer_token, product_id, package_size):
    resp = await client.post("/orders", json={
        "product_id": product_id,
        "user_config": {"package_size": package_size},
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_order_delivery_creates_balance_matching_package_size(client):
    _, _, buyer_token, product_id = await setup_credit_product(client, package_size=5)
    order = await buy_package(client, buyer_token, product_id, 5)
    assert order["status"] == "delivered"

    async with SessionLocal() as db:
        balance = await db.scalar(
            select(OrderBalance).where(OrderBalance.order_id == order["id"])
        )
        assert balance is not None
        assert balance.units_total == 5
        assert balance.units_used == 0


@pytest.mark.asyncio
async def test_charge_usage_deducts_and_hard_blocks_at_quota(client):
    _, _, buyer_token, product_id = await setup_credit_product(client, package_size=3)
    order = await buy_package(client, buyer_token, product_id, 3)

    for i in range(3):
        resp = await client.post(f"/orders/{order['id']}/usage", json={"endpoint": "profile"},
                                  headers={"Authorization": f"Bearer {buyer_token}"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["units_remaining"] == 3 - (i + 1)

    blocked = await client.post(f"/orders/{order['id']}/usage", json={"endpoint": "profile"},
                                 headers={"Authorization": f"Bearer {buyer_token}"})
    assert blocked.status_code == 402, blocked.text

    async with SessionLocal() as db:
        balance = await db.scalar(
            select(OrderBalance).where(OrderBalance.order_id == order["id"])
        )
        # Chặn cứng: dù bị từ chối, units_used không được vượt units_total.
        assert balance.units_used == 3

        rejected = await db.scalar(
            select(UsageRecord)
            .where(UsageRecord.order_id == order["id"], UsageRecord.status == UsageRecordStatus.rejected_quota)
        )
        assert rejected is not None


@pytest.mark.asyncio
async def test_negative_usage_units_are_rejected_without_granting_quota(client):
    _, _, buyer_token, product_id = await setup_credit_product(client, package_size=5)
    order = await buy_package(client, buyer_token, product_id, 5)

    buyer_resp = await client.post(
        f"/orders/{order['id']}/usage",
        json={"endpoint": "profile", "units": -1},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    internal_resp = await client.post(
        "/internal/usage/charge",
        json={"order_id": order["id"], "endpoint": "profile", "units": -1},
        headers=INTERNAL_HEADERS,
    )
    assert buyer_resp.status_code == 422
    assert internal_resp.status_code == 422

    async with SessionLocal() as db:
        balance = await db.scalar(select(OrderBalance).where(OrderBalance.order_id == order["id"]))
        assert balance.units_used == 0


@pytest.mark.asyncio
async def test_charge_usage_forbidden_for_non_owner(client):
    _, _, buyer_token, product_id = await setup_credit_product(client)
    order = await buy_package(client, buyer_token, product_id, 5)

    stranger_token = await register_and_login(client, "usage_stranger@example.com")
    resp = await client.post(f"/orders/{order['id']}/usage", json={"endpoint": "profile"},
                              headers={"Authorization": f"Bearer {stranger_token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_charge_usage_allowed_for_admin(client):
    admin_token, _, buyer_token, product_id = await setup_credit_product(client)
    order = await buy_package(client, buyer_token, product_id, 5)

    resp = await client.post(f"/orders/{order['id']}/usage", json={"endpoint": "profile"},
                              headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_internal_charge_usage_requires_internal_key(client):
    _, _, buyer_token, product_id = await setup_credit_product(client)
    order = await buy_package(client, buyer_token, product_id, 5)

    no_key = await client.post("/internal/usage/charge", json={
        "order_id": order["id"], "endpoint": "profile",
    })
    assert no_key.status_code in (401, 403, 422)

    with_key = await client.post("/internal/usage/charge", json={
        "order_id": order["id"], "endpoint": "profile",
    }, headers=INTERNAL_HEADERS)
    assert with_key.status_code == 200, with_key.text
    assert with_key.json()["units_remaining"] == 4
