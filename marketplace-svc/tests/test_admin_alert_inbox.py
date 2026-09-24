"""Admin alert inbox: concrete targets, deep links, admin-side resolution."""
import pytest
from sqlalchemy import select

from src.alerts.service import add_alert, fp_order, upsert_incident
from src.database import SessionLocal
from src.models.alert import Alert
from tests.conftest import make_admin, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _order(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    order = (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))).json()
    return _auth(admin_token), _auth(seller_token), _auth(buyer_token), order


async def _sla_alert(order: dict) -> int:
    async with SessionLocal() as db:
        alert = await upsert_incident(
            db, fingerprint=fp_order(order["id"], "sla_breach"), type_="sla_breach", severity="warning",
            target_type="seller", target_id=order["seller_id"], message="Seller trễ hạn",
        )
        await db.commit()
        return alert.id


@pytest.mark.asyncio
async def test_seller_alert_resolves_to_the_order_and_seller(client):
    admin, _, _, order = await _order(client)
    alert_id = await _sla_alert(order)

    rows = (await client.get("/admin/alerts", headers=admin)).json()
    row = next(r for r in rows if r["id"] == alert_id)
    assert row["audience"] == "user"
    kinds = [r["kind"] for r in row["refs"]]
    assert kinds[:2] == ["order", "account"]
    assert row["refs"][0]["label"] == order["order_code"]
    assert row["href"] == f"/admin/orders/{order['id']}"
    assert row["refs"][1]["href"] == f"/admin/accounts?account={order['seller_id']}"
    assert "ord_seller@example.com" in row["refs"][1]["detail"]


@pytest.mark.asyncio
async def test_admin_resolve_keeps_seller_notice_and_records_who(client):
    admin, seller, _, order = await _order(client)
    alert_id = await _sla_alert(order)

    resp = await client.post(f"/admin/alerts/{alert_id}/resolve", json={"note": "Đã nhắc seller qua Telegram"}, headers=admin)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["admin_note"] == "Đã nhắc seller qua Telegram"
    assert body["admin_resolved_by"]
    # Still in the seller's own inbox — the admin handled it, the seller has not.
    assert body["is_active"] is True
    seller_rows = (await client.get("/seller/alerts", headers=seller)).json()
    assert alert_id in [r["id"] for r in seller_rows]

    assert alert_id not in [r["id"] for r in (await client.get("/admin/alerts", headers=admin)).json()]
    resolved = (await client.get("/admin/alerts", params={"status": "resolved"}, headers=admin)).json()
    assert alert_id in [r["id"] for r in resolved]

    # The same breach firing again puts it back in front of operators.
    await _sla_alert(order)
    reopened = next(r for r in (await client.get("/admin/alerts", headers=admin)).json() if r["id"] == alert_id)
    assert reopened["occurrence_count"] == 2
    assert reopened["admin_resolved_at"] is None


@pytest.mark.asyncio
async def test_ops_incident_resolve_closes_it_and_reopen_restores(client):
    admin, _, _, order = await _order(client)
    async with SessionLocal() as db:
        alert = await upsert_incident(
            db, fingerprint=fp_order(order["id"], "provision_stuck"), type_="provision_stuck", severity="critical",
            target_type="order", target_id=order["id"], message="Kẹt cấp phát",
        )
        await db.commit()
        alert_id = alert.id

    resp = await client.post("/admin/alerts/resolve", json={"ids": [alert_id]}, headers=admin)
    assert resp.status_code == 200
    assert resp.json()[0]["is_active"] is False

    back = await client.post(f"/admin/alerts/{alert_id}/reopen", headers=admin)
    assert back.status_code == 200
    assert back.json()["is_active"] is True
    assert alert_id in [r["id"] for r in (await client.get("/admin/alerts", headers=admin)).json()]


@pytest.mark.asyncio
async def test_dispute_alert_opens_the_case_and_user_notices_stay_out(client):
    admin, _, buyer, order = await _order(client)
    opened = await client.post(f"/orders/{order['id']}/dispute", json={"reason": "Tài khoản sai mật khẩu"}, headers=buyer)
    assert opened.status_code in (200, 201), opened.text
    dispute_id = opened.json()["id"]
    async with SessionLocal() as db:
        await add_alert(db, type_="buyer_dispute_resource_resolved", severity="info", target_type="buyer",
                        target_id=order["buyer_id"], message="Seller đã đổi tài nguyên")
        await db.commit()

    rows = (await client.get("/admin/alerts", headers=admin)).json()
    assert "buyer_dispute_resource_resolved" not in {r["type"] for r in rows}
    row = next(r for r in rows if r["type"] == "dispute_opened")
    assert row["refs"][0]["kind"] == "dispute"
    assert row["href"] == f"/admin/disputes/{dispute_id}"
    assert {r["kind"] for r in row["refs"]} >= {"dispute", "order", "account"}


@pytest.mark.asyncio
async def test_alert_inbox_is_admin_only(client):
    _, seller, _, order = await _order(client)
    alert_id = await _sla_alert(order)
    assert (await client.get("/admin/alerts", headers=seller)).status_code == 403
    assert (await client.post(f"/admin/alerts/{alert_id}/resolve", json={}, headers=seller)).status_code == 403
    assert (await client.post(f"/admin/alerts/{alert_id}/reopen", headers=seller)).status_code == 403
    async with SessionLocal() as db:
        assert (await db.scalar(select(Alert.admin_resolved_at).where(Alert.id == alert_id))) is None
