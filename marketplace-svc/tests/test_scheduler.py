from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account
from src.models.affiliate import AffiliateCommission
from src.models.category import Category
from src.models.order import Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.scheduler import escrow_release_job, resource_expire_job
from tests.conftest import make_admin, make_seller, register_and_login


@pytest.mark.asyncio
async def test_escrow_release_completes_expired_orders():
    async with SessionLocal() as db:
        # Find a delivered order with past escrow (from test_orders)
        result = await db.execute(
            select(Order).where(Order.status == OrderStatus.delivered).limit(1)
        )
        order = result.scalar()
        if order:
            order.escrow_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
            await db.commit()

            await escrow_release_job()

            await db.refresh(order)
            assert order.status == OrderStatus.completed


@pytest.mark.asyncio
async def test_escrow_release_credits_affiliate_commission(client):
    """Commission is credited when the scheduler auto-completes an order."""
    admin_token = await register_and_login(client, "sched_admin@example.com")
    await make_admin("sched_admin@example.com")
    admin_token = await register_and_login(client, "sched_admin@example.com")
    await client.post("/admin/categories", json={"name": "SchCat", "slug": "schcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    cats = await client.get("/categories")
    cat_id = cats.json()[-1]["id"]

    seller_token = await register_and_login(client, "sched_seller@example.com")
    await make_seller("sched_seller@example.com")
    seller_token = await register_and_login(client, "sched_seller@example.com")
    product = await client.post("/seller/products", json={
        "category_id": cat_id, "title": "SchProd", "status": "active", "escrow_days": 2,
    }, headers={"Authorization": f"Bearer {seller_token}"})
    variant = await client.post(f"/seller/products/{product.json()['id']}/variants", json={
        "name": "SchVar", "price": 10000, "delivery_mode": "instant",
    }, headers={"Authorization": f"Bearer {seller_token}"})
    await client.post(f"/seller/variants/{variant.json()['id']}/resources", json={
        "items": ["s1|p1", "s2|p2"],
    }, headers={"Authorization": f"Bearer {seller_token}"})

    aff_reg = await client.post("/auth/register", json={
        "email": "sched_aff@example.com", "password": "StrongPass123!",
    })
    affiliate_id = aff_reg.json()["id"]
    async with SessionLocal() as db:
        aff = await db.scalar(select(Account).where(Account.id == affiliate_id))
        code = aff.affiliate_code

    await client.post("/auth/register", json={
        "email": "sched_buyer@example.com", "password": "StrongPass123!", "referral_code": code,
    })
    buyer_login = await client.post("/auth/login", json={
        "email": "sched_buyer@example.com", "password": "StrongPass123!",
    })
    buyer_token = buyer_login.json()["access_token"]
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    await client.post("/wallet/topup", json={"account_id": buyer_me.json()["id"], "amount": 100000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    order = await client.post("/orders", json={"variant_id": variant.json()["id"], "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    order_id = order.json()["id"]

    async with SessionLocal() as db:
        ord_obj = await db.get(Order, order_id)
        ord_obj.escrow_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        await db.commit()

    await escrow_release_job()

    async with SessionLocal() as db:
        ord_obj = await db.get(Order, order_id)
        assert ord_obj.status == OrderStatus.completed
        comm = await db.scalar(select(AffiliateCommission).where(AffiliateCommission.order_id == order_id))
        assert comm is not None
        assert comm.affiliate_account_id == affiliate_id
        assert comm.amount == 500


@pytest.mark.asyncio
async def test_resource_expire_job_marks_expired(client):
    from tests.conftest import register_and_login, make_admin, make_seller

    # Create admin and category
    admin_token = await register_and_login(client, "exp_admin@example.com")
    await make_admin("exp_admin@example.com")
    await client.post("/admin/categories", json={"name": "ExpCat", "slug": "expcat"},
                      headers={"Authorization": f"Bearer {admin_token}"})

    # Create seller and product variant
    seller_token = await register_and_login(client, "exp_seller@example.com")
    await make_seller("exp_seller@example.com")

    async with SessionLocal() as db:
        # Get seller account
        seller_result = await db.execute(select(Account).where(Account.email == "exp_seller@example.com"))
        seller = seller_result.scalar()
        seller_id = seller.id

        # Get category
        cat_result = await db.execute(select(Category).order_by(Category.id.desc()).limit(1))
        cat = cat_result.scalar()
        cat_id = cat.id

        # Create product
        product = Product(seller_id=seller_id, category_id=cat_id, title="ExpTest", status="active")
        db.add(product)
        await db.flush()

        # Create variant
        variant = ProductVariant(product_id=product.id, name="ExpVar", price=1000, delivery_mode="instant", sla_hours=24)
        db.add(variant)
        await db.flush()

        # Create expired resource
        r = Resource(variant_id=variant.id, seller_id=seller_id, data="x",
                     status=ResourceStatus.assigned,
                     expires_at=datetime.now(timezone.utc) - timedelta(hours=1))
        db.add(r)
        await db.commit()
        rid = r.id

    await resource_expire_job()

    async with SessionLocal() as db:
        r = await db.get(Resource, rid)
        assert r.status == ResourceStatus.expired
