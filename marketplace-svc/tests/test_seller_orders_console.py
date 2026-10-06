"""GET /seller/orders — paginated seller console listing."""
import pytest

from tests.conftest import make_seller, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _seed(client):
    """3 instant orders (1 completed, 1 delivered+disputed, 1 delivered) + 1 pending manual."""
    buyer_token, seller_token, admin_token, instant_vid, manual_vid = await setup_buyable_product(client)
    buyer, seller = _auth(buyer_token), _auth(seller_token)
    ids = {}
    r = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    ids["completed"] = r.json()["id"]
    assert (await client.post(f"/orders/{ids['completed']}/confirm", headers=buyer)).status_code == 200
    r = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    ids["disputed"] = r.json()["id"]
    opened = await client.post(f"/orders/{ids['disputed']}/dispute", json={"reason": "Broken"}, headers=buyer)
    assert opened.status_code in (200, 201), opened.text
    r = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    ids["delivered"] = r.json()["id"]
    r = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1}, headers=buyer)
    ids["pending"] = r.json()["id"]
    return buyer, seller, ids


@pytest.mark.asyncio
async def test_seller_orders_paginated_with_counts_and_facets(client):
    _, seller, ids = await _seed(client)
    resp = await client.get("/seller/orders", headers=seller)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 4
    assert body["page"] == 1 and body["per_page"] == 20
    assert [o["id"] for o in body["items"]] == [ids["pending"], ids["delivered"], ids["disputed"], ids["completed"]]
    assert body["counts"] == {
        "all": 4, "disputed": 1, "action_required": 1, "escrow": 1, "completed": 1, "cancelled": 0,
        "disputes_awaiting_seller": 1,
    }
    assert [p["title"] for p in body["products"]] == ["Order Test"]
    disputed = next(o for o in body["items"] if o["id"] == ids["disputed"])
    assert disputed["has_dispute"] is True
    assert disputed["dispute_awaiting_seller"] is True
    assert disputed["fulfillment"]["kind"] == "instant"
    pending = next(o for o in body["items"] if o["id"] == ids["pending"])
    assert pending["fulfillment"]["kind"] == "manual"

    page2 = await client.get("/seller/orders", params={"per_page": 3, "page": 2}, headers=seller)
    assert page2.json()["total"] == 4
    assert [o["id"] for o in page2.json()["items"]] == [ids["completed"]]


@pytest.mark.asyncio
async def test_seller_orders_tabs_filters_and_sort(client):
    _, seller, ids = await _seed(client)

    async def ids_for(**params):
        r = await client.get("/seller/orders", params=params, headers=seller)
        assert r.status_code == 200, r.text
        return [o["id"] for o in r.json()["items"]]

    assert await ids_for(tab="disputed") == [ids["disputed"]]
    assert await ids_for(tab="escrow") == [ids["delivered"]]
    assert await ids_for(tab="action_required") == [ids["pending"]]
    assert await ids_for(tab="completed") == [ids["completed"]]
    assert await ids_for(tab="cancelled") == []
    assert await ids_for(kind="manual") == [ids["pending"]]
    assert set(await ids_for(kind="instant")) == {ids["completed"], ids["disputed"], ids["delivered"]}
    assert await ids_for(search=f"#{ids['completed']}") == [ids["completed"]]
    assert await ids_for(search="Manual Var") == [ids["pending"]]
    # Buyers' emails are masked for the seller: the whole address finds the
    # orders, a fragment never does (it would unmask the email bit by bit).
    assert len(await ids_for(search="ORD_BUYER@EXAMPLE.COM")) == 4
    assert await ids_for(search="ord_buyer@") == []
    # Part of an order code, as read off the row, finds that order.
    code = (await client.get("/seller/orders", params={"tab": "completed"}, headers=seller)).json()["items"][0]["order_code"]
    assert ids["completed"] in await ids_for(search=code[4:8])
    assert ids["completed"] in await ids_for(search=code.lower()[:7])
    assert await ids_for(search="nothing-matches") == []
    assert (await ids_for(sort="oldest"))[:1] == [ids["completed"]]
    assert (await ids_for(sort="amount_desc"))[:1] == [ids["pending"]]  # 5000 vs 1000
    assert await ids_for(date_from="2999-01-01") == []
    assert len(await ids_for(date_to="2999-01-01")) == 4

    product_id = (await client.get("/seller/orders", headers=seller)).json()["products"][0]["id"]
    assert len(await ids_for(product_id=product_id)) == 4
    assert await ids_for(product_id=999999) == []

    # Counts are store-wide, not filtered.
    r = await client.get("/seller/orders", params={"tab": "cancelled"}, headers=seller)
    assert r.json()["total"] == 0 and r.json()["counts"]["all"] == 4

    assert (await client.get("/seller/orders", params={"tab": "bogus"}, headers=seller)).status_code == 422
    assert (await client.get("/seller/orders", params={"sort": "bogus"}, headers=seller)).status_code == 422


