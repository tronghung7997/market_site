"""Buyer wallet and orders: pending deposits, price guard, order timeline
times, order stats and shop-name search."""
from datetime import datetime

import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.account import ApplicationStatus, SellerApplication
from src.models.notification import Notification
from src.models.order import Order
from src.models.payment import DepositIntent
from src.payments.service import apply_deposit_paid
from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_wallet_shows_pending_deposits_and_credit_notifies(client):
    token = await register_and_login(client, "pending-dep@example.com")
    first = (await client.post("/wallet/deposits", json={"amount": 20_000}, headers=_auth(token))).json()
    second = (await client.post("/wallet/deposits", json={"amount": 30_000}, headers=_auth(token))).json()
    assert (await client.get("/wallet", headers=_auth(token))).json()["pending_deposits"] == 50_000

    await client.post(f"/wallet/deposits/{second['id']}/cancel", headers=_auth(token))
    assert (await client.get("/wallet", headers=_auth(token))).json()["pending_deposits"] == 20_000

    async with SessionLocal() as db:
        intent = await db.get(DepositIntent, first["id"], with_for_update=True)
        await apply_deposit_paid(intent, 20_000, "FT123", db, source="test")
        await db.commit()
    wallet = (await client.get("/wallet", headers=_auth(token))).json()
    assert wallet["pending_deposits"] == 0 and wallet["available_balance"] == 20_000
    feed = (await client.get("/me/notifications", params={"category": "wallet"}, headers=_auth(token))).json()
    assert [(n["kind"], n["params"]) for n in feed["items"]] == [
        ("deposit_credited", {"amount": 20_000, "code": first["payment_code"]}),
    ]

    assert len((await client.get("/wallet/deposits/me", params={"limit": 1}, headers=_auth(token))).json()) == 1
    assert (await client.get("/wallet/deposits/me", params={"limit": 101}, headers=_auth(token))).status_code == 422


@pytest.mark.asyncio
async def test_changed_price_is_refused_before_any_money_moves(client):
    buyer, seller, _, instant_id, _ = await setup_buyable_product(client)
    before = (await client.get("/wallet", headers=_auth(buyer))).json()["available_balance"]
    stale = await client.post(
        "/orders", json={"variant_id": instant_id, "quantity": 1, "expected_unit_price": 900}, headers=_auth(buyer),
    )
    assert stale.status_code == 409
    assert stale.json()["error_code"] == "ORDER_PRICE_CHANGED"
    assert (await client.get("/wallet", headers=_auth(buyer))).json()["available_balance"] == before

    fresh = await client.post(
        "/orders", json={"variant_id": instant_id, "quantity": 2, "expected_unit_price": 1000}, headers=_auth(buyer),
    )
    assert fresh.status_code == 201, fresh.text
    assert fresh.json()["total_amount"] == 2000
    # Older clients that send no price keep working.
    legacy = await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))
    assert legacy.status_code == 201
    assert (await client.post(
        "/orders", json={"variant_id": instant_id, "quantity": 1, "expected_unit_price": -1}, headers=_auth(buyer),
    )).status_code == 422


@pytest.mark.asyncio
async def test_order_timeline_times_and_stats(client):
    buyer, _, _, instant_id, manual_id = await setup_buyable_product(client)
    delivered = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))).json()
    assert delivered["delivered_at"] is not None and delivered["completed_at"] is None
    second = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))).json()
    manual = (await client.post("/orders", json={"variant_id": manual_id, "quantity": 1}, headers=_auth(buyer))).json()
    assert manual["delivered_at"] is None

    stats = (await client.get("/orders/stats", headers=_auth(buyer))).json()
    assert stats["awaiting_confirm"] == 2 and stats["awaiting_seller"] == 1
    deadlines = sorted(o["escrow_expires_at"] for o in (delivered, second))
    assert datetime.fromisoformat(stats["confirm_deadline"]) == datetime.fromisoformat(deadlines[0])

    await client.post(f"/orders/{delivered['id']}/confirm", headers=_auth(buyer))
    done = (await client.get(f"/orders/{delivered['id']}", headers=_auth(buyer))).json()
    assert done["completed_at"] is not None and done["delivered_at"] == delivered["delivered_at"]

    # Spend is net of partial refunds.
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == second["id"]).values(refunded_amount=400))
        await db.commit()
    stats = (await client.get("/orders/stats", headers=_auth(buyer))).json()
    assert stats["total_spend"] == 1000 + 600 + 5000


@pytest.mark.asyncio
async def test_buyer_finds_orders_by_shop_name(client):
    buyer, seller, _, instant_id, _ = await setup_buyable_product(client)
    await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))
    seller_id = (await client.get("/me", headers=_auth(seller))).json()["id"]
    async with SessionLocal() as db:
        db.add(SellerApplication(account_id=seller_id, business_name="Kho Mây Xanh", status=ApplicationStatus.approved))
        await db.commit()
    found = (await client.get("/orders", params={"search": "mây xanh"}, headers=_auth(buyer))).json()
    assert found["total"] == 1
    none = (await client.get("/orders", params={"search": "kho khác"}, headers=_auth(buyer))).json()
    assert none["total"] == 0


@pytest.mark.asyncio
async def test_rolled_back_order_change_leaves_no_notification(client):
    buyer, _, _, instant_id, _ = await setup_buyable_product(client)
    order = (await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))).json()
    async with SessionLocal() as db:
        await db.execute(Notification.__table__.delete())
        await db.commit()
    async with SessionLocal() as db:
        row = await db.get(Order, order["id"])
        row.status = "completed"
        await db.flush()
        await db.rollback()
    async with SessionLocal() as db:
        assert (await db.scalars(select(Notification))).all() == []
