"""A5.1 — Settings › Fees & holds: platform fee (default + per category),
escrow floor, withdrawal minimum and fee, all admin-tunable and audited."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.ledger.service import reconcile_ledger
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
    assert cfg.json()["platform_fee_percent"] == 0 and cfg.json()["escrow_default_days"] == 2
    public = await client.get("/public/fee-config")
    assert public.status_code == 200 and "updated_by_id" not in public.json()

    upd = await client.patch("/admin/fee-config", json={
        "platform_fee_percent": 12.5, "category_fee_percent": {"7": 20}, "escrow_min_days": 3,
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
    assert (await client.patch("/admin/fee-config", json={"category_escrow_min_days": {str(category_id): 7}, "escrow_default_days": 5}, headers=_auth(admin_token))).status_code == 200
    order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert order.status_code == 201, order.text
    async with SessionLocal() as db:
        expires = (await db.get(Order, order.json()["id"])).escrow_expires_at
    assert timedelta(days=6, hours=23) < expires - datetime.now(timezone.utc) <= timedelta(days=7)

    # A product created without an explicit hold takes the admin default.
    created = await client.post("/seller/products", json={"category_id": category_id, "title": "Default hold", "status": "draft"}, headers=_auth(seller_token))
    assert created.status_code == 201, created.text
    assert created.json()["escrow_days"] == 5


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
