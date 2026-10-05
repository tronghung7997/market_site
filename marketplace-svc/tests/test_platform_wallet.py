"""Platform fees land on the wallet chosen in Settings › Fees & holds."""
import pytest
from sqlalchemy import select, text, update

from src.database import SessionLocal
from src.ledger.service import reconcile_ledger
from src.models.account import Account
from src.models.log_entry import LogEntry
from src.models.wallet import Transaction, TransactionType, Wallet
from tests.conftest import make_admin, register_and_login
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _account_id(email: str) -> int:
    async with SessionLocal() as db:
        return await db.scalar(text("SELECT id FROM accounts WHERE email = :e"), {"e": email})


async def _fee_wallets(reference_id: str) -> set[int]:
    async with SessionLocal() as db:
        return set((await db.execute(
            select(Wallet.account_id).join(Transaction, Transaction.wallet_id == Wallet.id).where(
                Transaction.type == TransactionType.platform_fee, Transaction.reference_id == reference_id,
            )
        )).scalars().all())


async def _new_admin(client, email: str) -> int:
    await register_and_login(client, email)
    await make_admin(email)
    return await _account_id(email)


@pytest.mark.asyncio
async def test_default_platform_account_is_one_and_candidates_are_admins(client):
    _, _, admin_token, _, _ = await setup_buyable_product(client)
    await register_and_login(client, "fee_not_admin@example.com")
    cfg = await client.get("/admin/fee-config", headers=_auth(admin_token))
    assert cfg.status_code == 200, cfg.text
    body = cfg.json()
    assert body["platform_account_id"] == 1
    emails = {c["email"] for c in body["platform_account_candidates"]}
    assert "fee_not_admin@example.com" not in emails and emails
    assert "platform_account_id" not in (await client.get("/public/fee-config")).json()


@pytest.mark.asyncio
async def test_order_and_withdrawal_fees_go_to_the_configured_account(client):
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    fee_admin = await _new_admin(client, "fee_wallet@example.com")
    assert fee_admin != 1

    upd = await client.patch("/admin/fee-config", json={
        "platform_account_id": fee_admin, "platform_fee_percent": 10,
        "withdraw_fee_fixed": 100, "withdraw_fee_percent": 0,
    }, headers=_auth(admin_token))
    assert upd.status_code == 200, upd.text
    assert upd.json()["platform_account_id"] == fee_admin
    assert any(c["id"] == fee_admin for c in upd.json()["platform_account_candidates"])
    async with SessionLocal() as db:
        entry = (await db.execute(
            select(LogEntry).where(LogEntry.metadata_["event"].astext == "fee_runtime_config_changed")
        )).scalar_one()
    assert entry.metadata_["changed"]["platform_account_id"] == [1, fee_admin]

    order = (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 2},
                               headers=_auth(buyer_token))).json()
    confirm = await client.post(f"/orders/{order['id']}/confirm", headers=_auth(buyer_token))
    assert confirm.status_code == 200, confirm.text
    assert await _fee_wallets(f"order-{order['id']}") == {fee_admin}

    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": seller_id, "amount": 50_000},
                      headers=_auth(admin_token))
    bank = {"bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "SELLER"}
    req = await client.post("/wallet/withdraw", json={"amount": 10_000, **bank}, headers=_auth(seller_token))
    assert req.status_code == 200, req.text
    rid = req.json()["id"]
    assert (await client.post(f"/admin/withdrawals/{rid}/approve", headers=_auth(admin_token))).status_code == 200
    paid = await client.post(f"/admin/withdrawals/{rid}/paid", json={"payout_reference": "FT-PW"},
                             headers=_auth(admin_token))
    assert paid.status_code == 200, paid.text
    assert await _fee_wallets(f"withdraw-{rid}") == {fee_admin}

    async with SessionLocal() as db:
        report = await reconcile_ledger(db)
    assert report.ok, report.findings


@pytest.mark.asyncio
async def test_platform_account_must_be_an_active_admin(client):
    _, _, admin_token, _, _ = await setup_buyable_product(client)
    await register_and_login(client, "fee_plain@example.com")
    plain = await _account_id("fee_plain@example.com")
    inactive = await _new_admin(client, "fee_inactive@example.com")
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.id == inactive).values(is_active=False))
        await db.commit()

    for bad in (plain, inactive, 999_999):
        resp = await client.patch("/admin/fee-config", json={"platform_account_id": bad}, headers=_auth(admin_token))
        assert resp.status_code == 422, (bad, resp.text)
    assert (await client.get("/admin/fee-config", headers=_auth(admin_token))).json()["platform_account_id"] == 1


@pytest.mark.asyncio
async def test_non_admin_cannot_change_platform_account(client):
    _, seller_token, _, _, _ = await setup_buyable_product(client)
    resp = await client.patch("/admin/fee-config", json={"platform_account_id": 1}, headers=_auth(seller_token))
    assert resp.status_code == 403
    assert (await client.get("/admin/fee-config", headers=_auth(seller_token))).status_code == 403
