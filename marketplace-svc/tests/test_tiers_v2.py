"""Seller & buyer tiers v2: automatic seller tiers (promote, immediate
dispute demotion, grace, manual lock), absolute tier fee + per-seller fee
promo, buyer tiers, cashback and their admin endpoints."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, update

from src.buyer_tiers.cashback import apply_buyer_cashback, cashback_amount, clawback_buyer_cashback
from src.buyer_tiers.config import DEFAULT_CONFIG as BUYER_DEFAULT, level_for, validate_config as validate_buyer
from src.database import SessionLocal
from src.ledger.service import reconcile_ledger
from src.models.account import Account
from src.models.buyer_tier import BuyerCashback, BuyerTierEvent
from src.models.log_entry import LogEntry
from src.models.mail import MailOutbox
from src.models.notification import Notification
from src.models.order import Order
from src.models.product import Product
from src.models.seller_fee_promo import SellerFeePromo
from src.models.seller_tier_event import SellerTierEvent
from src.models.seller_tier_state import SellerTierState
from src.models.wallet import Transaction, TransactionType, Wallet
from src.sellers import tier_auto
from src.sellers.tier_auto import decide, run_tier_job
from src.sellers.trust import DEFAULT_CONFIG, Metrics
from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product

NOW = datetime(2026, 10, 7, 3, 0, tzinfo=timezone.utc)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def metrics(**over) -> Metrics:
    base = dict(gmv_lifetime=600_000_000, orders_lifetime=300, days_selling=120, orders_window=100,
                disputes_window=1, reviews_window=50, one_star_window=0, gmv_window=100_000_000,
                completed_window=90)
    return Metrics(**{**base, **over})


# ── decide(): pure rules ─────────────────────────────────────────────────────

def test_dispute_breach_demotes_at_once_to_the_tier_the_rate_fits():
    # trusted ceiling 3 %, verified 8 %: 5 % lands on verified, 12 % on new.
    five = decide("trusted", metrics(disputes_window=5), DEFAULT_CONFIG, locked=False, at_risk_since=None, now=NOW)
    assert five["action"] == "demote" and five["target"] == "verified" and five["reason"] == "dispute_rate"
    twelve = decide("trusted", metrics(disputes_window=12), DEFAULT_CONFIG, locked=False, at_risk_since=None, now=NOW)
    assert twelve["target"] == "new"
    # No grace: a seller already warned for something else is demoted the same run.
    warned = decide("verified", metrics(disputes_window=9), DEFAULT_CONFIG, locked=False,
                    at_risk_since=NOW - timedelta(days=1), now=NOW)
    assert warned["action"] == "demote" and warned["target"] == "new" and warned["clear_risk"]


def test_dispute_rate_needs_enough_orders_in_the_window():
    # 1 dispute out of 2 orders is 50 %, but below dispute_min_orders (20) it is noise.
    few = decide("verified", metrics(orders_window=2, disputes_window=1, completed_window=2),
                 DEFAULT_CONFIG, locked=False, at_risk_since=None, now=NOW)
    assert few["action"] != "demote"


def test_other_keep_criteria_warn_then_demote_after_grace():
    bad_reviews = metrics(reviews_window=20, one_star_window=5)  # 25 % one-star, verified keeps ≤ 10 %
    first = decide("verified", bad_reviews, DEFAULT_CONFIG, locked=False, at_risk_since=None, now=NOW)
    assert first["action"] == "warn" and "max_one_star_pct" in first["keys"]
    within = decide("verified", bad_reviews, DEFAULT_CONFIG, locked=False, at_risk_since=NOW - timedelta(days=3), now=NOW)
    assert within["action"] == "at_risk" and within["target"] is None
    expired = decide("verified", bad_reviews, DEFAULT_CONFIG, locked=False, at_risk_since=NOW - timedelta(days=14), now=NOW)
    assert expired["action"] == "demote" and expired["target"] == "new" and expired["reason"] == "grace_expired"
    recovered = decide("verified", metrics(), DEFAULT_CONFIG, locked=False, at_risk_since=NOW - timedelta(days=3), now=NOW)
    assert recovered["clear_risk"] is True


def test_promotion_lock_and_enterprise():
    ready = decide("new", metrics(), DEFAULT_CONFIG, locked=False, at_risk_since=None, now=NOW)
    assert ready["action"] == "promote" and ready["target"] == "verified"
    # One step per run.
    assert decide("verified", metrics(), DEFAULT_CONFIG, locked=False, at_risk_since=None, now=NOW)["target"] == "trusted"
    # trusted → enterprise is invitation-only.
    assert decide("trusted", metrics(), DEFAULT_CONFIG, locked=False, at_risk_since=None, now=NOW)["action"] == "keep"
    assert decide("trusted", metrics(disputes_window=50), DEFAULT_CONFIG, locked=True, at_risk_since=None, now=NOW)["action"] == "locked"
    assert decide("enterprise", metrics(disputes_window=50), DEFAULT_CONFIG, locked=False, at_risk_since=None, now=NOW)["action"] == "skip"
    # Not enough GMV for verified (client ladder 5 000 $ ≈ 125 M₫).
    assert decide("new", metrics(gmv_lifetime=10_000_000), DEFAULT_CONFIG, locked=False, at_risk_since=None, now=NOW)["action"] == "keep"


# ── job + admin endpoints ────────────────────────────────────────────────────

async def _seller_id() -> int:
    async with SessionLocal() as db:
        return await db.scalar(select(Account.id).where(Account.email == "ord_seller@example.com"))


async def _buyer_id() -> int:
    async with SessionLocal() as db:
        return await db.scalar(select(Account.id).where(Account.email == "ord_buyer@example.com"))


async def _easy_criteria(client, admin: str, **auto) -> None:
    cfg = (await client.get("/admin/seller-trust-config", headers=_auth(admin))).json()
    cfg["criteria"]["verified"].update({"min_gmv": None, "min_orders": 1, "min_days": None, "min_score": None})
    cfg["auto"].update(auto)
    saved = await client.put("/admin/seller-trust-config", json=cfg, headers=_auth(admin))
    assert saved.status_code == 200, saved.text


async def _buy_and_confirm(client, buyer: str, variant_id: int) -> dict:
    order = await client.post("/orders", json={"variant_id": variant_id, "quantity": 1}, headers=_auth(buyer))
    assert order.status_code == 201, order.text
    confirmed = await client.post(f"/orders/{order.json()['id']}/confirm", headers=_auth(buyer))
    assert confirmed.status_code == 200, confirmed.text
    return order.json()


@pytest.mark.asyncio
async def test_job_preview_then_run_promotes_notifies_and_mails(client):
    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    await _buy_and_confirm(client, buyer, instant_id)
    await _easy_criteria(client, admin)
    seller_id = await _seller_id()

    preview = await client.post("/admin/tier-job/run", json={"dry_run": True}, headers=_auth(admin))
    assert preview.status_code == 200, preview.text
    change = next(c for c in preview.json()["seller_changes"] if c["account_id"] == seller_id)
    assert change["action"] == "promote" and change["target"] == "verified"
    async with SessionLocal() as db:
        assert (await db.get(Account, seller_id)).seller_tier.value == "new"  # dry run changes nothing

    ran = await client.post("/admin/tier-job/run", json={"dry_run": False}, headers=_auth(admin))
    assert ran.status_code == 200 and ran.json()["sellers"]["promoted"] == 1
    async with SessionLocal() as db:
        assert (await db.get(Account, seller_id)).seller_tier.value == "verified"
        event = await db.scalar(select(SellerTierEvent).where(SellerTierEvent.account_id == seller_id))
        assert event.new_tier == "verified" and event.reason.startswith("Tự động")
        assert await db.scalar(select(MailOutbox.id).where(
            MailOutbox.account_id == seller_id, MailOutbox.template == "seller_tier_changed"))
        assert await db.scalar(select(Notification.id).where(
            Notification.account_id == seller_id, Notification.kind == "tier_changed"))
        assert await db.scalar(select(LogEntry.id).where(LogEntry.metadata_["event"].astext == "seller_tier_auto_changed"))

    # Idempotent: a second run changes nothing more (trusted is out of reach).
    again = (await client.post("/admin/tier-job/run", json={"dry_run": False}, headers=_auth(admin))).json()
    assert again["sellers"]["promoted"] == 0 and again["sellers"]["demoted"] == 0

    # Admins only.
    assert (await client.post("/admin/tier-job/run", json={"dry_run": True}, headers=_auth(seller))).status_code == 403
    progress = (await client.get("/seller/tier-progress", headers=_auth(seller))).json()
    assert progress["tier"] == "verified" and progress["locked"] is False and progress["auto_enabled"] is True


@pytest.mark.asyncio
async def test_manual_tier_is_locked_until_unlocked(client, monkeypatch):
    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    seller_id = await _seller_id()
    moved = await client.patch(f"/admin/accounts/{seller_id}/tier", json={"seller_tier": "trusted", "reason": "Đối tác lớn"},
                               headers=_auth(admin))
    assert moved.status_code == 200, moved.text

    async def breach(*_a, **_k):
        return metrics(disputes_window=40)

    monkeypatch.setattr(tier_auto.trust, "load_metrics", breach)
    await run_tier_job()
    async with SessionLocal() as db:
        assert (await db.get(Account, seller_id)).seller_tier.value == "trusted"
        assert (await db.get(SellerTierState, seller_id)).locked is True

    assert (await client.patch(f"/admin/sellers/{seller_id}/tier-lock", json={"locked": False}, headers=_auth(seller))).status_code == 403
    unlocked = await client.patch(f"/admin/sellers/{seller_id}/tier-lock", json={"locked": False}, headers=_auth(admin))
    assert unlocked.status_code == 200 and unlocked.json() == {"locked": False}
    from src.models.ops_telegram import OpsTelegramConfig, OpsTelegramOutbox

    async with SessionLocal() as db:
        db.add(OpsTelegramConfig(id=1, enabled=True, bot_token="123456:test-token", ops_chat_id="-1001"))
        await db.commit()
    summary = await run_tier_job()
    assert summary["sellers"]["demoted"] == 1
    async with SessionLocal() as db:
        # 40 % disputes fits no ceiling: straight to new, no grace.
        assert (await db.get(Account, seller_id)).seller_tier.value == "new"
        reasons = (await db.scalars(select(SellerTierEvent.reason).where(SellerTierEvent.account_id == seller_id)
                                    .order_by(SellerTierEvent.id))).all()
        assert reasons[-1].startswith("Tự động: tỷ lệ khiếu nại")
        # The operators' group hears about a dispute demotion (once per seller and day).
        ops = (await db.scalars(select(OpsTelegramOutbox).where(OpsTelegramOutbox.kind == "seller_tier_demoted"))).all()
        assert len(ops) == 1 and ops[0].dedupe_key.startswith(f"seller_tier_demoted:{seller_id}:")
        assert await db.scalar(select(LogEntry.id).where(LogEntry.metadata_["event"].astext == "seller_tier_lock_changed"))


@pytest.mark.asyncio
async def test_switching_auto_off_stops_the_scheduled_seller_run(client):
    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    await _buy_and_confirm(client, buyer, instant_id)
    await _easy_criteria(client, admin, enabled=False)
    summary = await run_tier_job()  # the scheduled run (no admin)
    assert summary["seller_auto_enabled"] is False and summary["sellers"]["checked"] == 0
    async with SessionLocal() as db:
        assert (await db.get(Account, await _seller_id())).seller_tier.value == "new"
    bad = (await client.get("/admin/seller-trust-config", headers=_auth(admin))).json()
    bad["auto"]["grace_days"] = -1
    assert (await client.put("/admin/seller-trust-config", json=bad, headers=_auth(admin))).status_code == 422


# ── fees: absolute tier fee, category, promo ─────────────────────────────────

async def _platform_balance() -> int:
    async with SessionLocal() as db:
        return int(await db.scalar(select(Wallet.available_balance).where(Wallet.account_id == 1)) or 0)


@pytest.mark.asyncio
async def test_fee_order_promo_category_tier_default(client):
    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    seller_id = await _seller_id()
    async with SessionLocal() as db:
        category_id = await db.scalar(select(Product.category_id).where(Product.title == "Order Test"))
    assert (await client.patch("/admin/fee-config", json={"platform_fee_percent": 10}, headers=_auth(admin))).status_code == 200
    assert (await client.patch("/admin/seller-tier-config", json={"tiers": {"new": {"fee_percent": 6}}},
                               headers=_auth(admin))).status_code == 200

    async def fee_of_next_order() -> int:
        before = await _platform_balance()
        await _buy_and_confirm(client, buyer, instant_id)
        return await _platform_balance() - before

    assert await fee_of_next_order() == 60            # tier fee replaces the 10 % default

    # Promo: 0 % for 90 days (+ Elite badge) beats everything.
    bad = await client.put(f"/admin/sellers/{seller_id}/fee-promo", json={"badge_tier": "gold"}, headers=_auth(admin))
    assert bad.status_code == 422
    assert (await client.put(f"/admin/sellers/{seller_id}/fee-promo", json={}, headers=_auth(seller))).status_code == 403
    granted = await client.put(f"/admin/sellers/{seller_id}/fee-promo", json={"badge_tier": "trusted", "note": "Onboarding"},
                               headers=_auth(admin))
    assert granted.status_code == 200, granted.text
    body = granted.json()
    assert body["fee_percent"] == 0 and body["active"] is True and body["badge_tier"] == "trusted"
    ends = datetime.fromisoformat(body["ends_at"])
    assert timedelta(days=89) < ends - datetime.now(timezone.utc) <= timedelta(days=90)
    assert await fee_of_next_order() == 0
    progress = (await client.get("/seller/tier-progress", headers=_auth(seller))).json()
    assert progress["fee_percent"] == 0 and progress["fee_promo"]["active"] is True

    # The promo badge shows next to the name on storefront payloads.
    listing = (await client.get("/products")).json()["items"]
    row = next(p for p in listing if p["title"] == "Order Test")
    assert row["seller_badge_tier"] == "trusted"

    # Expired promo: back to the normal rule; the category fee wins over the tier.
    async with SessionLocal() as db:
        await db.execute(update(SellerFeePromo).where(SellerFeePromo.account_id == seller_id)
                         .values(starts_at=datetime.now(timezone.utc) - timedelta(days=91),
                                 ends_at=datetime.now(timezone.utc) - timedelta(minutes=1)))
        await db.commit()
    assert (await client.patch("/admin/fee-config", json={"category_fee_percent": {str(category_id): 25}},
                               headers=_auth(admin))).status_code == 200
    assert await fee_of_next_order() == 250
    row = next(p for p in (await client.get("/products")).json()["items"] if p["title"] == "Order Test")
    assert row["seller_badge_tier"] == "new"

    assert (await client.delete(f"/admin/sellers/{seller_id}/fee-promo", headers=_auth(admin))).status_code == 204
    async with SessionLocal() as db:
        assert await db.get(SellerFeePromo, seller_id) is None
        events = (await db.scalars(select(LogEntry).where(LogEntry.metadata_["event"].astext == "seller_fee_promo_changed")
                                   .order_by(LogEntry.id))).all()
        assert len(events) == 2 and events[0].metadata_["new"]["fee_percent"] == 0
        assert (await reconcile_ledger(db)).ok


@pytest.mark.asyncio
async def test_fee_promo_any_percent_any_end_date_or_open_ended(client):
    """Admins set any fee from 0 to 100 % for one seller, until a chosen date or
    with no end date (a standing own fee); it applies at once and is audited."""
    from src.fees.service import platform_fee_percent_for

    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    seller_id = await _seller_id()
    assert (await client.patch("/admin/fee-config", json={"platform_fee_percent": 10}, headers=_auth(admin))).status_code == 200

    async def fee_now() -> float:
        async with SessionLocal() as db:
            return await platform_fee_percent_for(db, seller_tier="new", category_id=None, seller_id=seller_id)

    url = f"/admin/sellers/{seller_id}/fee-promo"
    until = (datetime.now(timezone.utc) + timedelta(days=45)).replace(microsecond=0)
    dated = await client.put(url, json={"fee_percent": 4.5, "ends_at": until.isoformat()}, headers=_auth(admin))
    assert dated.status_code == 200, dated.text
    assert dated.json()["fee_percent"] == 4.5 and datetime.fromisoformat(dated.json()["ends_at"]) == until
    assert await fee_now() == 4.5

    for bad in ({"fee_percent": 101}, {"fee_percent": -1},
                {"ends_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()},
                {"days": 0}):
        resp = await client.put(url, json=bad, headers=_auth(admin))
        assert resp.status_code == 422, (bad, resp.text)
    assert (await client.put(url, json={"open_ended": True}, headers=_auth(seller))).status_code == 403
    assert (await client.put(url, json={"open_ended": True})).status_code == 401

    # Open-ended: no end date, beats category / tier / default until revoked.
    standing = await client.put(url, json={"fee_percent": 2, "open_ended": True, "days": 30, "note": "phí riêng"},
                                headers=_auth(admin))
    assert standing.status_code == 200, standing.text
    assert standing.json()["ends_at"] is None and standing.json()["active"] is True
    assert await fee_now() == 2
    async with SessionLocal() as db:
        far = datetime.now(timezone.utc) + timedelta(days=20 * 365)
        assert await platform_fee_percent_for(db, seller_tier="new", category_id=None, seller_id=seller_id, at=far) == 2
    before = await _platform_balance()
    await _buy_and_confirm(client, buyer, instant_id)
    assert await _platform_balance() - before == 20       # 2 % of 1 000
    progress = (await client.get("/seller/tier-progress", headers=_auth(seller))).json()
    assert progress["fee_percent"] == 2 and progress["fee_promo"]["ends_at"] is None
    async with SessionLocal() as db:
        events = (await db.scalars(select(LogEntry).where(LogEntry.metadata_["event"].astext == "seller_fee_promo_changed")
                                   .order_by(LogEntry.id))).all()
        assert [e.metadata_["new"]["fee_percent"] for e in events] == [4.5, 2]
        assert events[-1].metadata_["new"]["ends_at"] is None and events[-1].metadata_["old"]["fee_percent"] == 4.5
        note = await db.scalar(select(Notification).where(Notification.kind == "seller_fee_promo").order_by(Notification.id.desc()))
        assert note.params == {"fee_percent": 2.0}
    # The seller's cash-flow view settles held orders at an open-ended promo too.
    held = await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))
    assert held.status_code == 201, held.text
    schedule = await client.get("/seller/escrow-schedule", headers=_auth(seller))
    assert schedule.status_code == 200, schedule.text

    # Revoking returns to the normal rule.
    assert (await client.delete(url, headers=_auth(admin))).status_code == 204
    assert await fee_now() == 10


# ── buyer tiers ──────────────────────────────────────────────────────────────

def test_buyer_config_validation_and_levels():
    cfg = validate_buyer(deepcopy(BUYER_DEFAULT))
    assert level_for(cfg, 0) == "l1" and level_for(cfg, 25_000_000) == "l2" and level_for(cfg, 10**9) == "l3"
    for broken in (
        {"criterion": "total_bought"},
        {"levels": {**BUYER_DEFAULT["levels"], "l2": {**BUYER_DEFAULT["levels"]["l2"], "min_amount": 200_000_000}}},
        {"levels": {**BUYER_DEFAULT["levels"], "l1": {**BUYER_DEFAULT["levels"]["l1"], "min_amount": 5}}},
        {"levels": {**BUYER_DEFAULT["levels"], "l3": {**BUYER_DEFAULT["levels"]["l3"], "cashback_percent": 80}}},
        {"levels": {**BUYER_DEFAULT["levels"], "l2": {**BUYER_DEFAULT["levels"]["l2"], "api_requests_per_minute": 0}}},
        {"ip_requests_per_minute": 59},
        {"ip_requests_per_minute": 10_001},
        {"ip_requests_per_minute": 120.5},
    ):
        with pytest.raises(ValueError):
            validate_buyer({**deepcopy(BUYER_DEFAULT), **broken})
    assert cfg["ip_requests_per_minute"] == 500
    # A document saved before the flood guard was configurable reads as the default.
    legacy = deepcopy(BUYER_DEFAULT)
    legacy.pop("ip_requests_per_minute")
    assert validate_buyer(legacy)["ip_requests_per_minute"] == 500
    assert validate_buyer({**deepcopy(BUYER_DEFAULT), "ip_requests_per_minute": 60})["ip_requests_per_minute"] == 60
    assert cashback_amount(1_000, 1) == 10 and cashback_amount(999, 1) == 9 and cashback_amount(1_000, 0) == 0


@pytest.mark.asyncio
async def test_buyer_tier_config_admin_and_recompute(client):
    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    cfg = await client.get("/admin/buyer-tier-config", headers=_auth(admin))
    assert cfg.status_code == 200 and cfg.json()["criterion"] == "total_spent"
    body = cfg.json()
    body["levels"]["l2"]["min_amount"] = 500
    body["levels"]["l3"]["min_amount"] = 100_000
    body["levels"]["l2"]["name_vi"] = "Bạc"
    assert (await client.put("/admin/buyer-tier-config", json=body, headers=_auth(buyer))).status_code == 403
    bad = deepcopy(body)
    bad["levels"]["l3"]["min_amount"] = 100
    assert (await client.put("/admin/buyer-tier-config", json=bad, headers=_auth(admin))).status_code == 422
    saved = await client.put("/admin/buyer-tier-config", json=body, headers=_auth(admin))
    assert saved.status_code == 200, saved.text
    async with SessionLocal() as db:
        entry = await db.scalar(select(LogEntry).where(LogEntry.metadata_["event"].astext == "buyer_tier_config_changed"))
        assert entry.metadata_["changed"]["l2.min_amount"] == [25_000_000, 500]

    await _buy_and_confirm(client, buyer, instant_id)   # 1 000 ₫ spent
    progress = (await client.get("/account/buyer-tier", headers=_auth(buyer))).json()
    assert progress["tier"] == "l1" and progress["value"] == 1000 and progress["reached_tier"] == "l2"

    preview = (await client.post("/admin/tier-job/run", json={"dry_run": True}, headers=_auth(admin))).json()
    buyer_id = await _buyer_id()
    assert any(c["account_id"] == buyer_id and c["to"] == "l2" for c in preview["buyer_changes"])
    await run_tier_job()
    progress = (await client.get("/account/buyer-tier", headers=_auth(buyer))).json()
    assert progress["tier"] == "l2" and progress["current"]["name_vi"] == "Bạc" and progress["history"][0]["new_tier"] == "l2"
    async with SessionLocal() as db:
        assert await db.scalar(select(func.count(BuyerTierEvent.id)).where(BuyerTierEvent.account_id == buyer_id)) == 1
    # Public ladder, and the admin can read any account's figure.
    public = (await client.get("/public/buyer-tiers")).json()
    assert [lv["tier"] for lv in public["levels"]] == ["l1", "l2", "l3"]
    assert (await client.get(f"/admin/accounts/{buyer_id}/buyer-tier", headers=_auth(admin))).json()["tier"] == "l2"
    assert (await client.get(f"/admin/accounts/{buyer_id}/buyer-tier", headers=_auth(buyer))).status_code == 403


# ── cashback ─────────────────────────────────────────────────────────────────

async def _set_buyer_tier(tier: str) -> None:
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == "ord_buyer@example.com").values(buyer_tier=tier))
        await db.commit()


async def _cashback_rows(order_id: int) -> list[Transaction]:
    async with SessionLocal() as db:
        return list((await db.scalars(select(Transaction).where(
            Transaction.reference_id == f"order-{order_id}",
            Transaction.type.in_((TransactionType.cashback, TransactionType.cashback_clawback)),
        ).order_by(Transaction.id))).all())


@pytest.mark.asyncio
async def test_cashback_on_settlement_idempotent_and_clawed_back(client):
    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    await _set_buyer_tier("l3")   # 3 %
    before = (await client.get("/wallet", headers=_auth(buyer))).json()["available_balance"]
    order = await _buy_and_confirm(client, buyer, instant_id)
    after = (await client.get("/wallet", headers=_auth(buyer))).json()["available_balance"]
    assert after == before - 1000 + 30
    rows = await _cashback_rows(order["id"])
    assert [(r.type, r.amount) for r in rows] == [(TransactionType.cashback, 30)]

    async with SessionLocal() as db:
        o = await db.get(Order, order["id"])
        assert await apply_buyer_cashback(o, db) == 0      # already paid
        await db.commit()
        assert (await reconcile_ledger(db)).ok
        record = await db.scalar(select(BuyerCashback).where(BuyerCashback.order_id == o.id))
        assert record.tier == "l3" and record.rate_percent == 3 and record.base_amount == 1000

    # A later full refund takes it back (once).
    async with SessionLocal() as db:
        o = await db.get(Order, order["id"])
        assert await clawback_buyer_cashback(o, db) == 30
        assert await clawback_buyer_cashback(o, db) == 0
        await db.commit()
        assert (await reconcile_ledger(db)).ok
    rows = await _cashback_rows(order["id"])
    assert [(r.type, r.amount) for r in rows] == [(TransactionType.cashback, 30), (TransactionType.cashback_clawback, 30)]
    progress = (await client.get("/account/buyer-tier", headers=_auth(buyer))).json()
    assert progress["cashback_total"] == 0


@pytest.mark.asyncio
async def test_no_cashback_for_l1_seeded_or_refunded_orders(client):
    buyer, seller, admin, instant_id, _ = await setup_buyable_product(client)
    order = await _buy_and_confirm(client, buyer, instant_id)   # l1 = 0 %
    assert await _cashback_rows(order["id"]) == []

    await _set_buyer_tier("l2")
    for change in ({"is_seeded": True}, {"refunded_amount": 100}):
        placed = await client.post("/orders", json={"variant_id": instant_id, "quantity": 1}, headers=_auth(buyer))
        async with SessionLocal() as db:
            o = await db.get(Order, placed.json()["id"])
            for key, value in change.items():
                setattr(o, key, value)
            o.status = "completed"
            assert await apply_buyer_cashback(o, db) == 0
            await db.rollback()
