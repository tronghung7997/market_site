"""GET /seller/dashboard — the seller overview analytics contract."""
from datetime import date, datetime, timedelta, timezone
import zoneinfo

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from src.config import settings
from src.database import SessionLocal
from src.models.wallet import Transaction, TransactionType
from src.seller.dashboard import resolve_range
from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product

TZ = "Asia/Ho_Chi_Minh"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _seed_orders(client):
    """1 completed (released), 1 delivered (escrow), 1 pending manual order."""
    buyer_token, seller_token, admin_token, instant_vid, manual_vid = await setup_buyable_product(client)
    buyer, seller = _auth(buyer_token), _auth(seller_token)

    completed = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    assert completed.status_code == 201, completed.text
    confirmed = await client.post(f"/orders/{completed.json()['id']}/confirm", headers=buyer)
    assert confirmed.status_code == 200, confirmed.text

    delivered = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    assert delivered.json()["status"] == "delivered"

    pending = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1}, headers=buyer)
    assert pending.json()["status"] == "pending"

    async with SessionLocal() as db:
        release = await db.scalar(
            select(Transaction).where(
                Transaction.type == TransactionType.purchase_release,
                Transaction.reference_id == f"order-{completed.json()['id']}",
            )
        )
    return buyer, seller, release.amount


@pytest.mark.no_db
class TestSellerDashboardRange:
    @pytest.mark.parametrize("tz", ["Asia/Saigon", "Asia/Ho_Chi_Minh", "UTC", "America/New_York"])
    def test_timezone_without_system_tzdata(self, tz):
        # Slim runtimes may have no OS timezone database; use the packaged data.
        original_path = zoneinfo.TZPATH
        zoneinfo.ZoneInfo.clear_cache()
        zoneinfo.reset_tzpath(())
        try:
            rng = resolve_range("30d", tz, None, None, today=date(2026, 9, 14))
            assert rng.days == 30
            assert rng.tz == tz
            expected_offset = -4 if tz == "America/New_York" else 0 if tz == "UTC" else 7
            assert rng.start.utcoffset() == timedelta(hours=expected_offset)
            with pytest.raises(HTTPException) as exc:
                resolve_range("30d", "Mars/Olympus", None, None)
            assert exc.value.status_code == 400
        finally:
            zoneinfo.reset_tzpath(original_path)
            zoneinfo.ZoneInfo.clear_cache()

    def test_presets_end_today_in_local_tz(self):
        today = date(2026, 9, 14)
        rng = resolve_range("7d", TZ, None, None, today=today)
        assert (rng.from_date, rng.to_date) == (date(2026, 9, 8), today)
        assert (rng.compare_from_date, rng.compare_to_date) == (date(2026, 9, 1), date(2026, 9, 7))
        assert rng.bucket == "day"
        # Local midnight, expressed as an aware instant (UTC+7).
        assert rng.start == datetime(2026, 9, 7, 17, 0, tzinfo=timezone.utc)

    def test_long_custom_range_buckets_by_week(self):
        rng = resolve_range("custom", TZ, date(2026, 1, 1), date(2026, 6, 30), today=date(2026, 9, 14))
        assert rng.bucket == "week"
        assert rng.days == 181

    def test_custom_to_date_is_clamped_to_today(self):
        rng = resolve_range("custom", "UTC", date(2026, 9, 1), date(2026, 12, 31), today=date(2026, 9, 14))
        assert rng.to_date == date(2026, 9, 14)


@pytest.mark.asyncio
@pytest.mark.parametrize("tz", [TZ, "Asia/Saigon"])
async def test_dashboard_aggregates_money_orders_and_products(client, tz):
    buyer, seller, released = await _seed_orders(client)
    fee_percent = settings.platform_fee_percent
    expected_fee = int(1000 * fee_percent / 100)
    assert released == 1000 - expected_fee

    resp = await client.get("/seller/dashboard", params={"range": "30d", "tz": tz}, headers=seller)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["range"]["key"] == "30d"
    assert body["range"]["days"] == 30
    assert body["range"]["bucket"] == "day"

    money = body["money"]
    # Pending manual order (5000) is not fulfilled → excluded from gross.
    assert money["gross"] == 2000
    assert money["gross_prev"] == 0
    assert money["net_released"] == released
    assert money["platform_fee"] == expected_fee
    assert money["refunded"] == 0
    assert money["escrow_held"] == 1000
    assert money["escrow_orders"] == 1
    assert money["wallet"]["available"] == released

    orders = body["orders"]
    assert orders["total"] == 3
    assert orders["total_prev"] == 0
    assert orders["completed_prev"] == 0
    assert orders["by_status"]["completed"] == 1
    assert orders["by_status"]["delivered"] == 1
    assert orders["by_status"]["pending"] == 1
    assert orders["by_status"]["cancelled"] == 0
    assert orders["completion_rate"] == pytest.approx(1 / 3)
    assert orders["dispute_count"] == 0
    assert orders["avg_order_value"] == 1000

    series = body["timeseries"]
    assert len(series) == 30
    assert series[-1]["date"] == body["range"]["to_date"]
    assert series[-1]["orders"] == 3
    assert series[-1]["gross"] == 2000
    assert series[-1]["net"] == released
    assert sum(p["orders"] for p in series[:-1]) == 0

    assert len(body["top_products"]) == 1
    top = body["top_products"][0]
    assert top["title"] == "Order Test"
    assert top["orders"] == 3
    assert top["gross"] == 2000
    assert top["net"] == released
    assert top["inventory_managed"] is True
    # 3 seeded resources, 2 assigned to the instant orders.
    assert top["total_stock"] == 1
    assert top["stock_state"] == "low"

    inventory = body["inventory"]
    assert inventory["product_count"] == 1
    assert inventory["active_count"] == 1
    assert inventory["managed_products"] == 1
    assert inventory["total_stock"] == 1
    assert inventory["low_stock"] == 1
    assert inventory["out_of_stock"] == 0

    assert body["customers"] == {"unique_buyers": 1, "new_buyers": 1, "returning_buyers": 0}
    assert body["reviews"] == {"rating_avg": None, "rating_count": 0, "count_in_range": 0}

    keys = {item["key"] for item in body["action_items"]}
    assert "seller_pending_orders" in keys


