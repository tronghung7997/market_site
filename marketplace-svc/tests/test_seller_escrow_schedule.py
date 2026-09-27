"""GET /seller/escrow-schedule: upcoming releases by local day with the
estimated payout at today's fee rules."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.account import Account
from src.models.order import Dispute, DisputeStatus, Order
from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _buy(client, buyer_token, variant_id, qty=1):
    res = await client.post("/orders", json={"variant_id": variant_id, "quantity": qty}, headers=_auth(buyer_token))
    assert res.status_code == 201, res.text
    return res.json()["id"]


@pytest.mark.asyncio
async def test_schedule_groups_delivered_orders_by_local_day_and_estimates_net(client):
    buyer_token, seller_token, _, instant_variant_id, manual_variant_id = await setup_buyable_product(client)
    fee_percent = (await client.get("/public/fee-config")).json()["platform_fee_percent"]

    first = await _buy(client, buyer_token, instant_variant_id)
    second = await _buy(client, buyer_token, instant_variant_id)
    disputed = await _buy(client, buyer_token, instant_variant_id)
    await _buy(client, buyer_token, manual_variant_id)  # waiting on the seller

    release_day = datetime(2031, 5, 10, 20, 0, tzinfo=timezone.utc)  # 11 May in Asia/Ho_Chi_Minh (UTC+7)
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id.in_([first, second])).values(escrow_expires_at=release_day))
        buyer_id = await db.scalar(select(Order.buyer_id).where(Order.id == disputed))
        db.add(Dispute(order_id=disputed, buyer_id=buyer_id, reason="broken", status=DisputeStatus.open))
        await db.commit()

    res = await client.get("/seller/escrow-schedule", params={"tz": "Asia/Ho_Chi_Minh"}, headers=_auth(seller_token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["tz"] == "Asia/Ho_Chi_Minh"

    gross = 1000 + 1000
    fee = 2 * int(1000 * fee_percent / 100)
    assert body["days"] == [{"date": "2031-05-11", "order_count": 2, "gross": gross, "fee": fee, "net": gross - fee}]
    assert body["in_escrow"] == {"order_count": 2, "gross": gross, "fee": fee, "net": gross - fee}
    assert body["held_by_dispute"]["order_count"] == 1 and body["held_by_dispute"]["gross"] == 1000
    assert body["awaiting_delivery"]["order_count"] == 1 and body["awaiting_delivery"]["gross"] == 5000
    assert body["no_deadline"]["order_count"] == 0

    # Same instant in UTC falls on the 10th.
    utc = (await client.get("/seller/escrow-schedule", headers=_auth(seller_token))).json()
    assert [d["date"] for d in utc["days"]] == ["2031-05-10"]


@pytest.mark.asyncio
async def test_past_due_orders_land_on_today_and_internal_sellers_pay_no_fee(client):
    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    order_id = await _buy(client, buyer_token, instant_variant_id)
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == order_id).values(
            escrow_expires_at=datetime.now(timezone.utc) - timedelta(days=3),
        ))
        await db.execute(update(Account).where(Account.email == "ord_seller@example.com").values(is_internal=True))
        await db.commit()

    body = (await client.get("/seller/escrow-schedule", headers=_auth(seller_token))).json()
    today = datetime.now(timezone.utc).date().isoformat()
    assert body["days"] == [{"date": today, "order_count": 1, "gross": 1000, "fee": 0, "net": 1000}]


@pytest.mark.asyncio
async def test_schedule_is_seller_only_and_rejects_unknown_time_zones(client):
    buyer_token, seller_token, _, _, _ = await setup_buyable_product(client)
    assert (await client.get("/seller/escrow-schedule")).status_code == 401
    assert (await client.get("/seller/escrow-schedule", headers=_auth(buyer_token))).status_code == 403
    bad_tz = await client.get("/seller/escrow-schedule", params={"tz": "Mars/Olympus"}, headers=_auth(seller_token))
    assert bad_tz.status_code == 400

    # Another seller sees only their own (empty) schedule.
    other = await register_and_login(client, "escrow_other_seller@example.com")
    from tests.conftest import make_seller
    await make_seller("escrow_other_seller@example.com")
    other = await register_and_login(client, "escrow_other_seller@example.com")
    body = (await client.get("/seller/escrow-schedule", headers=_auth(other))).json()
    assert body["days"] == [] and body["awaiting_delivery"]["order_count"] == 0
