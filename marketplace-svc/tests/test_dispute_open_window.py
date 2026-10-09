"""Settings › Fees & holds: "Thời gian tối đa được mở tranh chấp" — how long
after delivery a buyer may open a dispute (0 = until the hold ends)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from src.database import SessionLocal
from src.disputes.service import dispute_open_until
from src.models.order import Order
from tests.conftest import register_and_login
from tests.test_disputes import create_delivered_order


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _set_window(client, admin_token: str, hours: int):
    resp = await client.patch("/admin/fee-config", json={"dispute_open_window_hours": hours}, headers=_auth(admin_token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["dispute_open_window_hours"] == hours


async def _delivered_hours_ago(order_id: int, hours: float) -> None:
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == order_id).values(
            delivered_at=datetime.now(timezone.utc) - timedelta(hours=hours),
        ))
        await db.commit()


@pytest.mark.no_db
def test_open_until_is_the_earlier_of_hold_end_and_window():
    delivered = datetime(2026, 10, 7, 8, tzinfo=timezone.utc)
    order = Order(delivered_at=delivered, escrow_expires_at=delivered + timedelta(hours=48))
    assert dispute_open_until(order, 0) == delivered + timedelta(hours=48)
    assert dispute_open_until(order, 6) == delivered + timedelta(hours=6)
    assert dispute_open_until(order, 72) == delivered + timedelta(hours=48)
    # Pre-rollout orders without a delivery time keep the hold as the only limit.
    assert dispute_open_until(Order(delivered_at=None, escrow_expires_at=order.escrow_expires_at), 6) == order.escrow_expires_at


@pytest.mark.asyncio
async def test_zero_window_keeps_the_whole_hold(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    cfg = (await client.get("/public/fee-config")).json()
    assert cfg["dispute_open_window_hours"] == 0
    await _delivered_hours_ago(order_id, 40)

    order = (await client.get(f"/orders/{order_id}", headers=_auth(buyer_token))).json()
    assert order["dispute_open_until"] == order["escrow_expires_at"]
    assert order["capabilities"]["can_dispute"] is True
    opened = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Not working"}, headers=_auth(buyer_token))
    assert opened.status_code == 201, opened.text


@pytest.mark.asyncio
async def test_dispute_inside_the_window_is_accepted(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    await _set_window(client, admin_token, 2)
    await _delivered_hours_ago(order_id, 1)

    order = (await client.get(f"/orders/{order_id}", headers=_auth(buyer_token))).json()
    until = datetime.fromisoformat(order["dispute_open_until"])
    delivered = datetime.fromisoformat(order["delivered_at"])
    assert until - delivered == timedelta(hours=2)
    assert until < datetime.fromisoformat(order["escrow_expires_at"])
    assert order["capabilities"]["can_dispute"] is True
    opened = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Wrong password"}, headers=_auth(buyer_token))
    assert opened.status_code == 201, opened.text


@pytest.mark.asyncio
async def test_dispute_after_the_window_is_refused_while_escrow_still_holds(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    await _set_window(client, admin_token, 2)
    await _delivered_hours_ago(order_id, 3)

    order = (await client.get(f"/orders/{order_id}", headers=_auth(buyer_token))).json()
    assert order["status"] == "delivered"
    assert order["capabilities"]["can_dispute"] is False
    assert datetime.fromisoformat(order["escrow_expires_at"]) > datetime.now(timezone.utc)
    late = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Too late"}, headers=_auth(buyer_token))
    assert late.status_code == 400
    assert late.json()["error_code"] == "DISPUTE_WINDOW_CLOSED" and late.json()["params"] == {"hours": 2}
    # The buyer can still confirm; only opening a case is closed.
    assert order["capabilities"]["can_confirm"] is True

    # Going back to 0 restores the legacy rule (the whole hold).
    await _set_window(client, admin_token, 0)
    opened = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Back to legacy"}, headers=_auth(buyer_token))
    assert opened.status_code == 201, opened.text


@pytest.mark.asyncio
async def test_window_setting_is_validated_and_admin_only(client):
    _, admin_token, _ = await create_delivered_order(client)
    for bad in (-1, 721):
        resp = await client.patch("/admin/fee-config", json={"dispute_open_window_hours": bad}, headers=_auth(admin_token))
        assert resp.status_code == 422, bad
    user_token = await register_and_login(client, "window_user@example.com")
    assert (await client.patch("/admin/fee-config", json={"dispute_open_window_hours": 5}, headers=_auth(user_token))).status_code == 403
    assert (await client.patch("/admin/fee-config", json={"dispute_open_window_hours": 5})).status_code == 401