@pytest.mark.asyncio
async def test_custom_range_excluding_today_is_empty_but_snapshots_remain(client):
    _, seller, released = await _seed_orders(client)
    today = datetime.now(timezone.utc).date()
    resp = await client.get("/seller/dashboard", params={
        "range": "custom", "tz": "UTC",
        "from": (today - timedelta(days=10)).isoformat(),
        "to": (today - timedelta(days=2)).isoformat(),
    }, headers=seller)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["range"]["key"] == "custom"
    assert body["range"]["days"] == 9
    assert body["orders"]["total"] == 0
    assert body["orders"]["completion_rate"] is None
    assert body["money"]["gross"] == 0
    assert body["money"]["net_released"] == 0
    assert body["top_products"] == []
    assert len(body["timeseries"]) == 9
    # Escrow and wallet are point-in-time, not range-bound.
    assert body["money"]["escrow_held"] == 1000
    assert body["money"]["wallet"]["available"] == released


@pytest.mark.asyncio
async def test_dashboard_is_scoped_to_the_requesting_seller(client):
    await _seed_orders(client)
    other = await register_and_login(client, "dash_other_seller@example.com")
    from tests.conftest import make_seller
    await make_seller("dash_other_seller@example.com")
    other = await register_and_login(client, "dash_other_seller@example.com")

    resp = await client.get("/seller/dashboard", headers=_auth(other))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["orders"]["total"] == 0
    assert body["money"]["gross"] == 0
    assert body["money"]["escrow_held"] == 0
    assert body["top_products"] == []
    assert body["inventory"]["product_count"] == 0


@pytest.mark.asyncio
async def test_dashboard_rejects_buyers_and_bad_ranges(client):
    buyer, seller, _ = await _seed_orders(client)

    assert (await client.get("/seller/dashboard", headers=buyer)).status_code == 403
    assert (await client.get("/seller/dashboard")).status_code == 401

    bad_preset = await client.get("/seller/dashboard", params={"range": "1y"}, headers=seller)
    assert bad_preset.status_code == 422

    missing_dates = await client.get("/seller/dashboard", params={"range": "custom"}, headers=seller)
    assert missing_dates.status_code == 400
    assert missing_dates.json()["error_code"] == "DASHBOARD_RANGE_INVALID"

    reversed_dates = await client.get("/seller/dashboard", params={
        "range": "custom", "from": "2026-09-10", "to": "2026-09-01",
    }, headers=seller)
    assert reversed_dates.status_code == 400

    too_long = await client.get("/seller/dashboard", params={
        "range": "custom", "from": "2024-01-01", "to": "2026-01-01",
    }, headers=seller)
    assert too_long.status_code == 400

    bad_tz = await client.get("/seller/dashboard", params={"tz": "Mars/Olympus"}, headers=seller)
    assert bad_tz.status_code == 400
    assert bad_tz.json()["error_code"] == "DASHBOARD_RANGE_INVALID"


@pytest.mark.asyncio
async def test_open_dispute_counts_as_disputed_not_delivered(client):
    buyer, seller, _ = await _seed_orders(client)
    delivered_id = next(
        o["id"] for o in (await client.get("/seller/orders", headers=seller)).json()["items"]
        if o["status"] == "delivered"
    )
    opened = await client.post(f"/orders/{delivered_id}/dispute", json={"reason": "Broken"}, headers=buyer)
    assert opened.status_code in (200, 201), opened.text

    body = (await client.get("/seller/dashboard", headers=seller)).json()
    assert body["orders"]["by_status"]["disputed"] == 1
    assert body["orders"]["by_status"]["delivered"] == 0
    assert body["orders"]["dispute_count"] == 1
    assert sum(body["orders"]["by_status"].values()) == body["orders"]["total"]