@pytest.mark.asyncio
async def test_seller_orders_scoped_and_role_guarded(client):
    buyer, _, _ = await _seed(client)
    assert (await client.get("/seller/orders", headers=buyer)).status_code == 403
    await register_and_login(client, "console_other@example.com")
    await make_seller("console_other@example.com")
    other = await register_and_login(client, "console_other@example.com")
    body = (await client.get("/seller/orders", headers=_auth(other))).json()
    assert body["total"] == 0 and body["items"] == [] and body["products"] == []
    assert body["counts"]["all"] == 0


@pytest.mark.asyncio
async def test_seller_orders_dates_are_the_viewers_calendar_days(client):
    """An order placed 03:30 on 06/01 in Vietnam (20:30 UTC on 05/01) belongs
    to 06/01 for a Vietnamese seller, and to 05/01 for one reading in UTC."""
    from datetime import datetime, timezone
    from sqlalchemy import update
    from src.database import SessionLocal
    from src.models.order import Order

    buyer, seller, ids = await _seed(client)
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == ids["completed"]).values(
            created_at=datetime(2026, 1, 5, 20, 30, tzinfo=timezone.utc)))
        await db.commit()

    async def ids_for(**params):
        r = await client.get("/seller/orders", params=params, headers=seller)
        assert r.status_code == 200, r.text
        return [o["id"] for o in r.json()["items"]]

    day = {"date_from": "2026-01-06", "date_to": "2026-01-06"}
    assert await ids_for(**day) == [ids["completed"]]  # default zone: Asia/Ho_Chi_Minh
    assert await ids_for(**day, tz="Asia/Ho_Chi_Minh") == [ids["completed"]]
    assert await ids_for(**day, tz="UTC") == []
    assert await ids_for(date_from="2026-01-05", date_to="2026-01-05", tz="UTC") == [ids["completed"]]
    # An unknown zone falls back to Vietnam rather than failing the list.
    assert await ids_for(**day, tz="Mars/Olympus") == [ids["completed"]]
    # The buyer's list reads dates the same way.
    r = await client.get("/orders", params={**day}, headers=buyer)
    assert ids["completed"] in [o["id"] for o in r.json()["items"]]
    r = await client.get("/orders", params={**day, "tz": "UTC"}, headers=buyer)
    assert ids["completed"] not in [o["id"] for o in r.json()["items"]]


def test_created_at_bounds_whole_days_and_explicit_times():
    from datetime import datetime, timezone
    from src.orders.date_range import created_at_bounds

    lower, upper = created_at_bounds("2026-10-06", "2026-10-06", "Asia/Ho_Chi_Minh")
    assert lower == datetime(2026, 10, 5, 17, 0, tzinfo=timezone.utc)
    assert upper == datetime(2026, 10, 6, 17, 0, tzinfo=timezone.utc)
    # A value with its own time and offset is used as-is; garbage is ignored.
    lower, upper = created_at_bounds("2026-10-06T08:00:00+00:00", "not-a-date")
    assert lower == datetime(2026, 10, 6, 8, 0, tzinfo=timezone.utc) and upper is None
