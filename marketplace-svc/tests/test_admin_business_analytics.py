"""GET /admin/analytics/business — the admin business analytics contract."""
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import update

from src.analytics.business import bucket_starts, resolve_range
from src.config import settings
from src.database import SessionLocal
from src.models.account import Account
from tests.test_orders import setup_buyable_product

TZ = "Asia/Ho_Chi_Minh"
TODAY = date(2026, 9, 24)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.no_db
class TestBusinessRange:
    def test_calendar_period_compares_same_span_of_previous_unit(self):
        rng = resolve_range("this_month", TZ, None, None, today=TODAY)
        assert (rng.current.from_date, rng.current.to_date) == (date(2026, 9, 1), TODAY)
        assert (rng.compare.from_date, rng.compare.to_date) == (date(2026, 8, 1), date(2026, 8, 24))
        assert rng.granularity == "day"

    def test_full_month_keeps_month_end_when_shifted(self):
        rng = resolve_range("last_month", TZ, None, None, today=date(2026, 10, 5))
        assert (rng.current.from_date, rng.current.to_date) == (date(2026, 9, 1), date(2026, 9, 30))
        assert (rng.compare.from_date, rng.compare.to_date) == (date(2026, 8, 1), date(2026, 8, 31))

    def test_last_quarter_and_yoy(self):
        rng = resolve_range("last_quarter", TZ, None, None, compare="yoy", today=TODAY)
        assert (rng.current.from_date, rng.current.to_date) == (date(2026, 4, 1), date(2026, 6, 30))
        assert (rng.compare.from_date, rng.compare.to_date) == (date(2025, 4, 1), date(2025, 6, 30))
        assert rng.granularity == "week"

    def test_rolling_range_compares_days_right_before(self):
        rng = resolve_range("7d", TZ, None, None, today=TODAY)
        assert (rng.compare.from_date, rng.compare.to_date) == (date(2026, 9, 11), date(2026, 9, 17))

    def test_year_views_bucket_by_month_and_quarter(self):
        assert resolve_range("this_year", TZ, None, None, today=TODAY).granularity == "month"
        rng = resolve_range("custom", TZ, date(2023, 1, 1), date(2026, 9, 1), today=TODAY)
        assert rng.granularity == "quarter"
        assert bucket_starts(date(2026, 2, 15), date(2026, 9, 1), "quarter") == [
            date(2026, 1, 1), date(2026, 4, 1), date(2026, 7, 1),
        ]

    def test_custom_compare_and_none(self):
        rng = resolve_range(
            "custom", TZ, date(2026, 9, 1), date(2026, 9, 10),
            compare="custom", compare_from=date(2026, 3, 1), compare_to=date(2026, 3, 10), today=TODAY,
        )
        assert rng.compare.from_date == date(2026, 3, 1)
        assert resolve_range("30d", TZ, None, None, compare="none", today=TODAY).compare is None

    def test_invalid_inputs_are_400(self):
        for kwargs in (
            {"granularity": "day", "range_key": "custom", "from_date": date(2024, 1, 1), "to_date": date(2026, 1, 1)},
            {"compare": "custom", "range_key": "30d"},
            {"range_key": "custom", "from_date": date(2020, 1, 1), "to_date": date(2026, 1, 1)},
        ):
            key = kwargs.pop("range_key")
            with pytest.raises(HTTPException) as exc:
                resolve_range(
                    key, TZ, kwargs.pop("from_date", None), kwargs.pop("to_date", None), today=TODAY, **kwargs,
                )
            assert exc.value.status_code == 400


async def _seed(client):
    buyer_token, seller_token, admin_token, instant_vid, manual_vid = await setup_buyable_product(client)
    buyer = _auth(buyer_token)
    completed = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    assert completed.status_code == 201, completed.text
    confirmed = await client.post(f"/orders/{completed.json()['id']}/confirm", headers=buyer)
    assert confirmed.status_code == 200, confirmed.text
    delivered = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=buyer)
    assert delivered.json()["status"] == "delivered"
    pending = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1}, headers=buyer)
    assert pending.json()["status"] == "pending"
    return _auth(admin_token), _auth(seller_token)


