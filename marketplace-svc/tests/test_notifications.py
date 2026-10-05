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
    dispute_id = disputes.json()["items"][-1]["id"]
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
    # Each queue carries its oldest waiting entry for the bell's "chờ 6 giờ".
    for key in ("admin_pending_applications", "admin_open_disputes", "admin_pending_withdrawals", "admin_pending_tasks"):
        assert items[key]["since"] is not None


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
    app_id = apps.json()["items"][-1]["id"]

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


@pytest.mark.asyncio
async def test_buyer_can_dismiss_own_alert_but_not_sellers(client):
    buyer_token = await register_and_login(client, "notif_dismiss_buyer@example.com")
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]
    seller_token = await register_and_login(client, "notif_dismiss_buyer_seller@example.com")
    await make_seller("notif_dismiss_buyer_seller@example.com")
    seller_token = await register_and_login(client, "notif_dismiss_buyer_seller@example.com")
    seller_me = await client.get("/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = seller_me.json()["id"]

    async with SessionLocal() as db:
        buyer_alert = await add_alert(
            db,
            type_="buyer_dispute_resource_resolved",
            severity="info",
            target_type="buyer",
            target_id=buyer_id,
            message="Đơn #1: seller hoàn 1 tài khoản (#91).",
            href="/orders?order_id=1&resources=91",
        )
        seller_alert = await add_alert(
            db,
            type_="seller_dispute_resource_resolved",
            severity="info",
            target_type="seller",
            target_id=seller_id,
            message="Đơn #1: đã hoàn 1 tài khoản cho buyer (#91).",
            href="/seller/orders?order_id=1&resources=91",
        )
        await db.commit()
        buyer_alert_id = buyer_alert.id
        seller_alert_id = seller_alert.id

    inbox = await client.get("/orders/action-items", headers={"Authorization": f"Bearer {buyer_token}"})
    assert any(item.get("alert_id") == buyer_alert_id for item in inbox.json())
    forbidden = await client.post(
        f"/me/alerts/{seller_alert_id}/dismiss",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert forbidden.status_code == 403
    ok = await client.post(
        f"/me/alerts/{buyer_alert_id}/dismiss",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert ok.status_code == 200
    after = await client.get("/orders/action-items", headers={"Authorization": f"Bearer {buyer_token}"})
    assert not any(item.get("alert_id") == buyer_alert_id for item in after.json())


@pytest.mark.asyncio
async def test_buyer_action_items_never_count_an_order_twice(client):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import update
    from src.models.order import Order

    buyer_token, _, _, instant_vid, _ = await setup_buyable_product(client)
    for _ in range(2):
        await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1},
                          headers={"Authorization": f"Bearer {buyer_token}"})
    async with SessionLocal() as db:
        first = (await db.execute(Order.__table__.select().order_by(Order.id).limit(1))).first()
        await db.execute(update(Order).where(Order.id == first.id)
                         .values(escrow_expires_at=datetime.now(timezone.utc) + timedelta(hours=3)))
        await db.commit()
    items = {i["key"]: i["count"] for i in (await client.get(
        "/orders/action-items", headers={"Authorization": f"Bearer {buyer_token}"})).json()}
    assert items["buyer_escrow_expiring"] == 1 and items["buyer_delivered_unconfirmed"] == 1


@pytest.mark.asyncio
async def test_seller_action_items_list_unanswered_written_reviews(client):
    buyer_token, seller_token, _, instant_vid, _ = await setup_buyable_product(client)
    buyer = {"Authorization": f"Bearer {buyer_token}"}
    seller = {"Authorization": f"Bearer {seller_token}"}
    order = (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)).json()
    await client.post(f"/orders/{order['id']}/confirm", headers=buyer)
    review = await client.post(f"/orders/{order['order_code']}/review", json={"rating": 4, "comment": "Ổn"}, headers=buyer)
    assert review.status_code == 201, review.text

    items = {i["key"]: i for i in (await client.get("/seller/action-items", headers=seller)).json()}
    assert items["seller_unreplied_reviews"]["count"] == 1
    assert items["seller_unreplied_reviews"]["href"].endswith("?tab=reviews")

    await client.put(f"/seller/reviews/{review.json()['id']}/reply", json={"body": "Cảm ơn bạn"}, headers=seller)
    keys = [i["key"] for i in (await client.get("/seller/action-items", headers=seller)).json()]
    assert "seller_unreplied_reviews" not in keys


@pytest.mark.asyncio
async def test_seller_action_items_query_count_does_not_grow_with_products(client):
    """/me/action-items is polled by every open tab: prod traces showed 74
    statements per call because each product resolved its pricing and every
    open dispute was fully enriched just to be counted."""
    from sqlalchemy import event, select

    from src.database import engine
    from src.models.pricing_config import PricingConfig
    from src.models.product import Product
    from src.notifications.service import seller_action_items

    _, seller_token, _, _, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers={"Authorization": f"Bearer {seller_token}"})).json()["id"]

    statements: list[str] = []

    def count(conn, cursor, statement, *args):
        statements.append(statement)

    async def run() -> tuple[int, dict]:
        statements.clear()
        event.listen(engine.sync_engine, "before_cursor_execute", count)
        try:
            async with SessionLocal() as db:
                items = await seller_action_items(seller_id, db)
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", count)
        return len(statements), {i.key: i.count for i in items}

    before, items_before = await run()
    async with SessionLocal() as db:
        template = (await db.execute(select(Product).where(Product.seller_id == seller_id).limit(1))).scalar_one()
        # Priced by the service-level config, no provider → needs setup.
        db.add(PricingConfig(service_type="actionitems_svc", strategy="config", params={"unit_price": 1000}, is_active=True))
        for n in range(5):
            db.add(Product(seller_id=seller_id, category_id=template.category_id, title=f"Cần cấu hình {n}",
                           slug=f"can-cau-hinh-{n}", service_type="actionitems_svc"))
        await db.commit()
    after, items_after = await run()

    assert after == before, statements
    assert items_after.get("seller_needs_setup", 0) == items_before.get("seller_needs_setup", 0) + 5
