"""Admin order page: case payload and operator actions."""
from datetime import datetime

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.order import Order
from src.models.wallet import Transaction, TransactionType
from tests.test_orders import setup_buyable_product


def _h(token):
    return {"Authorization": f"Bearer {token}"}


async def _delivered(client, quantity=2):
    buyer_token, seller_token, admin_token, instant_vid, manual_vid = await setup_buyable_product(client)
    order = (await client.post("/orders", json={"variant_id": instant_vid, "quantity": quantity}, headers=_h(buyer_token))).json()
    assert order["status"] == "delivered"
    return _h(admin_token), _h(seller_token), _h(buyer_token), order, manual_vid


async def _ledger(order_id: int) -> dict[str, int]:
    async with SessionLocal() as db:
        rows = (await db.execute(select(Transaction.type, Transaction.amount).where(
            (Transaction.reference_id == f"order-{order_id}") | Transaction.reference_id.like(f"order-{order_id}:%")))).all()
    out: dict[str, int] = {}
    for t, amount in rows:
        out[t.value] = out.get(t.value, 0) + amount
    return out


@pytest.mark.asyncio
async def test_case_payload_has_money_trail_lines_parties_and_actions(client):
    admin, _, _, order, _ = await _delivered(client)
    resp = await client.get(f"/admin/orders/{order['id']}/case", headers=admin)
    assert resp.status_code == 200, resp.text
    c = resp.json()
    assert c["order_code"] == order["order_code"]
    assert [l["line"] for l in c["lines"]] == ["#01", "#02"]
    assert c["money"]["escrow_state"] == "held" and c["money"]["remaining"] == order["total_amount"]
    assert c["money"]["projected_seller_payout"] + c["money"]["projected_platform_fee"] == order["total_amount"]
    assert {r["type"] for r in c["ledger"]} == {"purchase_hold"}
    assert c["ledger"][0]["role"] == "người mua"
    assert c["buyer"]["email"] == "ord_buyer@example.com" and c["seller"]["href"].startswith("/admin/accounts?account=")
    actions = {a["key"]: a for a in c["actions"]}
    assert actions["release"]["enabled"] and actions["refund"]["enabled"] and actions["extend_escrow"]["enabled"]
    assert not actions["retry_provision"]["enabled"] and actions["retry_provision"]["reason"]
    assert any((e["metadata"] or {}).get("event") == "order_placed" for e in c["events"])


@pytest.mark.asyncio
async def test_admin_release_settles_like_a_buyer_confirm(client):
    admin, _, _, order, _ = await _delivered(client)
    resp = await client.post(f"/admin/orders/{order['id']}/release", json={"note": "Người mua xác nhận qua chat"}, headers=admin)
    assert resp.status_code == 204, resp.text
    ledger = await _ledger(order["id"])
    assert ledger["purchase_release"] + ledger.get("platform_fee", 0) == order["total_amount"]
    c = (await client.get(f"/admin/orders/{order['id']}/case", headers=admin)).json()
    assert c["order_status"] == "completed" and c["money"]["escrow_state"] == "released"
    released = next(e for e in c["events"] if (e["metadata"] or {}).get("event") == "admin_order_released")
    assert released["actor"]["kind"] == "account"
    # Settled once: a second release is refused, not paid twice.
    again = await client.post(f"/admin/orders/{order['id']}/release", json={"note": "lần hai"}, headers=admin)
    assert again.status_code == 409 and again.json()["error_code"] == "ORDER_ACTION_NOT_ALLOWED"


@pytest.mark.asyncio
async def test_admin_refund_returns_remaining_escrow_and_shows_reason(client):
    admin, _, buyer, order, _ = await _delivered(client)
    resp = await client.post(f"/admin/orders/{order['id']}/refund",
                             json={"note": "Hàng lỗi, seller không phản hồi", "buyer_message": "Sàn đã hoàn tiền do hàng lỗi."}, headers=admin)
    assert resp.status_code == 204, resp.text
    ledger = await _ledger(order["id"])
    assert ledger["refund"] == order["total_amount"] and "purchase_release" not in ledger
    mine = (await client.get(f"/orders/{order['id']}", headers=buyer)).json()
    assert mine["status"] == "refunded" and mine["cancel_reason"] == "Sàn đã hoàn tiền do hàng lỗi."
    again = await client.post(f"/admin/orders/{order['id']}/refund", json={"note": "lần hai"}, headers=admin)
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_open_dispute_sends_money_decisions_to_the_case(client):
    admin, _, buyer, order, _ = await _delivered(client)
    opened = await client.post(f"/orders/{order['id']}/dispute", json={"reason": "Tài khoản sai"}, headers=buyer)
    assert opened.status_code == 201, opened.text
    c = (await client.get(f"/admin/orders/{order['id']}/case", headers=admin)).json()
    actions = {a["key"]: a for a in c["actions"]}
    assert not actions["release"]["enabled"] and "khiếu nại" in actions["release"]["reason"]
    assert c["disputes"][0]["href"] == f"/admin/disputes/{opened.json()['id']}"
    for path in ("release", "refund"):
        r = await client.post(f"/admin/orders/{order['id']}/{path}", json={"note": "thử"}, headers=admin)
        assert r.status_code == 409


@pytest.mark.asyncio
async def test_extend_escrow_notes_and_state_checks(client):
    admin, _, _, order, manual_vid = await _delivered(client)
    before = (await client.get(f"/admin/orders/{order['id']}/case", headers=admin)).json()["money"]["escrow_expires_at"]
    resp = await client.post(f"/admin/orders/{order['id']}/extend-escrow", json={"days": 5, "note": "Chờ người mua kiểm tra"}, headers=admin)
    assert resp.status_code == 204, resp.text
    async with SessionLocal() as db:
        after = await db.scalar(select(Order.escrow_expires_at).where(Order.id == order["id"]))
    assert (after - datetime.fromisoformat(before)).days == 5

    note = await client.post(f"/admin/orders/{order['id']}/notes", json={"note": "Đã gọi người bán, hẹn giao lại"}, headers=admin)
    assert note.status_code == 201, note.text
    c = (await client.get(f"/admin/orders/{order['id']}/case", headers=admin)).json()
    assert [n["metadata"]["note"] for n in c["notes"]] == ["Đã gọi người bán, hẹn giao lại"]

    bad = await client.post(f"/admin/orders/{order['id']}/extend-escrow", json={"days": 90, "note": "quá dài"}, headers=admin)
    assert bad.status_code == 422
    retry = await client.post(f"/admin/orders/{order['id']}/retry-provision", json={}, headers=admin)
    assert retry.status_code == 409


@pytest.mark.asyncio
async def test_order_admin_actions_are_admin_only(client):
    _, seller, buyer, order, _ = await _delivered(client)
    for headers in (seller, buyer):
        assert (await client.get(f"/admin/orders/{order['id']}/case", headers=headers)).status_code == 403
        assert (await client.post(f"/admin/orders/{order['id']}/refund", json={"note": "không được"}, headers=headers)).status_code == 403
    async with SessionLocal() as db:
        assert (await db.scalar(select(Order.status).where(Order.id == order["id"]))).value == "delivered"
