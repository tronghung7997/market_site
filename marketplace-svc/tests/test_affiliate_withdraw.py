"""Commission withdrawals for accounts that are not sellers (KOLs / referrers).

`POST /wallet/withdraw` lets a non-seller take out only the affiliate
commission it earned (net of clawbacks), less what it already asked for —
never deposited money or cashback. Sellers keep their own rules.
"""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.ledger.service import reconcile_ledger
from src.affiliate.service import clawback_commission_for_order
from src.models.affiliate import AffiliateCommission, AffiliateFund, AffiliateFundEntry
from src.models.order import Order
from src.models.log_entry import LogEntry
from src.models.ops_telegram import OpsTelegramConfig, OpsTelegramOutbox
from src.models.wallet import WithdrawRequest
from tests.conftest import make_seller, referral, register_and_login
from tests.test_affiliate_kol import _auth, _buy, _buyer, _code, _confirm, _market

BANK = {"bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "KOL"}


async def _kol_with_commission(client, monkeypatch, orders: int = 3) -> dict:
    """A KOL (not a seller) on a 100 % deal: 10 000 ₫ × 10 % fee = 1 000 ₫ per settled order."""
    m = await _market(client, monkeypatch)
    terms = await client.put(f"/admin/affiliates/{m['kol_id']}/terms", json={"commission_percent_of_fee": 100},
                             headers=_auth(m["admin"]))
    assert terms.status_code == 200, terms.text
    _, buyer = await _buyer(client, m["admin"], "wd_fan@example.com", **referral(await _code(m["kol_id"])))
    m["orders"] = []
    for _ in range(orders):
        order = await _buy(client, buyer, m["variant_id"])
        await _confirm(client, buyer, order["id"])
        m["orders"].append(order["id"])
    return m


async def _withdrawable(client, token: str) -> int:
    wallet = (await client.get("/wallet", headers=_auth(token))).json()
    me = (await client.get("/affiliate/me", headers=_auth(token))).json()
    assert wallet["withdrawable_commission"] == me["totals"]["withdrawable_commission"]
    return wallet["withdrawable_commission"]


@pytest.mark.asyncio
async def test_kol_withdraws_only_earned_commission(client, monkeypatch):
    m = await _kol_with_commission(client, monkeypatch)
    kol, admin = m["kol"], m["admin"]
    # Money that is not commission sits in the same wallet but is not withdrawable.
    await client.post("/wallet/topup", json={"reason": "test", "account_id": m["kol_id"], "amount": 50_000},
                      headers=_auth(admin))
    me = (await client.get("/affiliate/me", headers=_auth(kol))).json()
    assert me["can_withdraw"] is True and me["withdraw_source"] == "affiliate_commission"
    assert me["totals"]["available_commission"] == 3_000 and me["totals"]["wallet_available"] == 53_000
    wallet = (await client.get("/wallet", headers=_auth(kol))).json()
    assert wallet["withdraw_policy"] is None
    assert await _withdrawable(client, kol) == 3_000

    over = await client.post("/wallet/withdraw", json={"amount": 3_001, **BANK}, headers=_auth(kol))
    assert over.status_code == 422 and over.json()["error_code"] == "WITHDRAW_COMMISSION_EXCEEDED"
    assert over.json()["params"] == {"limit": 3_000}

    first = await client.post("/wallet/withdraw", json={"amount": 2_000, **BANK}, headers=_auth(kol))
    assert first.status_code == 200, first.text
    assert first.json()["source"] == "affiliate_commission" and first.json()["status"] == "pending"
    # A pending request already counts against the cap.
    assert await _withdrawable(client, kol) == 1_000
    again = await client.post("/wallet/withdraw", json={"amount": 1_500, **BANK}, headers=_auth(kol))
    assert again.status_code == 422 and again.json()["params"] == {"limit": 1_000}

    # The admin queue labels it; approving and paying use the usual flow and books.
    queue = (await client.get("/admin/withdrawals", headers=_auth(admin))).json()
    assert [(r["id"], r["source"]) for r in queue] == [(first.json()["id"], "affiliate_commission")]
    assert (await client.post(f"/admin/withdrawals/{first.json()['id']}/approve", headers=_auth(admin))).status_code == 200
    paid = await client.post(f"/admin/withdrawals/{first.json()['id']}/paid", json={"payout_reference": "FT-KOL"},
                             headers=_auth(admin))
    assert paid.status_code == 200, paid.text
    assert await _withdrawable(client, kol) == 1_000
    mine = (await client.get("/wallet/withdrawals", headers=_auth(kol))).json()
    assert [(r["status"], r["source"]) for r in mine] == [("paid", "affiliate_commission")]
    wallet = (await client.get("/wallet", headers=_auth(kol))).json()
    assert wallet["available_balance"] == 51_000 and wallet["locked_balance"] == 0
    async with SessionLocal() as db:
        assert (await reconcile_ledger(db)).ok
        logged = await db.scalar(select(LogEntry).where(LogEntry.metadata_["event"].astext == "withdraw_requested"))
    assert logged.metadata_["source"] == "affiliate_commission"

    # A rejected request gives its share back.
    second = await client.post("/wallet/withdraw", json={"amount": 1_000, **BANK}, headers=_auth(kol))
    assert second.status_code == 200, second.text
    assert await _withdrawable(client, kol) == 0
    assert (await client.post(f"/admin/withdrawals/{second.json()['id']}/reject", json={"reason": "sai STK"},
                              headers=_auth(admin))).status_code == 200
    assert await _withdrawable(client, kol) == 1_000


@pytest.mark.asyncio
async def test_clawback_and_spending_lower_the_cap(client, monkeypatch):
    m = await _kol_with_commission(client, monkeypatch)
    kol = m["kol"]
    assert await _withdrawable(client, kol) == 3_000
    # A clawed-back commission no longer counts, even when the wallet kept the money.
    async with SessionLocal() as db:
        await db.execute(update(AffiliateCommission).where(AffiliateCommission.order_id == m["orders"][0])
                         .values(clawed_back_at=datetime.now(timezone.utc)))
        await db.commit()
    assert await _withdrawable(client, kol) == 2_000
    resp = await client.post("/wallet/withdraw", json={"amount": 2_500, **BANK}, headers=_auth(kol))
    assert resp.status_code == 422 and resp.json()["params"] == {"limit": 2_000}
    # Commission spent on the marketplace is gone: the cap never exceeds the balance.
    order = await client.post("/orders", json={"variant_id": m["variant_id"], "quantity": 1}, headers=_auth(kol))
    assert order.status_code == 402  # 3 000 in the wallet, the package costs 10 000
    await client.post("/wallet/topup", json={"reason": "test", "account_id": m["kol_id"], "amount": 7_500},
                      headers=_auth(m["admin"]))
    assert (await client.post("/orders", json={"variant_id": m["variant_id"], "quantity": 1},
                              headers=_auth(kol))).status_code == 201
    assert (await client.get("/wallet", headers=_auth(kol))).json()["available_balance"] == 500
    assert await _withdrawable(client, kol) == 500


@pytest.mark.asyncio
async def test_deposit_money_and_cashback_are_not_withdrawable(client, monkeypatch):
    m = await _market(client, monkeypatch)
    buyer_id, buyer = await _buyer(client, m["admin"], "wd_depositor@example.com")
    wallet = (await client.get("/wallet", headers=_auth(buyer))).json()
    assert wallet["available_balance"] == 100_000 and wallet["withdrawable_commission"] == 0
    resp = await client.post("/wallet/withdraw", json={"amount": 10_000, **BANK}, headers=_auth(buyer))
    assert resp.status_code == 422 and resp.json()["error_code"] == "WITHDRAW_COMMISSION_EXCEEDED"
    assert resp.json()["params"] == {"limit": 0}
    async with SessionLocal() as db:
        assert await db.scalar(select(WithdrawRequest.id).where(WithdrawRequest.account_id == buyer_id)) is None
    # Nothing locked.
    wallet = (await client.get("/wallet", headers=_auth(buyer))).json()
    assert wallet["available_balance"] == 100_000 and wallet["locked_balance"] == 0
    # Above the balance it is still the balance check.
    assert (await client.post("/wallet/withdraw", json={"amount": 200_000, **BANK},
                              headers=_auth(buyer))).status_code == 402


@pytest.mark.asyncio
async def test_unauthenticated_and_foreign_access(client, monkeypatch):
    m = await _kol_with_commission(client, monkeypatch, orders=1)
    assert (await client.post("/wallet/withdraw", json={"amount": 500, **BANK})).status_code == 401
    assert (await client.get("/wallet/withdrawals")).status_code == 401
    req = await client.post("/wallet/withdraw", json={"amount": 500, **BANK}, headers=_auth(m["kol"]))
    assert req.status_code == 200, req.text
    # The KOL cannot decide its own request; another account does not see it.
    assert (await client.post(f"/admin/withdrawals/{req.json()['id']}/approve",
                              headers=_auth(m["kol"]))).status_code == 403
    assert (await client.get("/admin/withdrawals", headers=_auth(m["kol"]))).status_code == 403
    other = await register_and_login(client, "wd_other@example.com")
    assert (await client.get("/wallet/withdrawals", headers=_auth(other))).json() == []


@pytest.mark.asyncio
async def test_seller_withdrawals_are_unchanged(client, monkeypatch):
    m = await _market(client, monkeypatch)
    seller = await register_and_login(client, "kol_seller@example.com")
    seller_id = (await client.get("/me", headers=_auth(seller))).json()["id"]
    await client.post("/wallet/topup", json={"reason": "test", "account_id": seller_id, "amount": 80_000},
                      headers=_auth(m["admin"]))
    wallet = (await client.get("/wallet", headers=_auth(seller))).json()
    assert wallet["withdraw_policy"] is not None and wallet["withdrawable_commission"] is None
    req = await client.post("/wallet/withdraw", json={"amount": 60_000, **BANK}, headers=_auth(seller))
    assert req.status_code == 200, req.text
    assert req.json()["source"] == "seller_balance"
    me = (await client.get("/affiliate/me", headers=_auth(seller))).json()
    assert me["can_withdraw"] is True and me["withdraw_source"] == "seller_balance"


@pytest.mark.asyncio
async def test_ops_bot_reports_a_commission_withdrawal(client, monkeypatch):
    from src.ops_telegram.collect import collect

    m = await _kol_with_commission(client, monkeypatch, orders=1)
    req = await client.post("/wallet/withdraw", json={"amount": 800, **BANK}, headers=_auth(m["kol"]))
    assert req.status_code == 200, req.text
    async with SessionLocal() as db:
        cfg = OpsTelegramConfig(id=1, enabled=True, ops_chat_id="-1001234567890")
        db.add(cfg)
        await db.flush()
        await collect(db, cfg, datetime.now(timezone.utc) + timedelta(hours=1))
        await db.commit()
        rows = list((await db.scalars(select(OpsTelegramOutbox).where(
            OpsTelegramOutbox.kind == "withdrawal_requested"))).all())
    assert len(rows) == 1
    assert "Hoa hồng affiliate" in rows[0].body and "800" in rows[0].title


@pytest.mark.asyncio
async def test_seller_role_switch_keeps_commission_cap_honest(client, monkeypatch):
    """Withdrawals made as a seller still count once the account withdraws as a non-seller."""
    m = await _kol_with_commission(client, monkeypatch, orders=2)
    await make_seller("kol_youtuber@example.com")
    kol = await register_and_login(client, "kol_youtuber@example.com")
    as_seller = await client.post("/wallet/withdraw", json={"amount": 1_500, **BANK}, headers=_auth(kol))
    assert as_seller.status_code == 200 and as_seller.json()["source"] == "seller_balance"
    async with SessionLocal() as db:
        from src.models.account import Account
        account = await db.get(Account, m["kol_id"])
        account.roles = [r for r in account.roles if r != "seller"]
        await db.commit()
    kol = await register_and_login(client, "kol_youtuber@example.com")
    assert await _withdrawable(client, kol) == 500


@pytest.mark.asyncio
async def test_clawback_returns_only_the_recovered_amount_to_the_fund(client, monkeypatch):
    """Commission locked in a withdrawal cannot be taken back: the budget must not regain it."""
    m = await _kol_with_commission(client, monkeypatch, orders=1)
    assert (await client.post("/wallet/withdraw", json={"amount": 1_000, **BANK}, headers=_auth(m["kol"]))).status_code == 200
    async with SessionLocal() as db:
        fund_before = (await db.get(AffiliateFund, 1)).balance
        order = await db.get(Order, m["orders"][0])
        await clawback_commission_for_order(order, db)
        await db.commit()
        assert (await db.get(AffiliateFund, 1)).balance == fund_before   # nothing came back
        entry = await db.scalar(select(AffiliateFundEntry).where(
            AffiliateFundEntry.kind == "clawback", AffiliateFundEntry.reference_id == str(order.id)))
        assert entry.amount == 0 and "wallet_recovered=0" in entry.note
        assert (await reconcile_ledger(db)).ok
