import pytest
from tests.conftest import register_and_login, make_admin, make_seller

pytestmark = pytest.mark.anyio


async def _seed_instant_variant(client, seller_token, admin_token):
    await client.post("/admin/categories", headers={"Authorization": f"Bearer {admin_token}"}, json={"name": "Proxy", "slug": "proxy"})
    prod = await client.post("/seller/products", headers={"Authorization": f"Bearer {seller_token}"},
                             json={"category_id": 1, "title": "T", "status": "active", "escrow_days": 1, "service_type": "proxy"})
    pid = prod.json()["id"]
    var = await client.post(f"/seller/products/{pid}/variants", headers={"Authorization": f"Bearer {seller_token}"},
                            json={"name": "v", "price": 1000, "delivery_mode": "instant", "sla_hours": 24})
    vid = var.json()["id"]
    await client.post(f"/seller/variants/{vid}/resources", headers={"Authorization": f"Bearer {seller_token}"}, json={"items": ["a|b"]})
    return vid


async def test_order_placement_writes_lifecycle_logs(client):
    admin = await register_and_login(client, "admin-aud@ex.com"); await make_admin("admin-aud@ex.com")
    seller = await register_and_login(client, "seller-aud@ex.com"); await make_seller("seller-aud@ex.com")
    vid = await _seed_instant_variant(client, seller, admin)
    buyer = await register_and_login(client, "buyer-aud@ex.com")
    await client.post("/wallet/demo-topup", headers={"Authorization": f"Bearer {buyer}"}, json={"amount": 100000})
    order = await client.post("/orders", headers={"Authorization": f"Bearer {buyer}"}, json={"variant_id": vid, "quantity": 1})
    oid = order.json()["id"]

    from src.database import SessionLocal
    from src.models.log_entry import LogEntry
    from sqlalchemy import select
    async with SessionLocal() as db:
        rows = (await db.execute(select(LogEntry).order_by(LogEntry.id))).scalars().all()
    events = [r.metadata_.get("event") for r in rows if r.metadata_ and r.metadata_.get("order_id") == oid]
    assert "order_placed" in events
    assert "resources_assigned" in events
    # request_id stamped on the user-initiated events
    placed = next(r for r in rows if r.metadata_ and r.metadata_.get("event") == "order_placed")
    assert placed.request_id is not None


async def test_dispute_resolution_writes_logs(client):
    admin = await register_and_login(client, "admin-d@ex.com"); await make_admin("admin-d@ex.com")
    seller = await register_and_login(client, "seller-d@ex.com"); await make_seller("seller-d@ex.com")
    vid = await _seed_instant_variant(client, seller, admin)
    buyer = await register_and_login(client, "buyer-d@ex.com")
    await client.post("/wallet/demo-topup", headers={"Authorization": f"Bearer {buyer}"}, json={"amount": 100000})
    order = await client.post("/orders", headers={"Authorization": f"Bearer {buyer}"}, json={"variant_id": vid, "quantity": 1})
    oid = order.json()["id"]
    await client.post(f"/orders/{oid}/dispute", headers={"Authorization": f"Bearer {buyer}"}, json={"reason": "bad"})
    disputes = await client.get("/admin/disputes", headers={"Authorization": f"Bearer {admin}"})
    did = disputes.json()[0]["id"]
    await client.post(f"/admin/disputes/{did}/refund", headers={"Authorization": f"Bearer {admin}"}, json={"admin_note": "ok"})

    from src.database import SessionLocal
    from src.models.log_entry import LogEntry
    from sqlalchemy import select
    async with SessionLocal() as db:
        rows = (await db.execute(select(LogEntry))).scalars().all()
    events = [r.metadata_.get("event") for r in rows if r.metadata_ and r.metadata_.get("order_id") == oid]
    assert "dispute_opened" in events
    assert "dispute_refunded" in events


async def test_escrow_release_job_logs_with_job_id(client):
    from datetime import datetime, timedelta, timezone
    from src.database import SessionLocal
    from src.models.account import Account
    from src.models.category import Category
    from src.models.product import Product, ProductVariant
    from src.models.order import Order, OrderStatus
    from src.models.log_entry import LogEntry
    from src.models.wallet import Wallet
    from src.scheduler import escrow_release_job
    from sqlalchemy import select

    async with SessionLocal() as db:
        # Create accounts for FK constraints
        a1 = Account(email="platform@ex.com", password_hash="x", roles=["admin"])
        a2 = Account(email="seller-esc@ex.com", password_hash="x", roles=["seller"])
        db.add_all([a1, a2]); await db.flush()
        # Create category + product + variant for FK
        cat = Category(name="EscCat", slug="esccat")
        db.add(cat); await db.flush()
        prod = Product(seller_id=a2.id, category_id=cat.id, title="EscProd", status="active")
        db.add(prod); await db.flush()
        var = ProductVariant(product_id=prod.id, name="EscVar", price=1000, delivery_mode="instant", sla_hours=24)
        db.add(var); await db.flush()
        # Create the order
        o = Order(buyer_id=a1.id, seller_id=a2.id, variant_id=var.id, quantity=1, total_amount=1000,
                  status=OrderStatus.delivered,
                  escrow_expires_at=datetime.now(timezone.utc) - timedelta(hours=1))
        db.add(o); await db.flush()
        oid = o.id
        # seller + platform wallets must exist for release_escrow
        db.add_all([Wallet(account_id=a1.id, available_balance=0), Wallet(account_id=a2.id, available_balance=0)])
        await db.commit()

    await escrow_release_job()

    async with SessionLocal() as db:
        rows = (await db.execute(select(LogEntry).where(LogEntry.metadata_["event"].astext == "escrow_released"))).scalars().all()
    assert any(r.metadata_.get("order_id") == oid and r.job_id is not None for r in rows)


async def test_admin_can_query_logs_by_order(client):
    admin = await register_and_login(client, "admin-q@ex.com"); await make_admin("admin-q@ex.com")
    seller = await register_and_login(client, "seller-q@ex.com"); await make_seller("seller-q@ex.com")
    vid = await _seed_instant_variant(client, seller, admin)
    buyer = await register_and_login(client, "buyer-q@ex.com")
    await client.post("/wallet/demo-topup", headers={"Authorization": f"Bearer {buyer}"}, json={"amount": 100000})
    order = await client.post("/orders", headers={"Authorization": f"Bearer {buyer}"}, json={"variant_id": vid, "quantity": 1})
    oid = order.json()["id"]

    resp = await client.get(f"/admin/logs?order_id={oid}", headers={"Authorization": f"Bearer {admin}"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) >= 2
    assert all(r["metadata"]["order_id"] == oid for r in body)


async def test_logs_endpoint_requires_admin(client):
    buyer = await register_and_login(client, "buyer-noadmin@ex.com")
    resp = await client.get("/admin/logs", headers={"Authorization": f"Bearer {buyer}"})
    assert resp.status_code == 403
