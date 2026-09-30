"""Promotions console rework: list filters/counts, field-keyed validation,
duplicate/archive, redemptions/stats/CSV, single-use child codes (incl. races)
and the generic audit history endpoint."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from src.database import SessionLocal
from src.models.promotion import PromotionCode, PromotionRedemption
from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _promo(client, admin_token, **overrides):
    body = {"code": "sale10", "name": "Sale 10%", "discount_type": "percent", "discount_value": 10, **overrides}
    resp = await client.post("/admin/promotions", json=body, headers=_auth(admin_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _buyer(client, admin_token, email: str) -> str:
    token = await register_and_login(client, email)
    account_id = (await client.get("/me", headers=_auth(token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test topup", "account_id": account_id, "amount": 100000},
                      headers=_auth(admin_token))
    return token


@pytest.mark.asyncio
async def test_validation_returns_field_keyed_vietnamese_messages(client):
    _, _, admin, _, _ = await setup_buyable_product(client)
    cases = [
        ({"discount_value": 150}, "discount_value"),
        ({"discount_type": "fixed", "discount_value": 5000, "max_discount_amount": 1000}, "max_discount_amount"),
        ({"discount_type": "fixed", "discount_value": 5000, "min_order_amount": 5000}, "discount_value"),
        ({"code": "a b"}, "code"),
        ({"code": "ab"}, "code"),
        ({"starts_at": "2026-10-10T00:00:00Z", "ends_at": "2026-10-01T00:00:00Z"}, "ends_at"),
        ({"name": "   "}, "name"),
        ({"usage_limit": 0}, "usage_limit"),
    ]
    for override, field in cases:
        body = {"code": "x-code", "name": "X", "discount_type": "percent", "discount_value": 10, **override}
        resp = await client.post("/admin/promotions", json=body, headers=_auth(admin))
        assert resp.status_code == 422, (override, resp.text)
        detail = resp.json()["detail"]
        assert detail["code"] == "validation" and field in detail["fields"], (override, detail)
    missing = await client.post("/admin/promotions", json={}, headers=_auth(admin))
    assert set(missing.json()["detail"]["fields"]) >= {"code", "name", "discount_type", "discount_value"}

    # A start in the past is allowed (means "start now"); fixed below the minimum is fine.
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    ok = await _promo(client, admin, code="FIX", discount_type="fixed", discount_value=1000,
                      min_order_amount=5000, starts_at=past)
    assert ok["state"] == "running"
    patch = await client.patch(f"/admin/promotions/{ok['id']}", json={"min_order_amount": 900}, headers=_auth(admin))
    assert patch.status_code == 422 and "discount_value" in patch.json()["detail"]["fields"]


@pytest.mark.asyncio
async def test_list_filters_counts_sort_and_pagination(client):
    _, _, admin, _, _ = await setup_buyable_product(client)
    now = datetime.now(timezone.utc)
    await _promo(client, admin, code="RUN1", name="Chạy một")
    await _promo(client, admin, code="SOON", ends_at=(now + timedelta(hours=10)).isoformat())
    await _promo(client, admin, code="LATER", starts_at=(now + timedelta(days=3)).isoformat())
    await _promo(client, admin, code="OFF", is_active=False)
    await _promo(client, admin, code="OLD", starts_at=(now - timedelta(days=5)).isoformat(),
                 ends_at=(now - timedelta(days=1)).isoformat())
    arch = await _promo(client, admin, code="GONE")
    assert (await client.post(f"/admin/promotions/{arch['id']}/archive", headers=_auth(admin))).status_code == 200

    page = (await client.get("/admin/promotions", headers=_auth(admin))).json()
    assert page["total"] == 5 and "GONE" not in [p["code"] for p in page["items"]]
    assert page["counts"] == {"all": 5, "running": 2, "scheduled": 1, "paused": 1, "attention": 2, "done": 1, "archived": 1}
    assert page["totals_30d"] == {"uses": 0, "discount": 0, "gmv": 0}

    def codes(resp):
        return [p["code"] for p in resp.json()["items"]]

    attention = await client.get("/admin/promotions", params={"state": "attention"}, headers=_auth(admin))
    reasons = {p["code"]: p["attention_reason"] for p in attention.json()["items"]}
    assert reasons == {"SOON": "ending", "OLD": "expired_active"}
    assert codes(await client.get("/admin/promotions", params={"state": "archived"}, headers=_auth(admin))) == ["GONE"]
    assert codes(await client.get("/admin/promotions", params={"q": "chạy"}, headers=_auth(admin))) == ["RUN1"]
    soon = codes(await client.get("/admin/promotions", params={"sort": "ends_soon"}, headers=_auth(admin)))
    assert soon[:2] == ["OLD", "SOON"]
    paged = await client.get("/admin/promotions", params={"per_page": 2, "page": 3}, headers=_auth(admin))
    assert paged.json()["total"] == 5 and len(paged.json()["items"]) == 1
    assert (await client.get("/admin/promotions", params={"per_page": 101}, headers=_auth(admin))).status_code == 422
    assert (await client.get("/admin/promotions", params={"state": "nope"}, headers=_auth(admin))).status_code == 422


@pytest.mark.asyncio
async def test_get_duplicate_archive_and_history(client):
    _, _, admin, _, _ = await setup_buyable_product(client)
    promo = await _promo(client, admin, code="BASE", budget_amount=50000)
    got = await client.get(f"/admin/promotions/{promo['id']}", headers=_auth(admin))
    assert got.status_code == 200 and got.json()["code"] == "BASE" and got.json()["code_count"] == 0
    assert (await client.get("/admin/promotions/999999", headers=_auth(admin))).status_code == 404

    copy = await client.post(f"/admin/promotions/{promo['id']}/duplicate", headers=_auth(admin))
    assert copy.status_code == 201
    assert copy.json()["code"] == "BASE-COPY" and copy.json()["is_active"] is False
    assert copy.json()["budget_amount"] == 50000
    again = await client.post(f"/admin/promotions/{promo['id']}/duplicate", headers=_auth(admin))
    assert again.json()["code"] == "BASE-COPY2"

    archived = (await client.post(f"/admin/promotions/{promo['id']}/archive", headers=_auth(admin))).json()
    assert archived["state"] == "archived" and archived["is_active"] is False and archived["archived_at"]
    # An archived campaign cannot be switched back on without unarchiving.
    refused = await client.patch(f"/admin/promotions/{promo['id']}", json={"is_active": True}, headers=_auth(admin))
    assert refused.status_code == 409 and refused.json()["error_code"] == "PROMO_ARCHIVED"
    restored = (await client.post(f"/admin/promotions/{promo['id']}/unarchive", headers=_auth(admin))).json()
    assert restored["state"] == "paused" and restored["archived_at"] is None

    history = await client.get("/admin/audit/entity", params={"type": "promotion", "id": promo["id"]}, headers=_auth(admin))
    assert history.status_code == 200
    events = [row["event"] for row in history.json()]
    assert events == ["promotion_unarchived", "promotion_archived", "promotion_created"]
    assert history.json()[0]["actor_email"] == "ord_admin@example.com" and "ip" not in history.json()[0]["details"]
    assert (await client.get("/admin/audit/entity", params={"type": "wallet", "id": 1}, headers=_auth(admin))).status_code == 422


@pytest.mark.asyncio
async def test_redemptions_stats_and_csv(client):
    buyer, _, admin, instant_vid, _ = await setup_buyable_product(client)
    promo = await _promo(client, admin, code="STAT")
    order = (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 2, "promo_code": "stat"},
                               headers=_auth(buyer))).json()

    page = (await client.get(f"/admin/promotions/{promo['id']}/redemptions", headers=_auth(admin))).json()
    assert page["total"] == 1 and page["page"] == 1
    row = page["items"][0]
    assert row["order_code"] == order["order_code"] and row["code"] == "STAT"
    assert row["discount_amount"] == 200 and row["order_total"] == 1800 and row["buyer_email"] == "ord_buyer@example.com"
    none = await client.get(f"/admin/promotions/{promo['id']}/redemptions", params={"q": "nobody@x"}, headers=_auth(admin))
    assert none.json()["total"] == 0

    stats = (await client.get(f"/admin/promotions/{promo['id']}/stats", params={"days": 7}, headers=_auth(admin))).json()
    assert len(stats["series"]) == 7 and stats["uses"] == 1 and stats["discount"] == 200 and stats["gmv"] == 1800
    assert stats["new_buyers"] == 1 and stats["series"][-1]["uses"] == 1

    listed = (await client.get(f"/admin/promotions/{promo['id']}", headers=_auth(admin))).json()
    assert listed["gmv"] == 1800 and listed["uses"] == 1

    csv_resp = await client.get(f"/admin/promotions/{promo['id']}/redemptions.csv", headers=_auth(admin))
    assert csv_resp.status_code == 200 and csv_resp.headers["content-type"].startswith("text/csv")
    lines = csv_resp.text.lstrip("﻿").strip().splitlines()
    assert lines[0].startswith("Order_Code,") and order["order_code"] in lines[1]


@pytest.mark.asyncio
async def test_child_codes_generate_list_and_redeem_once(client):
    buyer, _, admin, instant_vid, manual_vid = await setup_buyable_product(client)
    other = await _buyer(client, admin, "promo_child2@example.com")
    promo = await _promo(client, admin, code="VIP", per_buyer_limit=None)

    bad = await client.post(f"/admin/promotions/{promo['id']}/codes", json={"count": 0}, headers=_auth(admin))
    assert bad.status_code == 422
    bad = await client.post(f"/admin/promotions/{promo['id']}/codes", json={"count": 5, "prefix": "a b"}, headers=_auth(admin))
    assert bad.status_code == 422
    made = await client.post(f"/admin/promotions/{promo['id']}/codes", json={"count": 25, "prefix": "vip-", "length": 6},
                             headers=_auth(admin))
    assert made.status_code == 201 and made.json() == {"created": 25}
    codes = (await client.get(f"/admin/promotions/{promo['id']}/codes", params={"per_page": 100}, headers=_auth(admin))).json()
    assert codes["total"] == 25
    assert all(c["code"].startswith("VIP-") and len(c["code"]) == 10 for c in codes["items"])
    assert not any(ch in "".join(c["code"][4:] for c in codes["items"]) for ch in "01OIL")
    child = codes["items"][0]["code"]

    # A child code cannot be taken as a campaign code.
    clash = await client.post("/admin/promotions", json={
        "code": child, "name": "x", "discount_type": "percent", "discount_value": 5,
    }, headers=_auth(admin))
    assert clash.status_code == 409 and clash.json()["error_code"] == "PROMO_CODE_TAKEN"

    quote = await client.post("/orders/quote", json={"variant_id": manual_vid, "quantity": 1, "promo_code": child.lower()},
                              headers=_auth(buyer))
    assert quote.status_code == 200 and quote.json()["promo_code"] == child
    first = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1, "promo_code": child},
                              headers=_auth(buyer))
    assert first.status_code == 201, first.text
    assert first.json()["promo_code"] == child and first.json()["discount_amount"] == 500
    reused = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1, "promo_code": child},
                               headers=_auth(other))
    assert reused.status_code == 400 and reused.json()["error_code"] == "PROMO_EXHAUSTED"
    # The parent code keeps working.
    parent = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1, "promo_code": "VIP"},
                               headers=_auth(other))
    assert parent.status_code == 201

    used = (await client.get(f"/admin/promotions/{promo['id']}/codes", params={"status": "used"}, headers=_auth(admin))).json()
    assert [c["code"] for c in used["items"]] == [child] and used["items"][0]["order_code"] == first.json()["order_code"]
    unused = (await client.get(f"/admin/promotions/{promo['id']}/codes", params={"status": "unused"}, headers=_auth(admin))).json()
    assert unused["total"] == 24
    view = (await client.get(f"/admin/promotions/{promo['id']}", headers=_auth(admin))).json()
    assert view["code_count"] == 25 and view["codes_redeemed"] == 1 and view["uses"] == 2
    redemptions = (await client.get(f"/admin/promotions/{promo['id']}/redemptions", headers=_auth(admin))).json()
    assert sorted(r["code"] for r in redemptions["items"]) == sorted([child, "VIP"])
    csv_resp = await client.get(f"/admin/promotions/{promo['id']}/codes.csv", params={"status": "used"}, headers=_auth(admin))
    assert csv_resp.status_code == 200 and child in csv_resp.text
    # Child codes are found by the list search.
    found = await client.get("/admin/promotions", params={"q": child}, headers=_auth(admin))
    assert [p["code"] for p in found.json()["items"]] == ["VIP"]


@pytest.mark.asyncio
async def test_child_code_race_redeems_exactly_once(client):
    _, _, admin, _, manual_vid = await setup_buyable_product(client)
    tokens = [await _buyer(client, admin, f"race{i}@example.com") for i in range(4)]
    promo = await _promo(client, admin, code="RACE", per_buyer_limit=None)
    await client.post(f"/admin/promotions/{promo['id']}/codes", json={"count": 1}, headers=_auth(admin))
    child = (await client.get(f"/admin/promotions/{promo['id']}/codes", headers=_auth(admin))).json()["items"][0]["code"]

    results = await asyncio.gather(*(
        client.post("/orders", json={"variant_id": manual_vid, "quantity": 1, "promo_code": child}, headers=_auth(t))
        for t in tokens
    ))
    statuses = sorted(r.status_code for r in results)
    assert statuses == [201, 400, 400, 400], [r.text for r in results]
    assert all(r.json()["error_code"] == "PROMO_EXHAUSTED" for r in results if r.status_code == 400)
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count(PromotionRedemption.id)).where(PromotionRedemption.code == child)) == 1
        code_row = await db.scalar(select(PromotionCode).where(PromotionCode.code == child))
        assert code_row.redeemed_order_id is not None


@pytest.mark.asyncio
async def test_non_admin_cannot_use_console_endpoints(client):
    buyer, seller, admin, _, _ = await setup_buyable_product(client)
    promo = await _promo(client, admin)
    pid = promo["id"]
    calls = [
        ("get", f"/admin/promotions/{pid}"), ("post", f"/admin/promotions/{pid}/duplicate"),
        ("post", f"/admin/promotions/{pid}/archive"), ("post", f"/admin/promotions/{pid}/unarchive"),
        ("get", f"/admin/promotions/{pid}/redemptions"), ("get", f"/admin/promotions/{pid}/redemptions.csv"),
        ("get", f"/admin/promotions/{pid}/stats"), ("get", f"/admin/promotions/{pid}/codes"),
        ("get", f"/admin/promotions/{pid}/codes.csv"), ("get", f"/admin/audit/entity?type=promotion&id={pid}"),
    ]
    for token in (buyer, seller):
        for method, url in calls:
            assert (await getattr(client, method)(url, headers=_auth(token))).status_code == 403, url
        resp = await client.post(f"/admin/promotions/{pid}/codes", json={"count": 1}, headers=_auth(token))
        assert resp.status_code == 403
    assert (await client.get(f"/admin/promotions/{pid}/stats")).status_code == 401
