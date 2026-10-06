from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account
from src.models.affiliate import AffiliateCommission
from src.models.category import Category
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.models.product import Product, ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.models.wallet import Transaction, TransactionType, Wallet
from src.scheduler import escrow_release_job, resource_expire_job
from tests.conftest import make_admin, make_seller, register_and_login
from tests.test_orders import setup_buyable_product


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
async def test_escrow_job_does_not_release_after_order_leaves_delivered(client):
    buyer_token, seller_token, _, instant_vid, _ = await setup_buyable_product(client)
    buyer_headers = {"Authorization": f"Bearer {buyer_token}"}
    seller_headers = {"Authorization": f"Bearer {seller_token}"}
    order = await client.post(
        "/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer_headers,
    )
    order_id = order.json()["id"]
    seller_id = (await client.get("/me", headers=seller_headers)).json()["id"]

    async with SessionLocal() as db:
        ord_obj = await db.get(Order, order_id)
        ord_obj.status = OrderStatus.refunded
        ord_obj.escrow_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        await db.commit()

    await escrow_release_job()

    async with SessionLocal() as db:
        ord_obj = await db.get(Order, order_id)
        assert ord_obj.status == OrderStatus.refunded
        wallet_id = await db.scalar(select(Wallet.id).where(Wallet.account_id == seller_id))
        releases = (
            await db.scalars(
                select(Transaction).where(
                    Transaction.wallet_id == wallet_id,
                    Transaction.type == TransactionType.purchase_release,
                    Transaction.reference_id == f"order-{order_id}",
                )
            )
        ).all()
        assert releases == []


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
    await client.post("/wallet/topup", json={"reason": "test topup", "account_id": buyer_me.json()["id"], "amount": 100000},
                      headers={"Authorization": f"Bearer {admin_token}"})
    await client.post(
        "/admin/affiliate-fund/topup",
        json={"amount": 1_000_000, "note": "test budget"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    # Commission is a share of the platform fee, so both must be non-zero
    # (explicit here: the env may seed either at 0).
    fee = await client.patch("/admin/fee-config", json={"platform_fee_percent": 10}, headers={"Authorization": f"Bearer {admin_token}"})
    assert fee.status_code == 200, fee.text
    aff_cfg = await client.patch("/admin/affiliate-config", json={"commission_percent_of_fee": 50}, headers={"Authorization": f"Bearer {admin_token}"})
    assert aff_cfg.status_code == 200, aff_cfg.text

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


@pytest.mark.asyncio
async def test_escrow_release_continues_after_one_order_fails(client, monkeypatch):
    """A failing order is rolled back on its own; the next due order is still
    released (the rollback must not leave the loop reading expired objects)."""
    import src.scheduler as scheduler

    buyer_token, _, _, instant_vid, _ = await setup_buyable_product(client)
    headers = {"Authorization": f"Bearer {buyer_token}"}
    ids = []
    for _ in range(2):
        resp = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=headers)
        assert resp.status_code == 201, resp.text
        ids.append(resp.json()["id"])
    async with SessionLocal() as db:
        for order_id in ids:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.delivered
            order.escrow_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        await db.commit()

    real_release = scheduler.release_escrow

    async def fail_the_first(order_id, *args, **kwargs):
        if order_id == ids[0]:
            raise RuntimeError("seller wallet missing")
        return await real_release(order_id, *args, **kwargs)

    monkeypatch.setattr(scheduler, "release_escrow", fail_the_first)

    await escrow_release_job()

    async with SessionLocal() as db:
        assert (await db.get(Order, ids[0])).status == OrderStatus.delivered
        assert (await db.get(Order, ids[1])).status == OrderStatus.completed


@pytest.mark.no_db
def test_long_interval_jobs_run_soon_after_start():
    """Interval jobs otherwise wait a full interval (4-24 h) before their first
    run; a process restarted more often than that would never run them."""
    from src.main import scheduler

    soon = datetime.now(timezone.utc) + timedelta(hours=1)
    for job_id in ("auto_review", "supplier_sync", "gateway_call_log_cleanup", "chat_message_retention"):
        job = scheduler.get_job(job_id)
        assert job is not None, job_id
        assert job.next_run_time is not None and job.next_run_time <= soon, job_id


@pytest.mark.asyncio
async def test_resource_expire_job_works_through_batches(client, monkeypatch):
    """Expiry runs in bounded batches (one transaction each) until nothing is due,
    and leaves resources that are not yet due alone."""
    import src.scheduler as scheduler
    from src.models.log_entry import LogEntry

    seller_token = await register_and_login(client, "exp_batch_seller@example.com")
    await make_seller("exp_batch_seller@example.com")
    admin_token = await register_and_login(client, "exp_batch_admin@example.com")
    await make_admin("exp_batch_admin@example.com")
    await client.post("/admin/categories", json={"name": "ExpBatch", "slug": "expbatch"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    async with SessionLocal() as db:
        seller_id = (await db.scalar(select(Account).where(Account.email == "exp_batch_seller@example.com"))).id
        cat_id = (await db.scalar(select(Category).order_by(Category.id.desc()).limit(1))).id
        product = Product(seller_id=seller_id, category_id=cat_id, title="ExpBatch", status="active")
        db.add(product)
        await db.flush()
        variant = ProductVariant(product_id=product.id, name="Batch", price=1000, delivery_mode="instant", sla_hours=24)
        db.add(variant)
        await db.flush()
        due = [Resource(variant_id=variant.id, seller_id=seller_id, data=f"due-{i}",
                        status=ResourceStatus.assigned, expires_at=past) for i in range(5)]
        later = Resource(variant_id=variant.id, seller_id=seller_id, data="later",
                         status=ResourceStatus.assigned, expires_at=future)
        db.add_all([*due, later])
        await db.commit()
        due_ids, later_id = [r.id for r in due], later.id

    monkeypatch.setattr(scheduler, "_EXPIRE_BATCH_SIZE", 2)
    await scheduler.resource_expire_job()

    async with SessionLocal() as db:
        statuses = dict((await db.execute(
            select(Resource.id, Resource.status).where(Resource.id.in_([*due_ids, later_id]))
        )).all())
        logged = (await db.scalars(select(LogEntry).where(LogEntry.message.like("Resource % expired")))).all()
    assert {statuses[i] for i in due_ids} == {ResourceStatus.expired}
    assert statuses[later_id] == ResourceStatus.assigned
    assert len(logged) == 5


def _freeze_scheduler_clock(monkeypatch, frozen: datetime) -> None:
    import src.scheduler as scheduler

    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen if tz is not None else frozen.replace(tzinfo=None)

    monkeypatch.setattr(scheduler, "datetime", _Frozen)


@pytest.mark.no_db
def test_due_scans_write_the_status_into_the_sql():
    """A prepared statement's generic plan cannot see a bound status and walks
    the primary key through every order; the scans inline it instead."""
    from sqlalchemy.dialects import postgresql

    import src.scheduler as scheduler

    stmt = select(Order.id).where(
        scheduler._status_is(Order.status, OrderStatus.delivered), Order.id > 0,
    )
    sql = str(stmt.compile(dialect=postgresql.dialect(), compile_kwargs={"render_postcompile": True}))
    assert "orders.status = 'delivered'" in sql
    assert "orders.id > %(id_1)s" in sql


@pytest.mark.asyncio
async def test_escrow_release_selects_only_due_undisputed_delivered_orders(client, monkeypatch):
    """Due means delivered, escrow ended at or before now, and no open dispute;
    a closed dispute does not hold the money back."""
    buyer_token, seller_token, _, instant_vid, _ = await setup_buyable_product(client)
    await client.post(f"/seller/variants/{instant_vid}/resources", json={
        "items": ["uid4|pass4", "uid5|pass5", "uid6|pass6"],
    }, headers={"Authorization": f"Bearer {seller_token}"})
    headers = {"Authorization": f"Bearer {buyer_token}"}
    ids = []
    for _ in range(5):
        resp = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=headers)
        assert resp.status_code == 201, resp.text
        ids.append(resp.json()["id"])
    at_expiry, not_yet, open_case, closed_case, disputed = ids

    now = datetime.now(timezone.utc).replace(microsecond=123456)
    async with SessionLocal() as db:
        for order_id in ids:
            order = await db.get(Order, order_id)
            assert order.status == OrderStatus.delivered
            order.escrow_expires_at = now - timedelta(hours=1)
        (await db.get(Order, at_expiry)).escrow_expires_at = now
        (await db.get(Order, not_yet)).escrow_expires_at = now + timedelta(microseconds=1)
        (await db.get(Order, disputed)).status = OrderStatus.disputed
        buyer_id = (await db.get(Order, open_case)).buyer_id
        db.add_all([
            Dispute(order_id=open_case, buyer_id=buyer_id, reason="open", status=DisputeStatus.open),
            Dispute(order_id=closed_case, buyer_id=buyer_id, reason="closed", status=DisputeStatus.resolved_reject),
        ])
        await db.commit()

    _freeze_scheduler_clock(monkeypatch, now)
    await escrow_release_job()

    async with SessionLocal() as db:
        statuses = dict((await db.execute(select(Order.id, Order.status).where(Order.id.in_(ids)))).all())
    assert statuses == {
        at_expiry: OrderStatus.completed,
        not_yet: OrderStatus.delivered,
        open_case: OrderStatus.delivered,
        closed_case: OrderStatus.completed,
        disputed: OrderStatus.disputed,
    }


@pytest.mark.asyncio
async def test_resource_expire_job_selects_only_assigned_rows_due_by_now(client, monkeypatch):
    seller_token = await register_and_login(client, "exp_edge_seller@example.com")
    await make_seller("exp_edge_seller@example.com")
    admin_token = await register_and_login(client, "exp_edge_admin@example.com")
    await make_admin("exp_edge_admin@example.com")
    await client.post("/admin/categories", json={"name": "ExpEdge", "slug": "expedge"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    now = datetime.now(timezone.utc).replace(microsecond=654321)
    past = now - timedelta(hours=1)
    async with SessionLocal() as db:
        seller_id = (await db.scalar(select(Account).where(Account.email == "exp_edge_seller@example.com"))).id
        cat_id = (await db.scalar(select(Category).order_by(Category.id.desc()).limit(1))).id
        product = Product(seller_id=seller_id, category_id=cat_id, title="ExpEdge", status="active")
        db.add(product)
        await db.flush()
        variant = ProductVariant(product_id=product.id, name="Edge", price=1000, delivery_mode="instant", sla_hours=24)
        db.add(variant)
        await db.flush()
        cases = {
            "at_expiry": (ResourceStatus.assigned, now, ResourceStatus.expired),
            "overdue": (ResourceStatus.assigned, past, ResourceStatus.expired),
            "not_yet": (ResourceStatus.assigned, now + timedelta(microseconds=1), ResourceStatus.assigned),
            "no_expiry": (ResourceStatus.assigned, None, ResourceStatus.assigned),
            "available": (ResourceStatus.available, past, ResourceStatus.available),
            "error": (ResourceStatus.error, past, ResourceStatus.error),
            "already": (ResourceStatus.expired, past, ResourceStatus.expired),
        }
        rows = {
            name: Resource(variant_id=variant.id, seller_id=seller_id, data=f"edge-{name}",
                           status=status, expires_at=expires_at)
            for name, (status, expires_at, _) in cases.items()
        }
        db.add_all(rows.values())
        await db.commit()
        ids = {name: r.id for name, r in rows.items()}

    _freeze_scheduler_clock(monkeypatch, now)
    await resource_expire_job()

    from src.models.log_entry import LogEntry
    async with SessionLocal() as db:
        statuses = dict((await db.execute(
            select(Resource.id, Resource.status).where(Resource.id.in_(ids.values()))
        )).all())
        logged = set((await db.scalars(
            select(LogEntry.message).where(LogEntry.message.like("Resource % expired"))
        )).all())
    assert {name: statuses[rid] for name, rid in ids.items()} == {name: c[2] for name, c in cases.items()}
    assert logged == {f"Resource {ids['at_expiry']} expired", f"Resource {ids['overdue']} expired"}
