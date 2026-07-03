"""API-level tests for the pricing engine: preview == single source of truth."""

import pytest
from sqlalchemy import update

from src.database import SessionLocal
from src.models.account import Account
from src.models.category import Category
from src.models.pricing_config import PricingConfig
from src.models.product import Product, ProductStatus

from .conftest import register_and_login, make_admin, make_seller

TASK_PARAMS = {
    "base_price": 500000,
    "platform_mult": {"facebook": 1.0, "youtube": 1.5},
    "volume_tiers": [{"min_qty": 5, "discount": 0.05}],
}


def urls(n: int) -> str:
    return "\n".join(f"https://fb.com/post/{i}" for i in range(n))


async def make_product(seller_email="eng_seller@example.com", **overrides) -> int:
    """Create an active product directly in DB, return its id."""
    async with SessionLocal() as db:
        seller = Account(email=seller_email, password_hash="x", roles=["buyer", "seller"])
        category = Category(name="Takedown", slug=f"takedown-{seller_email.split('@')[0]}")
        db.add_all([seller, category])
        await db.flush()
        fields = {
            "seller_id": seller.id,
            "category_id": category.id,
            "title": "Takedown service",
            "description": "test",
            "status": ProductStatus.active,
            "service_type": "takedown",
            "pricing_strategy": "task",
            "pricing_params": TASK_PARAMS,
        }
        fields.update(overrides)
        product = Product(**fields)
        db.add(product)
        await db.commit()
        return product.id


@pytest.mark.asyncio
async def test_calculate_applies_discount_exactly_once(client):
    pid = await make_product()
    resp = await client.post(f"/products/{pid}/calculate", json={"user_config": {
        "platform": "facebook",
        "target_urls": urls(5),
    }})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # 500000*5 = 2500000, 5% off MỘT lần
    assert data["amount"] == 2375000
    assert data["original_amount"] == 2500000
    assert data["discount_pct"] == 0.05


@pytest.mark.asyncio
async def test_calculate_no_quantity_field_needed(client):
    pid = await make_product(seller_email="eng_seller2@example.com")
    resp = await client.post(f"/products/{pid}/calculate", json={"user_config": {
        "platform": "youtube",
        "target_urls": urls(2),
    }})
    assert resp.status_code == 200
    assert resp.json()["amount"] == 1500000  # 500000 * 1.5 * 2


@pytest.mark.asyncio
async def test_pricing_options_task_has_no_quantity(client):
    pid = await make_product(seller_email="eng_seller3@example.com")
    resp = await client.get(f"/products/{pid}/pricing-options")
    assert resp.status_code == 200
    names = [f["field"] for f in resp.json()["fields"]]
    assert "quantity" not in names
    assert "target_urls" in names


@pytest.mark.asyncio
async def test_fallback_to_pricing_config(client):
    """Product without own pricing falls back to pricing_configs[service_type]."""
    pid = await make_product(
        seller_email="eng_seller4@example.com",
        pricing_strategy=None, pricing_params=None, service_type="proxy",
    )
    async with SessionLocal() as db:
        db.add(PricingConfig(
            service_type="proxy", strategy="config",
            params={
                "base_price": 10000,
                "type_mult": {"datacenter": 1.0},
                "network_mult": {"shared": 1.0},
            },
            is_active=True,
        ))
        await db.commit()

    resp = await client.post(f"/products/{pid}/calculate", json={"user_config": {
        "type": "datacenter", "network": "shared", "days": 30, "quantity": 2,
    }})
    assert resp.status_code == 200
    assert resp.json()["amount"] == 20000


@pytest.mark.asyncio
async def test_fallback_to_fixed_when_nothing_configured(client):
    pid = await make_product(
        seller_email="eng_seller5@example.com",
        pricing_strategy=None, pricing_params=None, service_type="other",
    )
    resp = await client.get(f"/products/{pid}/pricing-options")
    assert resp.status_code == 200
    assert resp.json()["strategy"] == "fixed"


@pytest.mark.asyncio
async def test_provider_products_includes_pricing_fields(client):
    from src.models.provider import Provider

    admin_token = await register_and_login(client, "eng_admin@example.com")
    await make_admin("eng_admin@example.com")
    admin_token = await register_and_login(client, "eng_admin@example.com")

    async with SessionLocal() as db:
        provider = Provider(name="PP Provider", type="takedown", config={}, adapter_type="manual")
        db.add(provider)
        await db.commit()
        provider_id = provider.id

    pid = await make_product(seller_email="eng_seller7@example.com", provider_id=provider_id)

    resp = await client.get(f"/admin/providers/{provider_id}/products",
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["id"] == pid
    assert items[0]["pricing_strategy"] == "task"
    assert items[0]["pricing_params"] == TASK_PARAMS
    assert items[0]["status"] == "active"


@pytest.mark.asyncio
async def test_calculate_invalid_config_400(client):
    pid = await make_product(seller_email="eng_seller6@example.com")
    resp = await client.post(f"/products/{pid}/calculate", json={"user_config": {
        "platform": "facebook", "target_urls": "",
    }})
    assert resp.status_code == 400
