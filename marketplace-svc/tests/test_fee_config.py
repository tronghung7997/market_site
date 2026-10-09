"""A5.1 — Settings › Fees & holds: platform fee (default + per category),
escrow floor, withdrawal minimum and fee, all admin-tunable and audited."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.ledger.service import reconcile_ledger
from src.models.category import Category
from src.models.log_entry import LogEntry
from src.models.order import Order
from src.models.product import Product
from src.models.wallet import Transaction, TransactionType, Wallet
from tests.conftest import register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _platform_balance() -> int:
    async with SessionLocal() as db:
        return int(await db.scalar(select(Wallet.available_balance).where(Wallet.account_id == 1)) or 0)


@pytest.mark.asyncio
async def test_admin_config_seeds_from_env_updates_and_audits(client):
    _, _, admin_token, _, _ = await setup_buyable_product(client)
    cfg = await client.get("/admin/fee-config", headers=_auth(admin_token))
    assert cfg.status_code == 200, cfg.text
    assert cfg.json()["platform_fee_percent"] == 0 and cfg.json()["escrow_default_hours"] == 48
    public = await client.get("/public/fee-config")
    assert public.status_code == 200 and "updated_by_id" not in public.json()

    upd = await client.patch("/admin/fee-config", json={
        "platform_fee_percent": 12.5, "category_fee_percent": {"7": 20}, "escrow_min_hours": 72,
        "withdraw_min_amount": 50_000, "withdraw_fee_fixed": 2_000, "withdraw_fee_percent": 1,
    }, headers=_auth(admin_token))
    assert upd.status_code == 200, upd.text
    body = upd.json()
    assert body["platform_fee_percent"] == 12.5 and body["category_fee_percent"] == {"7": 20.0} and body["withdraw_min_amount"] == 50_000
    async with SessionLocal() as db:
        entry = (await db.execute(select(LogEntry).where(LogEntry.metadata_["event"].astext == "fee_runtime_config_changed"))).scalar_one()
    assert entry.level == "warning" and entry.metadata_["changed"]["platform_fee_percent"] == [0.0, 12.5]
    assert entry.metadata_["changed"]["withdraw_min_amount"] == [0, 50_000]

    assert (await client.patch("/admin/fee-config", json={"platform_fee_percent": 101}, headers=_auth(admin_token))).status_code == 422
    assert (await client.patch("/admin/fee-config", json={"category_fee_percent": {"abc": 5}}, headers=_auth(admin_token))).status_code == 422
    user_token = await register_and_login(client, "fee_user@example.com")
    assert (await client.patch("/admin/fee-config", json={"platform_fee_percent": 1}, headers=_auth(user_token))).status_code == 403


@pytest.mark.asyncio
async def test_settlement_uses_admin_fee_and_category_override(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    async with SessionLocal() as db:
        category_id = await db.scalar(select(Product.category_id).where(Product.title == "Order Test"))

    assert (await client.patch("/admin/fee-config", json={"platform_fee_percent": 10}, headers=_auth(admin_token))).status_code == 200
    before = await _platform_balance()
    first = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert (await client.post(f"/orders/{first.json()['id']}/confirm", headers=_auth(buyer_token))).status_code == 200
    assert await _platform_balance() - before == 100          # 10 % of 1 000

    assert (await client.patch("/admin/fee-config", json={"category_fee_percent": {str(category_id): 25}}, headers=_auth(admin_token))).status_code == 200
    before = await _platform_balance()
    second = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert (await client.post(f"/orders/{second.json()['id']}/confirm", headers=_auth(buyer_token))).status_code == 200
    assert await _platform_balance() - before == 250          # category rule wins over the default
    seller_wallet = (await client.get("/wallet", headers=_auth(seller_token))).json()
    assert seller_wallet["available_balance"] == 900 + 750


@pytest.mark.asyncio
async def test_internal_seller_settles_at_zero_fee(client):
    """Seller nội bộ (sàn vận hành): toàn bộ tiền về ví seller nội bộ, không
    trích phí sàn — seller thường vẫn bị trích như cũ."""
    from src.models.account import Account

    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    assert (await client.patch("/admin/fee-config", json={"platform_fee_percent": 10}, headers=_auth(admin_token))).status_code == 200
    async with SessionLocal() as db:
        seller = await db.scalar(select(Account).where(Account.email == "ord_seller@example.com"))
        seller.is_internal = True
        await db.commit()

    before = await _platform_balance()
    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert (await client.post(f"/orders/{order.json()['id']}/confirm", headers=_auth(buyer_token))).status_code == 200
    assert await _platform_balance() == before
    seller_wallet = (await client.get("/wallet", headers=_auth(seller_token))).json()
    assert seller_wallet["available_balance"] == 1000
    async with SessionLocal() as db:
        assert (await reconcile_ledger(db)).ok


@pytest.mark.asyncio
async def test_escrow_floor_and_default_hold_for_new_products(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    async with SessionLocal() as db:
        category_id = await db.scalar(select(Product.category_id).where(Product.title == "Order Test"))

    # Product says 2 days; the admin floor for this category says 7.
    assert (await client.patch("/admin/fee-config", json={"category_escrow_min_hours": {str(category_id): 168}, "escrow_default_hours": 120}, headers=_auth(admin_token))).status_code == 200
    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 201, order.text
    async with SessionLocal() as db:
        expires = (await db.get(Order, order.json()["id"])).escrow_expires_at
    assert timedelta(days=6, hours=23) < expires - datetime.now(timezone.utc) <= timedelta(days=7)

    # A product created without an explicit hold takes the admin default.
    created = await client.post("/seller/products", json={"category_id": category_id, "title": "Default hold", "status": "draft"}, headers=_auth(seller_token))
    assert created.status_code == 201, created.text
    assert created.json()["escrow_hours"] == 120


@pytest.mark.asyncio
async def test_withdraw_minimum_fee_and_ledger(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": seller_id, "amount": 100_000}, headers=_auth(admin_token))
    assert (await client.patch("/admin/fee-config", json={"withdraw_min_amount": 1_000, "withdraw_fee_fixed": 100, "withdraw_fee_percent": 1}, headers=_auth(admin_token))).status_code == 200
    bank = {"bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "SELLER"}

    quote = await client.get("/wallet/withdraw-quote", params={"amount": 10_000}, headers=_auth(seller_token))
    assert quote.status_code == 200 and quote.json() == {"amount": 10_000, "fee_amount": 200, "net_amount": 9_800, "min_amount": 1_000, "fee_fixed": 100, "fee_percent": 1.0}

    low = await client.post("/wallet/withdraw", json={"amount": 500, **bank}, headers=_auth(seller_token))
    assert low.status_code == 400 and low.json()["error_code"] == "WITHDRAW_BELOW_MINIMUM"
    req = await client.post("/wallet/withdraw", json={"amount": 10_000, **bank}, headers=_auth(seller_token))
    assert req.status_code == 200, req.text
    assert req.json()["fee_amount"] == 200 and req.json()["net_amount"] == 9_800

    # Changing the tariff afterwards does not touch a request already made.
    assert (await client.patch("/admin/fee-config", json={"withdraw_fee_fixed": 5_000}, headers=_auth(admin_token))).status_code == 200
    platform_before = await _platform_balance()
    approve = await client.post(f"/admin/withdrawals/{req.json()['id']}/approve", headers=_auth(admin_token))
    assert approve.status_code == 200, approve.text
    assert await _platform_balance() == platform_before        # nothing moves before the transfer
    paid = await client.post(f"/admin/withdrawals/{req.json()['id']}/paid", json={"payout_reference": "FT-FEE"}, headers=_auth(admin_token))
    assert paid.status_code == 200, paid.text
    assert await _platform_balance() - platform_before == 200
    wallet = (await client.get("/wallet", headers=_auth(seller_token))).json()
    assert wallet["available_balance"] == 90_000 and wallet["locked_balance"] == 0

    async with SessionLocal() as db:
        wallet_id = await db.scalar(select(Wallet.id).where(Wallet.account_id == seller_id))
        rows = list((await db.execute(select(Transaction.type, Transaction.amount).where(Transaction.wallet_id == wallet_id, Transaction.reference_id == f"withdraw-{req.json()['id']}").order_by(Transaction.id))).all())
        assert [(t.value, a) for t, a in rows] == [("withdraw_lock", 10_000), ("withdraw", 9_800), ("withdraw_fee", 200)]
        report = await reconcile_ledger(db)
    assert report.ok, report.findings
    assert report.totals["money_out"] == 9_800

    # Rejecting refunds the full locked amount, fee included.
    req2 = await client.post("/wallet/withdraw", json={"amount": 20_000, **bank}, headers=_auth(seller_token))
    assert (await client.post(f"/admin/withdrawals/{req2.json()['id']}/reject", json={"reason": "test"}, headers=_auth(admin_token))).status_code == 200
    wallet = (await client.get("/wallet", headers=_auth(seller_token))).json()
    assert wallet["available_balance"] == 90_000 and wallet["locked_balance"] == 0
    async with SessionLocal() as db:
        assert (await reconcile_ledger(db)).ok


@pytest.mark.asyncio
async def test_audit_names_categories_whose_fee_or_hold_changed(client):
    _, _, admin_token, _, _ = await setup_buyable_product(client)
    async with SessionLocal() as db:
        category_id = await db.scalar(select(Product.category_id).where(Product.title == "Order Test"))
        category_name = await db.scalar(select(Category.name).where(Category.id == category_id))

    resp = await client.patch("/admin/fee-config", json={
        "category_fee_percent": {str(category_id): 9}, "category_escrow_min_hours": {str(category_id): 96},
    }, headers=_auth(admin_token))
    assert resp.status_code == 200, resp.text
    assert (await client.patch("/admin/fee-config", json={"platform_fee_percent": 3}, headers=_auth(admin_token))).status_code == 200

    async with SessionLocal() as db:
        entries = (await db.execute(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "fee_runtime_config_changed").order_by(LogEntry.id)
        )).scalars().all()
    first, second = entries[-2].metadata_, entries[-1].metadata_
    assert first["labels"] == {"categories": {str(category_id): category_name}}
    assert first["changed"]["category_escrow_min_hours"] == [{}, {str(category_id): 96}]
    # A save that touches no per-category map carries no labels.
    assert "labels" not in second and second["changed"] == {"platform_fee_percent": [0.0, 3.0]}


@pytest.mark.no_db
def test_tier_reduction_in_hours_never_goes_under_the_floor():
    from src.sellers.tiers import ESCROW_FLOOR_DEFAULT_HOURS, escrow_hours

    assert ESCROW_FLOOR_DEFAULT_HOURS == 24
    assert escrow_hours("trusted", 72, reduction_hours=24) == 48
    # With the default floor a reduction stops at one day, as before.
    assert escrow_hours("enterprise", 48, reduction_hours=48) == 24
    assert escrow_hours("enterprise", 30, reduction_hours=48) == 24
    # The floor also lifts a shorter product hold.
    assert escrow_hours("enterprise", 12, reduction_hours=48) == 24
    assert escrow_hours("new", 6, reduction_hours=0) == 24
    # A lower admin floor lets holds (and reductions) go further, never under 1 h.
    assert escrow_hours("new", 6, reduction_hours=0, floor_hours=1) == 6
    assert escrow_hours("enterprise", 48, reduction_hours=48, floor_hours=12) == 12
    assert escrow_hours("new", 0, reduction_hours=0, floor_hours=0) == 1
    # A higher floor holds every order longer.
    assert escrow_hours("new", 48, reduction_hours=0, floor_hours=72) == 72


@pytest.mark.asyncio
async def test_holds_are_configured_and_applied_in_hours(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    async with SessionLocal() as db:
        product = await db.scalar(select(Product).where(Product.title == "Order Test"))
        product.escrow_hours = 6
        category_id = product.category_id
        await db.commit()

    # The platform floor (24 h by default) would lift a 6 h hold; the admin lowers it to 1 h.
    assert (await client.patch("/admin/fee-config", json={"escrow_floor_hours": 1}, headers=_auth(admin_token))).status_code == 200
    # Product hold 6 h, minimum 0: the order holds 6 h.
    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 201, order.text
    async with SessionLocal() as db:
        expires = (await db.get(Order, order.json()["id"])).escrow_expires_at
    assert timedelta(hours=5, minutes=59) < expires - datetime.now(timezone.utc) <= timedelta(hours=6)

    # A 36 h category floor lifts it.
    assert (await client.patch("/admin/fee-config", json={"category_escrow_min_hours": {str(category_id): 36}}, headers=_auth(admin_token))).status_code == 200
    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    async with SessionLocal() as db:
        expires = (await db.get(Order, order.json()["id"])).escrow_expires_at
    assert timedelta(hours=35, minutes=59) < expires - datetime.now(timezone.utc) <= timedelta(hours=36)

    # Sellers set a product hold in hours; 0 and > 90 days are refused.
    product_id = order.json()["product_id"]
    assert (await client.patch(f"/seller/products/{product_id}", json={"escrow_hours": 30}, headers=_auth(seller_token))).json()["escrow_hours"] == 30
    for bad in (0, 2161):
        assert (await client.patch(f"/seller/products/{product_id}", json={"escrow_hours": bad}, headers=_auth(seller_token))).status_code == 422

    # Default hold must be at least an hour; floors may be 0; all ≤ 90 days.
    for body in ({"escrow_default_hours": 0}, {"escrow_min_hours": 2161}, {"category_escrow_min_hours": {str(category_id): 2161}}):
        assert (await client.patch("/admin/fee-config", json=body, headers=_auth(admin_token))).status_code == 422, body
    public = (await client.get("/public/fee-config")).json()
    assert public["escrow_default_hours"] == 48 and public["category_escrow_min_hours"] == {str(category_id): 36}
    assert (await client.patch("/admin/fee-config", json={"escrow_default_hours": 12}, headers=_auth(seller_token))).status_code == 403


@pytest.mark.asyncio
async def test_hold_floor_is_configurable_and_no_hold_goes_under_it(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    async with SessionLocal() as db:
        product = await db.scalar(select(Product).where(Product.title == "Order Test"))
        product.escrow_hours = 6
        product_id, category_id = product.id, product.category_id
        await db.commit()

    async def order_hours() -> float:
        order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
        assert order.status_code == 201, order.text
        async with SessionLocal() as db:
            expires = (await db.get(Order, order.json()["id"])).escrow_expires_at
        return (expires - datetime.now(timezone.utc)).total_seconds() / 3600

    from src.fees.service import buyer_escrow_hours

    async def promised_hours() -> int:
        # The rule create_order applies (escrow_hours_for), as the storefront shows it.
        async with SessionLocal() as db:
            product = await db.get(Product, product_id)
            return (await buyer_escrow_hours([product], db))[product_id]

    cfg = (await client.get("/admin/fee-config", headers=_auth(admin_token))).json()
    assert cfg["escrow_floor_hours"] == 24 and (await client.get("/public/fee-config")).json()["escrow_floor_hours"] == 24
    # Default floor: a 6 h product hold and a 12 h category minimum both become 24 h.
    assert 23.9 < await order_hours() <= 24
    assert (await client.patch("/admin/fee-config", json={"category_escrow_min_hours": {str(category_id): 12}}, headers=_auth(admin_token))).status_code == 200
    assert await promised_hours() == 24
    # A higher category minimum still wins over the floor; a higher floor over everything.
    assert (await client.patch("/admin/fee-config", json={"category_escrow_min_hours": {str(category_id): 30}}, headers=_auth(admin_token))).status_code == 200
    assert await promised_hours() == 30
    assert (await client.patch("/admin/fee-config", json={"escrow_floor_hours": 48}, headers=_auth(admin_token))).status_code == 200
    assert await promised_hours() == 48
    assert 47.9 < await order_hours() <= 48

    # Sellers cannot pick a hold under the floor; a value left as it was is accepted.
    low = await client.patch(f"/seller/products/{product_id}", json={"escrow_hours": 24}, headers=_auth(seller_token))
    assert low.status_code == 422 and low.json()["error_code"] == "ESCROW_BELOW_FLOOR" and low.json()["params"] == {"floor": 48}
    same = await client.patch(f"/seller/products/{product_id}", json={"escrow_hours": 6, "title": "Order Test"}, headers=_auth(seller_token))
    assert same.status_code == 200, same.text
    assert (await client.patch(f"/seller/products/{product_id}", json={"escrow_hours": 72}, headers=_auth(seller_token))).json()["escrow_hours"] == 72
    created = await client.post("/seller/products", json={"category_id": category_id, "title": "Short hold", "status": "draft", "escrow_hours": 12}, headers=_auth(seller_token))
    assert created.status_code == 422 and created.json()["error_code"] == "ESCROW_BELOW_FLOOR"
    # A new product without a hold takes the admin default, lifted to the floor.
    assert (await client.patch("/admin/fee-config", json={"escrow_default_hours": 24}, headers=_auth(admin_token))).status_code == 200
    created = await client.post("/seller/products", json={"category_id": category_id, "title": "Default hold", "status": "draft"}, headers=_auth(seller_token))
    assert created.status_code == 201 and created.json()["escrow_hours"] == 48

    # Bounds, audit, and only admins.
    for bad in (0, 721, None):
        body = {"escrow_floor_hours": bad}
        resp = await client.patch("/admin/fee-config", json=body, headers=_auth(admin_token))
        assert resp.status_code == (200 if bad is None else 422), (bad, resp.text)
    assert (await client.patch("/admin/fee-config", json={"escrow_floor_hours": 12}, headers=_auth(seller_token))).status_code == 403
    async with SessionLocal() as db:
        entries = (await db.execute(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "fee_runtime_config_changed").order_by(LogEntry.id)
        )).scalars().all()
    assert any(e.metadata_["changed"].get("escrow_floor_hours") == [24, 48] for e in entries)
