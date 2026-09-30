"""Promo codes: admin campaigns, checkout discount, platform-funded settlement."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from src.database import SessionLocal
from src.fees.service import platform_fee_percent_for
from src.ledger.service import reconcile_ledger
from src.models.order import Order
from src.models.promotion import PromotionRedemption
from src.models.wallet import Transaction, TransactionType, Wallet
from src.wallet.service import promo_subsidy
from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _promo(client, admin_token, **overrides):
    body = {"code": "sale10", "name": "Sale 10%", "discount_type": "percent", "discount_value": 10, **overrides}
    resp = await client.post("/admin/promotions", json=body, headers=_auth(admin_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _category_id(product_variant_id: int) -> int:
    async with SessionLocal() as db:
        return await db.scalar(text(
            "SELECT p.category_id FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = :v"
        ), {"v": product_variant_id})


async def _wallet(account_email: str) -> int:
    async with SessionLocal() as db:
        return await db.scalar(text(
            "SELECT w.available_balance FROM wallets w JOIN accounts a ON a.id = w.account_id WHERE a.email = :e"
        ), {"e": account_email})


# ── Admin console ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_creates_lists_pauses_and_deletes_a_campaign(client):
    _, _, admin_token, _, _ = await setup_buyable_product(client)
    promo = await _promo(client, admin_token, code="  welcome-9 ", max_discount_amount=5000, budget_amount=100000)
    assert promo["code"] == "WELCOME-9"
    assert promo["state"] == "running" and promo["uses"] == 0 and promo["per_buyer_limit"] == 1

    listed = (await client.get("/admin/promotions", headers=_auth(admin_token))).json()["items"]
    assert [p["code"] for p in listed] == ["WELCOME-9"]

    paused = await client.patch(f"/admin/promotions/{promo['id']}", json={"is_active": False}, headers=_auth(admin_token))
    assert paused.status_code == 200 and paused.json()["state"] == "paused"
    # A partial edit keeps every other field.
    assert paused.json()["max_discount_amount"] == 5000 and paused.json()["budget_amount"] == 100000

    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    scheduled = await client.patch(
        f"/admin/promotions/{promo['id']}", json={"is_active": True, "starts_at": future}, headers=_auth(admin_token),
    )
    assert scheduled.json()["state"] == "scheduled"

    assert (await client.delete(f"/admin/promotions/{promo['id']}", headers=_auth(admin_token))).status_code == 204
    assert (await client.get("/admin/promotions", headers=_auth(admin_token))).json()["items"] == []


@pytest.mark.asyncio
async def test_admin_input_is_validated(client):
    _, _, admin_token, _, _ = await setup_buyable_product(client)
    bad = [
        {"discount_value": 150},                                            # percent above 100
        {"discount_type": "fixed", "discount_value": 5000, "max_discount_amount": 1000},  # cap on fixed
        {"code": "a b"},                                                    # not a code
        {"starts_at": "2026-10-10T00:00:00Z", "ends_at": "2026-10-01T00:00:00Z"},
        {"discount_value": 0},
    ]
    for override in bad:
        body = {"code": "x-code", "name": "X", "discount_type": "percent", "discount_value": 10, **override}
        resp = await client.post("/admin/promotions", json=body, headers=_auth(admin_token))
        assert resp.status_code == 422, (override, resp.text)

    await _promo(client, admin_token)
    dup = await client.post("/admin/promotions", json={
        "code": "SALE10", "name": "Again", "discount_type": "fixed", "discount_value": 1000,
    }, headers=_auth(admin_token))
    assert dup.status_code == 409 and dup.json()["error_code"] == "PROMO_CODE_TAKEN"

    # A partial edit is validated against the stored values too.
    promo_id = (await client.get("/admin/promotions", headers=_auth(admin_token))).json()["items"][0]["id"]
    resp = await client.patch(f"/admin/promotions/{promo_id}", json={"discount_value": 500}, headers=_auth(admin_token))
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_non_admin_cannot_manage_campaigns(client):
    buyer_token, seller_token, admin_token, _, _ = await setup_buyable_product(client)
    promo = await _promo(client, admin_token)
    for token in (buyer_token, seller_token):
        assert (await client.get("/admin/promotions", headers=_auth(token))).status_code == 403
        assert (await client.post("/admin/promotions", json={
            "code": "HACK", "name": "x", "discount_type": "percent", "discount_value": 100,
        }, headers=_auth(token))).status_code == 403
        assert (await client.patch(f"/admin/promotions/{promo['id']}", json={"discount_value": 100}, headers=_auth(token))).status_code == 403
        assert (await client.delete(f"/admin/promotions/{promo['id']}", headers=_auth(token))).status_code == 403
    assert (await client.get("/admin/promotions")).status_code == 401


# ── Checkout ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_quote_prices_the_code_without_writing(client):
    buyer_token, _, admin_token, instant_vid, _ = await setup_buyable_product(client)
    await _promo(client, admin_token, max_discount_amount=150)
    quote = await client.post("/orders/quote", json={
        "variant_id": instant_vid, "quantity": 2, "promo_code": "sale10",
    }, headers=_auth(buyer_token))
    assert quote.status_code == 200, quote.text
    assert quote.json() == {"subtotal_amount": 2000, "discount_amount": 150, "total_amount": 1850, "promo_code": "SALE10"}

    plain = await client.post("/orders/quote", json={"variant_id": instant_vid, "quantity": 2}, headers=_auth(buyer_token))
    assert plain.json()["discount_amount"] == 0 and plain.json()["total_amount"] == 2000

    unknown = await client.post("/orders/quote", json={
        "variant_id": instant_vid, "quantity": 1, "promo_code": "NOPE",
    }, headers=_auth(buyer_token))
    assert unknown.status_code == 400 and unknown.json()["error_code"] == "PROMO_NOT_FOUND"
    async with SessionLocal() as db:
        assert (await db.scalar(select(PromotionRedemption.id))) is None
    assert (await client.post("/orders/quote", json={"variant_id": instant_vid, "quantity": 1})).status_code == 401


@pytest.mark.asyncio
async def test_order_with_code_charges_the_discounted_total(client):
    buyer_token, _, admin_token, instant_vid, _ = await setup_buyable_product(client)
    promo = await _promo(client, admin_token)
    before = await _wallet("ord_buyer@example.com")
    resp = await client.post("/orders", json={
        "variant_id": instant_vid, "quantity": 2, "expected_unit_price": 1000, "promo_code": "Sale10",
    }, headers=_auth(buyer_token))
    assert resp.status_code == 201, resp.text
    order = resp.json()
    assert order["total_amount"] == 1800 and order["discount_amount"] == 200 and order["promo_code"] == "SALE10"
    assert before - await _wallet("ord_buyer@example.com") == 1800

    listed = (await client.get("/admin/promotions", headers=_auth(admin_token))).json()["items"][0]
    assert listed["uses"] == 1 and listed["discount_given"] == 200
    redemptions = (await client.get(f"/admin/promotions/{promo['id']}/redemptions", headers=_auth(admin_token))).json()["items"]
    assert redemptions[0]["code"] == "SALE10"
    assert redemptions[0]["order_code"] == order["order_code"] and redemptions[0]["discount_amount"] == 200

    # One use per buyer by default.
    again = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1, "promo_code": "SALE10"}, headers=_auth(buyer_token))
    assert again.status_code == 400 and again.json()["error_code"] == "PROMO_ALREADY_USED"

    # A used campaign keeps its code and cannot be deleted.
    rename = await client.patch(f"/admin/promotions/{promo['id']}", json={"code": "OTHER"}, headers=_auth(admin_token))
    assert rename.status_code == 409 and rename.json()["error_code"] == "PROMO_LOCKED"
    delete = await client.delete(f"/admin/promotions/{promo['id']}", headers=_auth(admin_token))
    assert delete.status_code == 409


@pytest.mark.asyncio
async def test_campaign_rules_refuse_ineligible_orders(client):
    buyer_token, _, admin_token, instant_vid, manual_vid = await setup_buyable_product(client)
    headers = _auth(buyer_token)
    now = datetime.now(timezone.utc)

    async def quote(code: str, vid: int = instant_vid, quantity: int = 1):
        return await client.post("/orders/quote", json={"variant_id": vid, "quantity": quantity, "promo_code": code}, headers=headers)

    await _promo(client, admin_token, code="MIN5K", min_order_amount=5000)
    resp = await quote("MIN5K")
    assert resp.json()["error_code"] == "PROMO_MIN_ORDER" and resp.json()["params"] == {"min": 5000}
    assert (await quote("MIN5K", manual_vid)).status_code == 200

    await _promo(client, admin_token, code="LATER", starts_at=(now + timedelta(days=1)).isoformat())
    assert (await quote("LATER")).json()["error_code"] == "PROMO_NOT_STARTED"
    await _promo(client, admin_token, code="OVER", starts_at=(now - timedelta(days=2)).isoformat(), ends_at=(now - timedelta(days=1)).isoformat())
    assert (await quote("OVER")).json()["error_code"] == "PROMO_EXPIRED"
    await _promo(client, admin_token, code="PAUSED", is_active=False)
    assert (await quote("PAUSED")).json()["error_code"] == "PROMO_NOT_FOUND"

    other = await client.post("/admin/categories", json={"name": "Other", "slug": "other-cat"}, headers=_auth(admin_token))
    await _promo(client, admin_token, code="OTHERCAT", category_ids=[other.json()["id"]])
    assert (await quote("OTHERCAT")).json()["error_code"] == "PROMO_NOT_APPLICABLE"
    # A campaign on the product's category (or a parent of it) applies.
    await _promo(client, admin_token, code="OWNCAT", category_ids=[await _category_id(instant_vid)])
    assert (await quote("OWNCAT")).status_code == 200

    await _promo(client, admin_token, code="FIRST", new_buyers_only=True)
    assert (await quote("FIRST")).status_code == 200
    assert (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=headers)).status_code == 201
    assert (await quote("FIRST")).json()["error_code"] == "PROMO_NEW_BUYERS_ONLY"


@pytest.mark.asyncio
async def test_usage_and_budget_ceilings_and_cancelled_orders_give_the_use_back(client):
    buyer_token, _, admin_token, instant_vid, manual_vid = await setup_buyable_product(client)
    other_token = await register_and_login(client, "promo_other@example.com")
    other_id = (await client.get("/me", headers=_auth(other_token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": other_id, "amount": 100000}, headers=_auth(admin_token))

    await _promo(client, admin_token, code="ONCE", usage_limit=1)
    first = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1, "promo_code": "ONCE"}, headers=_auth(buyer_token))
    assert first.status_code == 201
    blocked = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1, "promo_code": "ONCE"}, headers=_auth(other_token))
    assert blocked.json()["error_code"] == "PROMO_EXHAUSTED"
    async with SessionLocal() as db:
        await db.execute(text("UPDATE orders SET status = 'cancelled' WHERE id = :o"), {"o": first.json()["id"]})
        await db.commit()
    freed = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1, "promo_code": "ONCE"}, headers=_auth(other_token))
    assert freed.status_code == 201, freed.text

    # Budget: 10% of 5 000 = 500 per order, 700 in all → the second order gets the 200 left.
    await _promo(client, admin_token, code="BUDGET", budget_amount=700)
    a = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1, "promo_code": "BUDGET"}, headers=_auth(buyer_token))
    b = await client.post("/orders", json={"variant_id": manual_vid, "quantity": 1, "promo_code": "BUDGET"}, headers=_auth(other_token))
    assert a.json()["discount_amount"] == 500 and b.json()["discount_amount"] == 200 and b.json()["total_amount"] == 4800
    listed = {p["code"]: p for p in (await client.get("/admin/promotions", headers=_auth(admin_token))).json()["items"]}
    assert listed["BUDGET"]["state"] == "exhausted" and listed["BUDGET"]["discount_given"] == 700


# ── Settlement ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_platform_funds_the_discount_at_settlement_and_books_balance(client):
    buyer_token, _, admin_token, instant_vid, _ = await setup_buyable_product(client)
    await _promo(client, admin_token, discount_type="fixed", discount_value=500)
    seller_before = await _wallet("ord_seller@example.com")
    order = (await client.post("/orders", json={
        "variant_id": instant_vid, "quantity": 2, "promo_code": "SALE10",
    }, headers=_auth(buyer_token))).json()
    assert order["total_amount"] == 1500
    confirm = await client.post(f"/orders/{order['id']}/confirm", headers=_auth(buyer_token))
    assert confirm.status_code == 200, confirm.text

    async with SessionLocal() as db:
        pct = await platform_fee_percent_for(db, seller_tier="new", category_id=await _category_id(instant_vid))
        subsidy = await db.scalar(select(Transaction.amount).where(
            Transaction.type == TransactionType.promo_subsidy, Transaction.reference_id == f"order-{order['id']}",
        ))
        report = await reconcile_ledger(db)
    earned = await _wallet("ord_seller@example.com") - seller_before
    # The seller ends up where a full-price sale would have left them (± rounding).
    assert abs(earned - (2000 - int(2000 * pct / 100))) <= 1
    assert subsidy and subsidy <= 500
    assert report.ok, report.findings

    # Settling twice never pays the subsidy twice.
    async with SessionLocal() as db:
        from src.wallet.service import release_escrow
        await release_escrow(order["id"], order["seller_id"], 1500, 0, db)
        await db.commit()
        count = await db.scalar(text("SELECT count(*) FROM transactions WHERE type = 'promo_subsidy'"))
    assert count == 1


@pytest.mark.no_db
def test_subsidy_follows_what_the_seller_keeps():
    # Full settlement: the whole discount, less the fee at the order's rate.
    assert promo_subsidy(500, 1500, 1500, 150) == (500, 50)
    # Half refunded: half the discount.
    assert promo_subsidy(500, 1500, 750, 75) == (250, 25)
    # Nothing kept, or no discount: nothing.
    assert promo_subsidy(500, 1500, 0, 0) == (0, 0)
    assert promo_subsidy(0, 1500, 1500, 150) == (0, 0)


@pytest.mark.asyncio
async def test_open_escrow_with_subsidy_is_flagged(client):
    buyer_token, _, admin_token, instant_vid, _ = await setup_buyable_product(client)
    await _promo(client, admin_token)
    order = (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1, "promo_code": "SALE10"}, headers=_auth(buyer_token))).json()
    async with SessionLocal() as db:
        seller_wallet = await db.scalar(select(Wallet).where(Wallet.account_id == order["seller_id"]))
        seller_wallet.available_balance += 90
        db.add(Transaction(wallet_id=seller_wallet.id, type=TransactionType.promo_subsidy, amount=90, reference_id=f"order-{order['id']}"))
        await db.commit()
        report = await reconcile_ledger(db)
    assert {(f.kind, f.target_id) for f in report.findings} == {("order_release_early", order["id"])}
    async with SessionLocal() as db:
        stored = await db.get(Order, order["id"])
    assert stored.discount_amount == 100
