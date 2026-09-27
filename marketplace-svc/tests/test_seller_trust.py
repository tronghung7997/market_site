"""Seller trust score and tier progress (admin-approved tiers)."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import update

from src.database import SessionLocal
from src.models.account import Account
from src.models.order import Order, OrderStatus
from src.sellers.trust import DEFAULT_CONFIG, Metrics, evaluate, public_bands, trust_score, validate_config
from tests.conftest import make_admin, register_and_login
from tests.test_orders import setup_buyable_product


def metrics(**over) -> Metrics:
    base = dict(gmv_lifetime=31_400_000, orders_lifetime=138, days_selling=96, orders_window=125, disputes_window=3,
                reviews_window=32, one_star_window=1, gmv_window=12_500_000, completed_window=58)
    return Metrics(**{**base, **over})


def test_score_matches_the_design_example():
    # 2.4 % disputes, 3.1 % one-star, 12.5M in the window → 30 + 25 + 17 = 72.
    assert trust_score(metrics(), DEFAULT_CONFIG) == 72


def test_no_score_before_enough_completed_orders():
    assert trust_score(metrics(completed_window=9), DEFAULT_CONFIG) is None
    bands = public_bands(metrics(completed_window=9), None)
    assert bands == {"trust_score": None, "dispute_band": None, "one_star_band": None}
    assert public_bands(metrics(), 72) == {"trust_score": 72, "dispute_band": "medium", "one_star_band": "low"}


def test_progress_toward_the_next_tier_and_keep_checks():
    result = evaluate("verified", metrics(), DEFAULT_CONFIG)
    assert result["next_tier"] == "trusted" and result["next_tier_promotable"]
    unmet = {row["key"] for row in result["criteria"] if row["met"] is False}
    assert unmet == {"min_gmv", "min_orders", "min_score"}
    assert result["met"] == 3 and result["eligible"] is False
    assert result["at_risk"] == []

    # 6 / 125 = 4.8 % disputes: over the 3 % keep line, and it drags the score to 63 (< 75).
    risky = evaluate("trusted", metrics(disputes_window=6), DEFAULT_CONFIG)
    assert [row["key"] for row in risky["at_risk"]] == ["max_dispute_pct", "min_score"]
    # Enterprise is by invitation: never reported as reachable.
    assert risky["next_tier"] == "enterprise" and risky["eligible"] is False

    ready = evaluate("new", metrics(), DEFAULT_CONFIG)
    assert ready["next_tier"] == "verified" and ready["eligible"] is True


def test_missing_score_is_skipped_not_failed():
    result = evaluate("new", metrics(completed_window=5), DEFAULT_CONFIG)
    score_row = next(row for row in result["criteria"] if row["key"] == "min_score")
    assert score_row["met"] is None and result["eligible"] is True


def test_config_validation():
    bad = deepcopy(DEFAULT_CONFIG)
    bad["score"]["gmv"]["points"] = 20
    with pytest.raises(ValueError, match="add up to 100"):
        validate_config(bad)
    bad = deepcopy(DEFAULT_CONFIG)
    bad["criteria"]["verified"]["max_dispute_pct"] = 150
    with pytest.raises(ValueError):
        validate_config(bad)
    ok = deepcopy(DEFAULT_CONFIG)
    ok["criteria"]["verified"]["min_days"] = None
    assert validate_config(ok)["criteria"]["verified"]["min_days"] is None


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_seller_sees_own_progress_and_seeded_orders_do_not_count(client):
    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    for _ in range(2):
        order = await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))
        await client.post(f"/orders/{order.json()['id']}/confirm", headers=_auth(buyer))
    progress = await client.get("/seller/tier-progress", headers=_auth(seller))
    assert progress.status_code == 200, progress.text
    body = progress.json()
    assert body["tier"] == "new" and body["next_tier"] == "verified"
    assert body["metrics"]["orders_lifetime"] == 2 and body["metrics"]["gmv_lifetime"] == 2000
    assert body["score"] is None  # fewer than 10 completed orders
    assert body["current_rule"]["tier"] == "new" and body["next_rule"]["tier"] == "verified"

    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.status == OrderStatus.completed).values(is_seeded=True))
        await db.commit()
    body = (await client.get("/seller/tier-progress", headers=_auth(seller))).json()
    assert body["metrics"]["orders_lifetime"] == 0

    assert (await client.get("/seller/tier-progress", headers=_auth(buyer))).status_code == 403


@pytest.mark.asyncio
async def test_admin_edits_criteria_and_sees_the_review_queue(client):
    _, seller, admin, _, _ = await setup_buyable_product(client)
    config = (await client.get("/admin/seller-trust-config", headers=_auth(admin))).json()
    assert config["criteria"]["verified"]["min_orders"] == 20

    config["criteria"]["verified"].update({"min_gmv": None, "min_orders": 0, "min_days": 0})
    saved = await client.put("/admin/seller-trust-config", json=config, headers=_auth(admin))
    assert saved.status_code == 200, saved.text
    config["score"]["dispute"]["points"] = 10
    rejected = await client.put("/admin/seller-trust-config", json=config, headers=_auth(admin))
    assert rejected.status_code == 422

    queue = (await client.get("/admin/seller-tier-review", headers=_auth(admin))).json()
    row = next(r for r in queue if r["tier"] == "new")
    assert row["next_tier"] == "verified" and row["eligible"] is True
    assert queue[0]["eligible"] is True  # eligible sellers first

    assert (await client.get("/admin/seller-tier-review", headers=_auth(seller))).status_code == 403
    assert (await client.put("/admin/seller-trust-config", json=config, headers=_auth(seller))).status_code == 403


@pytest.mark.asyncio
async def test_public_profile_carries_only_score_and_bands(client):
    _, seller, _, _, _ = await setup_buyable_product(client)
    async with SessionLocal() as db:
        key = (await db.execute(
            Account.__table__.select().where(Account.email == "ord_seller@example.com")
        )).mappings().one()["public_key"]
    body = (await client.get(f"/sellers/{key}")).json()
    assert body["trust_score"] is None and body["dispute_band"] is None
    assert "disputes_window" not in body and "metrics" not in body


@pytest.mark.asyncio
async def test_approving_a_tier_notifies_the_seller(client):
    _, seller, admin, _, _ = await setup_buyable_product(client)
    me = (await client.get("/me", headers=_auth(seller))).json()
    moved = await client.patch(f"/admin/accounts/{me['id']}/tier", json={"seller_tier": "verified"}, headers=_auth(admin))
    assert moved.status_code == 200, moved.text
    items = (await client.get("/seller/action-items", headers=_auth(seller))).json()
    assert any(item.get("href") == "/seller/tier" for item in items)
    assert (await client.get("/seller/tier-progress", headers=_auth(seller))).json()["tier"] == "verified"
