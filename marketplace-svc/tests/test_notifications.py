import pytest
from tests.conftest import make_admin, make_seller, register_and_login
from tests.test_disputes import create_delivered_order
from tests.test_orders import setup_buyable_product
from tests.test_wallet import _seller_with_balance

from src.alerts.service import add_alert
from src.database import SessionLocal
from src.models.service_task import ServiceTask, ServiceTaskStatus


@pytest.mark.asyncio
async def test_buyer_action_items_empty(client):
    token = await register_and_login(client, "notif_buyer_empty@example.com")
    resp = await client.get("/orders/action-items", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_buyer_action_items_delivered_order(client):
    buyer_token, _, _, instant_vid, _ = await setup_buyable_product(client)
    await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    resp = await client.get("/orders/action-items", headers={"Authorization": f"Bearer {buyer_token}"})
    assert resp.status_code == 200
    items = {i["key"]: i for i in resp.json()}
    assert items["buyer_delivered_unconfirmed"]["count"] == 1
    assert items["buyer_delivered_unconfirmed"]["href"] == "/orders?status=delivered"


@pytest.mark.asyncio
async def test_buyer_action_items_dispute_seller_responded(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    dispute = await client.post(f"/orders/{order_id}/dispute", json={"reason": "Broken"},
                                headers={"Authorization": f"Bearer {buyer_token}"})
    dispute_id = dispute.json()["id"]

    resp_before = await client.get("/orders/action-items", headers={"Authorization": f"Bearer {buyer_token}"})
    assert not any(i["key"] == "buyer_dispute_seller_responded" for i in resp_before.json())

    seller_token = await register_and_login(client, "disp_seller@example.com")
    await client.post(f"/seller/disputes/{dispute_id}/respond", json={"seller_note": "Đã kiểm tra"},
                      headers={"Authorization": f"Bearer {seller_token}"})

    resp_after = await client.get("/orders/action-items", headers={"Authorization": f"Bearer {buyer_token}"})
    items = {i["key"]: i for i in resp_after.json()}
    assert items["buyer_dispute_seller_responded"]["count"] == 1
    assert items["buyer_dispute_seller_responded"]["href"] == "/orders?status=disputed"

    # admin resolves it -> no longer "open", item disappears
    await client.post(f"/admin/disputes/{dispute_id}/reject", json={"admin_note": "ok"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    resp_resolved = await client.get("/orders/action-items", headers={"Authorization": f"Bearer {buyer_token}"})
    assert not any(i["key"] == "buyer_dispute_seller_responded" for i in resp_resolved.json())


@pytest.mark.asyncio
async def test_seller_action_items_pending_order_and_alert(client):
    buyer_token, seller_token, _, _, manual_vid = await setup_buyable_product(client)
    order = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    assert order.json()["status"] == "pending"

    seller_me = await client.get("/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = seller_me.json()["id"]
    async with SessionLocal() as db:
        alert = await add_alert(
            db,
            type_="resource_low",
            severity="warning",
            target_type="seller",
            target_id=seller_id,
            message="Sắp hết hàng",
        )
        await db.commit()
        alert_id = alert.id

    resp = await client.get("/seller/action-items", headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200
    items = {i["key"]: i for i in resp.json()}
    assert items["seller_pending_orders"]["count"] == 1
    assert items["seller_pending_orders"]["href"] == "/seller/orders?tab=action_required"
    assert items[f"alert_{alert_id}"]["dismissible"] is True
    assert items[f"alert_{alert_id}"]["alert_id"] == alert_id


@pytest.mark.asyncio
async def test_seller_action_items_open_dispute_no_note(client):
    buyer_token, admin_token, order_id = await create_delivered_order(client)
    await client.post(f"/orders/{order_id}/dispute", json={"reason": "Broken"},
                      headers={"Authorization": f"Bearer {buyer_token}"})
    seller_token = await register_and_login(client, "disp_seller@example.com")

    resp = await client.get("/seller/action-items", headers={"Authorization": f"Bearer {seller_token}"})
    items = {i["key"]: i for i in resp.json()}
    assert items["seller_open_disputes"]["count"] == 1
    assert items["seller_open_disputes"]["href"] == "/seller/orders?tab=disputed"

    disputes = await client.get("/admin/disputes", headers={"Authorization": f"Bearer {admin_token}"})
    dispute_id = disputes.json()[-1]["id"]
    respond = await client.post(f"/seller/disputes/{dispute_id}/respond", json={"seller_note": "Đã kiểm tra"},
                                headers={"Authorization": f"Bearer {seller_token}"})
    assert respond.status_code == 200

    resp2 = await client.get("/seller/action-items", headers={"Authorization": f"Bearer {seller_token}"})
    assert not any(i["key"] == "seller_open_disputes" for i in resp2.json())


@pytest.mark.asyncio
async def test_admin_action_items_counts(client):
    admin_token = await register_and_login(client, "notif_admin@example.com")
    await make_admin("notif_admin@example.com")
    admin_token = await register_and_login(client, "notif_admin@example.com")

    applicant_token = await register_and_login(client, "notif_applicant@example.com")
    await client.post("/seller/apply", json={"business_name": "Shop A"},
                      headers={"Authorization": f"Bearer {applicant_token}"})

    buyer_token, _, order_id = await create_delivered_order(client)
    await client.post(f"/orders/{order_id}/dispute", json={"reason": "Broken"},
                      headers={"Authorization": f"Bearer {buyer_token}"})

    seller_token, _ = await _seller_with_balance(client, "notif_wallet_seller@example.com", 1_000_000)
    await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 500_000},
                      headers={"Authorization": f"Bearer {seller_token}"})

    buyer_token2, _, _, instant_vid, _ = await setup_buyable_product(client)
    order2 = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token2}"})
    order2_id = order2.json()["id"]
    async with SessionLocal() as db:
        db.add(ServiceTask(order_id=order2_id, platform="tiktok", target_url="https://example.com/x",
                           status=ServiceTaskStatus.pending))
        await db.commit()

    resp = await client.get("/admin/action-items", headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    items = {i["key"]: i for i in resp.json()}
    assert items["admin_pending_applications"]["count"] == 1
    assert items["admin_open_disputes"]["count"] == 1
    assert items["admin_pending_withdrawals"]["count"] == 1
    assert items["admin_pending_tasks"]["count"] == 1


@pytest.mark.asyncio
async def test_approve_seller_creates_inbox_alert(client):
    buyer_token = await register_and_login(client, "notif_approve_seller@example.com")
    await client.post(
        "/seller/apply",
        json={"business_name": "Inbox Shop"},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    admin_token = await register_and_login(client, "notif_approve_admin@example.com")
    await make_admin("notif_approve_admin@example.com")
    admin_token = await register_and_login(client, "notif_approve_admin@example.com")
    apps = await client.get("/admin/seller-applications", headers={"Authorization": f"Bearer {admin_token}"})
    app_id = apps.json()[-1]["id"]

    approved = await client.post(
        f"/admin/seller-applications/{app_id}/approve",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert approved.status_code == 200

    inbox = await client.get("/me/action-items", headers={"Authorization": f"Bearer {buyer_token}"})
    assert inbox.status_code == 200
    items = {i["key"]: i for i in inbox.json()}
    assert items["seller_application_approved"]["href"] == "/seller"
    assert items["seller_application_approved"]["dismissible"] is True
    assert items["seller_application_approved"]["alert_id"] is not None

    admin_inbox = await client.get("/admin/action-items", headers={"Authorization": f"Bearer {admin_token}"})
    assert not any(i["key"] == "seller_application_approved" for i in admin_inbox.json())


@pytest.mark.asyncio
async def test_me_action_items_merges_buyer_and_seller(client):
    buyer_token, seller_token, _, _, manual_vid = await setup_buyable_product(client)
    order = await client.post(
        "/orders",
        json={"variant_id": manual_vid, "quantity": 1},
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert order.json()["status"] == "pending"

    seller_inbox = await client.get("/me/action-items", headers={"Authorization": f"Bearer {seller_token}"})
    assert seller_inbox.status_code == 200
    seller_keys = {i["key"] for i in seller_inbox.json()}
    assert "seller_pending_orders" in seller_keys

    buyer_only = await register_and_login(client, "notif_me_buyer@example.com")
    empty = await client.get("/me/action-items", headers={"Authorization": f"Bearer {buyer_only}"})
    assert empty.status_code == 200
    assert empty.json() == []


@pytest.mark.asyncio
async def test_seller_dismiss_own_alert_but_not_others(client):
    seller_token = await register_and_login(client, "notif_dismiss_seller@example.com")
    await make_seller("notif_dismiss_seller@example.com")
    seller_token = await register_and_login(client, "notif_dismiss_seller@example.com")
    seller_me = await client.get("/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = seller_me.json()["id"]

    async with SessionLocal() as db:
        alert = await add_alert(
            db,
            type_="resource_low",
            severity="warning",
            target_type="seller",
            target_id=seller_id,
            message="Sắp hết hàng",
        )
        await db.commit()
        alert_id = alert.id

    other_token = await register_and_login(client, "notif_other_seller@example.com")
    await make_seller("notif_other_seller@example.com")
    other_token = await register_and_login(client, "notif_other_seller@example.com")
    forbidden = await client.post(f"/seller/alerts/{alert_id}/dismiss",
                                  headers={"Authorization": f"Bearer {other_token}"})
    assert forbidden.status_code == 403

    ok = await client.post(f"/seller/alerts/{alert_id}/dismiss",
                           headers={"Authorization": f"Bearer {seller_token}"})
    assert ok.status_code == 200

    resp = await client.get("/seller/action-items", headers={"Authorization": f"Bearer {seller_token}"})
    assert not any(i.get("alert_id") == alert_id for i in resp.json())
