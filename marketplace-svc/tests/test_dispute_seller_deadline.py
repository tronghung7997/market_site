"""A4.5 — a seller who ignores a dispute past the deadline loses it (full refund)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.ledger.service import reconcile_ledger
from src.models.alert import Alert
from src.models.log_entry import LogEntry
from src.models.order import Dispute, DisputeStatus, Order, OrderStatus
from src.scheduler import dispute_seller_timeout_job
from tests.conftest import register_and_login
from tests.test_disputes import create_delivered_order


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _open(client, buyer_token, order_id) -> dict:
    resp = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Account not working"}, headers=_auth(buyer_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _backdate_deadline(dispute_id: int, hours: int = 1) -> None:
    async with SessionLocal() as db:
        d = await db.get(Dispute, dispute_id)
        d.seller_deadline_at = datetime.now(timezone.utc) - timedelta(hours=hours)
        await db.commit()


@pytest.mark.asyncio
async def test_deadline_is_stamped_from_admin_config_and_visible_to_both_sides(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client, stock_count=2)
    assert (await client.patch("/admin/fee-config", json={"dispute_seller_response_hours": 12}, headers=_auth(admin_token))).status_code == 200
    dispute = await _open(client, buyer_token, order_id)
    deadline = datetime.fromisoformat(dispute["seller_deadline_at"])
    assert timedelta(hours=11, minutes=55) < deadline - datetime.now(timezone.utc) <= timedelta(hours=12)
    assert dispute["seller_responded_at"] is None
    seller_token = await register_and_login(client, "disp_seller@example.com")
    seller_view = (await client.get(f"/seller/orders/{order_id}/dispute", headers=_auth(seller_token))).json()
    assert seller_view["seller_deadline_at"] == dispute["seller_deadline_at"]
    # 0 hours = feature off: no deadline on new cases (a second unit of the same stock).
    assert (await client.patch("/admin/fee-config", json={"dispute_seller_response_hours": 0}, headers=_auth(admin_token))).status_code == 200
    variant_id = (await client.get(f"/orders/{order_id}", headers=_auth(buyer_token))).json()["variant_id"]
    order2 = await client.post("/orders", json={"variant_id": variant_id, "quantity": 1}, headers=_auth(buyer_token))
    assert order2.status_code == 201, order2.text
    assert (await _open(client, buyer_token, order2.json()["id"]))["seller_deadline_at"] is None


@pytest.mark.asyncio
async def test_silent_seller_is_refunded_by_the_job_and_books_stay_balanced(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    dispute = await _open(client, buyer_token, order_id)
    buyer_before = (await client.get("/wallet", headers=_auth(buyer_token))).json()["available_balance"]

    await dispute_seller_timeout_job()                      # deadline still in the future → nothing
    assert (await client.get(f"/orders/{order_id}/dispute", headers=_auth(buyer_token))).json()["status"] == "open"

    await _backdate_deadline(dispute["id"])
    await dispute_seller_timeout_job()
    detail = (await client.get(f"/orders/{order_id}/dispute", headers=_auth(buyer_token))).json()
    assert detail["status"] == "resolved_refund"
    events = [e["event_type"] for e in detail["timeline"]]
    assert "seller_timeout_refund" in events
    refund_event = next(e for e in detail["timeline"] if e["event_type"] == "seller_timeout_refund")
    assert refund_event["refund_amount"] == 1000
    assert (await client.get("/wallet", headers=_auth(buyer_token))).json()["available_balance"] == buyer_before + 1000
    async with SessionLocal() as db:
        order = await db.get(Order, order_id)
        assert order.status == OrderStatus.refunded and order.refunded_amount == 1000
        alert = (await db.execute(select(Alert).where(Alert.type == "dispute_seller_timeout"))).scalar_one()
        assert alert.target_id == order_id and alert.severity == "warning"
        entry = (await db.execute(select(LogEntry).where(LogEntry.metadata_["event"].astext == "dispute_seller_timeout"))).scalar_one()
        assert entry.metadata_["amount"] == 1000
        assert (await reconcile_ledger(db)).ok
    # Idempotent: a second sweep finds nothing.
    await dispute_seller_timeout_job()


@pytest.mark.asyncio
async def test_any_seller_action_stops_the_clock(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    dispute = await _open(client, buyer_token, order_id)
    seller_token = await register_and_login(client, "disp_seller@example.com")
    resp = await client.post(f"/seller/disputes/{dispute['id']}/respond", json={"seller_note": "Đã kiểm tra, gửi lại 2FA"}, headers=_auth(seller_token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["seller_responded_at"] is not None

    await _backdate_deadline(dispute["id"])
    await dispute_seller_timeout_job()
    assert (await client.get(f"/orders/{order_id}/dispute", headers=_auth(buyer_token))).json()["status"] == "open"


@pytest.mark.asyncio
async def test_escalation_to_marketplace_counts_as_response_and_pauses_the_clock(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    dispute = await _open(client, buyer_token, order_id)
    seller_token = await register_and_login(client, "disp_seller@example.com")
    esc = await client.post(f"/seller/disputes/{dispute['id']}/escalate", json={"seller_note": "Nhờ GMMO xem", "idempotency_key": "escalate-0001"}, headers=_auth(seller_token))
    assert esc.status_code == 200, esc.text
    assert esc.json()["seller_responded_at"] is not None and esc.json()["review_requested_at"] is not None
    await _backdate_deadline(dispute["id"])
    await dispute_seller_timeout_job()
    async with SessionLocal() as db:
        assert (await db.get(Dispute, dispute["id"])).status == DisputeStatus.open
