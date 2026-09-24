"""GET /admin/disputes/{id}/case — the admin case file and its assessment."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from src.database import SessionLocal
from src.models.order import Dispute
from tests.conftest import register_and_login
from tests.test_disputes import create_delivered_order


def _h(token):
    return {"Authorization": f"Bearer {token}"}


async def _open_case(client, *, claim_lines=(0, 2), quantity=4):
    buyer_token, admin_token, order_id = await create_delivered_order(client, quantity=quantity, stock_count=quantity + 2)
    seller_token = await register_and_login(client, "disp_seller@example.com")
    resources = (await client.get(f"/orders/{order_id}/resources", headers=_h(buyer_token))).json()
    ids = [r["id"] for r in resources]
    opened = await client.post(
        f"/orders/{order_id}/dispute",
        json={"reason": "Hai tài khoản không đăng nhập được", "resource_ids": [ids[i] for i in claim_lines],
              "idempotency_key": "admin-case-0001"},
        headers=_h(buyer_token),
    )
    assert opened.status_code == 201, opened.text
    return _h(admin_token), _h(seller_token), opened.json()["id"], ids


@pytest.mark.asyncio
async def test_case_file_has_lines_parties_money_and_timeline(client):
    admin, _, dispute_id, ids = await _open_case(client)
    resp = await client.get(f"/admin/disputes/{dispute_id}/case", headers=admin)
    assert resp.status_code == 200, resp.text
    case = resp.json()

    assert [l["line"] for l in case["lines"]] == ["#01", "#02", "#03", "#04"]
    assert [l["state"] for l in case["lines"]] == ["claimed", "ok", "claimed", "ok"]
    assert case["claimed_resource_ids"] == [ids[0], ids[2]]
    assert case["buyer"]["email"] and case["seller"]["href"].startswith("/admin/accounts?account=")
    assert case["buyer_record"]["other_disputes"] == 0
    m = case["money"]
    assert m["remaining_refundable"] == m["order_total"] and m["unit_price"] == m["order_total"] // 4
    assert case["timeline"][0]["event_type"] == "case_opened"
    codes = {s["code"] for s in case["signals"]}
    assert {"seller_waiting", "remedy_none", "no_evidence", "buyer_first"} <= codes
    assert case["recommendation"]["action"] == "wait"


@pytest.mark.asyncio
async def test_seller_remedy_and_overdue_change_the_suggestion(client):
    admin, seller, dispute_id, ids = await _open_case(client)
    # Seller replaces one of the two claimed lines → partial refund for the other.
    done = await client.post(
        f"/seller/disputes/{dispute_id}/resources/action",
        json={"resource_ids": [ids[0]], "action": "replace", "idempotency_key": "admin-case-remedy-1"},
        headers=seller,
    )
    assert done.status_code == 200, done.text
    case = (await client.get(f"/admin/disputes/{dispute_id}/case", headers=admin)).json()
    assert [l["state"] for l in case["lines"]][:3] == ["replaced", "ok", "claimed"]
    assert case["recommendation"]["action"] == "partial_refund"
    assert case["recommendation"]["amount"] == case["money"]["unit_price"]

    # Seller replaces the other one too → the case can be closed.
    await client.post(
        f"/seller/disputes/{dispute_id}/resources/action",
        json={"resource_ids": [ids[2]], "action": "replace", "idempotency_key": "admin-case-remedy-2"},
        headers=seller,
    )
    case = (await client.get(f"/admin/disputes/{dispute_id}/case", headers=admin)).json()
    assert "remedy_complete" in {s["code"] for s in case["signals"]}
    assert case["recommendation"]["action"] == "reject"


@pytest.mark.asyncio
async def test_overdue_seller_suggests_full_refund(client):
    admin, _, dispute_id, _ = await _open_case(client)
    async with SessionLocal() as db:
        await db.execute(update(Dispute).where(Dispute.id == dispute_id).values(
            seller_deadline_at=datetime.now(timezone.utc) - timedelta(hours=1), seller_responded_at=None))
        await db.commit()
    case = (await client.get(f"/admin/disputes/{dispute_id}/case", headers=admin)).json()
    assert "seller_overdue" in {s["code"] for s in case["signals"]}
    assert case["recommendation"] == {
        "action": "refund", "amount": case["money"]["remaining_refundable"],
        "text": case["recommendation"]["text"],
    }


@pytest.mark.asyncio
async def test_resolution_log_names_the_case_and_admin(client):
    admin, _, dispute_id, _ = await _open_case(client)
    resp = await client.post(f"/admin/disputes/{dispute_id}/reject", json={"admin_note": "Không đủ bằng chứng"}, headers=admin)
    assert resp.status_code == 200, resp.text
    logs = (await client.get("/admin/logs", params={"dispute_id": dispute_id, "event": "dispute_rejected"}, headers=admin)).json()
    assert len(logs) == 1
    assert logs[0]["actor"]["kind"] == "account"
    assert ("dispute", dispute_id) in {(r["kind"], r["id"]) for r in logs[0]["refs"]}


@pytest.mark.asyncio
async def test_case_file_is_admin_only(client):
    _, seller, dispute_id, _ = await _open_case(client)
    assert (await client.get(f"/admin/disputes/{dispute_id}/case", headers=seller)).status_code == 403