@pytest.mark.asyncio
async def test_business_analytics_totals_series_and_breakdowns(client):
    admin, _ = await _seed(client)
    resp = await client.get(
        "/admin/analytics/business", params={"range": "30d", "tz": TZ, "granularity": "week"}, headers=admin,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    fee = int(1000 * settings.platform_fee_percent / 100)

    t = body["totals"]
    # The pending manual order (5000) is not paid yet → outside GMV.
    assert (t["orders"], t["paid_orders"], t["gmv"], t["open_orders"]) == (3, 2, 2000, 1)
    assert t["buyers"] == 1 and t["new_buyers"] == 1 and t["new_buyer_gmv"] == 1000
    assert t["platform_fee"] == fee
    assert t["platform_revenue"] == fee - t["affiliate_cost"]
    assert t["internal_gmv"] == 0
    assert body["compare_totals"]["gmv"] == 0

    assert body["range"]["granularity"] == "week"
    assert sum(p["gmv"] for p in body["series"]) == 2000
    assert body["series"][0]["partial"] is True  # 30 days rarely start on a Monday
    assert len(body["compare_series"]) >= 1

    assert body["status"]["completed"] == 1 and body["status"]["pending"] == 1
    [seller] = body["top_sellers"]
    assert seller["gmv"] == 2000 and seller["is_internal"] is False and seller["platform_take"] == fee
    assert body["concentration"]["top1"] == 1.0
    assert [s["segment"] for s in body["segments"]] == ["external"]
    assert body["categories"][0]["name"] == "OrdCat"
    assert body["top_products"][0]["title"] == "Order Test"
    assert sum(c["orders"] for c in body["heatmap"]) == 2
    assert body["new_sellers"] == 1


@pytest.mark.asyncio
async def test_internal_seller_sales_count_as_platform_revenue(client):
    admin, _ = await _seed(client)
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == "ord_seller@example.com").values(is_internal=True))
        await db.commit()

    internal = (await client.get(
        "/admin/analytics/business", params={"range": "7d", "tz": TZ, "segment": "internal"}, headers=admin,
    )).json()
    assert internal["totals"]["gmv"] == 2000
    assert internal["totals"]["internal_gmv"] == 2000
    # The earlier confirm released at the external rate; internal sales are
    # whatever landed in the (now internal) seller's wallet.
    assert internal["totals"]["internal_sales"] > 0
    assert internal["totals"]["platform_revenue"] >= internal["totals"]["internal_sales"]

    external = (await client.get(
        "/admin/analytics/business", params={"range": "7d", "tz": TZ, "segment": "external"}, headers=admin,
    )).json()
    assert external["totals"]["gmv"] == 0 and external["top_sellers"] == []


@pytest.mark.asyncio
async def test_filters_and_options(client):
    admin, _ = await _seed(client)
    options = (await client.get("/admin/analytics/business/filters", headers=admin)).json()
    seller_id = next(s["id"] for s in options["sellers"] if s["email"] == "ord_seller@example.com")
    cat_id = next(c["id"] for c in options["categories"] if c["name"] == "OrdCat")

    by_seller = (await client.get(
        "/admin/analytics/business", params={"range": "7d", "tz": TZ, "seller_id": seller_id}, headers=admin,
    )).json()
    assert by_seller["totals"]["gmv"] == 2000
    by_category = (await client.get(
        "/admin/analytics/business", params={"range": "7d", "tz": TZ, "category_id": cat_id}, headers=admin,
    )).json()
    assert by_category["totals"]["gmv"] == 2000
    other_type = (await client.get(
        "/admin/analytics/business", params={"range": "7d", "tz": TZ, "service_type": "proxy"}, headers=admin,
    )).json()
    assert other_type["totals"]["orders"] == 0


@pytest.mark.asyncio
async def test_business_analytics_requires_admin(client):
    _, seller = await _seed(client)
    assert (await client.get("/admin/analytics/business", headers=seller)).status_code == 403
    assert (await client.get("/admin/analytics/business/filters", headers=seller)).status_code == 403
    assert (await client.get("/admin/analytics/business")).status_code == 401
    bad = await client.get("/admin/analytics/business", params={"range": "forever"})
    assert bad.status_code in (401, 422)
