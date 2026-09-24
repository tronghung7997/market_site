"""Migration gb1a2b3c4d5e6: legacy rows that made the nightly ledger check
report mismatches although no money was missing."""
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from src.database import SessionLocal
from src.ledger.service import reconcile_ledger
from src.models.order import Order
from src.models.wallet import Transaction, Wallet
from tests.test_orders import setup_buyable_product

_spec = importlib.util.spec_from_file_location(
    "gb_backfill", Path(__file__).resolve().parents[1] / "alembic/versions/gb1a2b3c4d5e6_ledger_legacy_backfill.py")
migration = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migration)


def _h(token):
    return {"Authorization": f"Bearer {token}"}


async def _findings(db):
    return {(f.kind, f.target_type, f.target_id): f for f in (await reconcile_ledger(db)).findings}


@pytest.mark.asyncio
async def test_legacy_refund_rows_backfill_and_read_ledger_first(client):
    buyer_token, _, admin_token, instant_vid, _ = await setup_buyable_product(client)
    order = (await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_h(buyer_token))).json()
    refund = await client.post(f"/admin/orders/{order['id']}/refund", json={"note": "hàng lỗi"}, headers=_h(admin_token))
    assert refund.status_code == 204, refund.text
    async with SessionLocal() as db:
        # Orders refunded before 2026-08-28 kept the column default.
        await db.execute(text("UPDATE orders SET refunded_amount = 0 WHERE id = :o"), {"o": order["id"]})
        await db.commit()
        found = await _findings(db)
    refund_findings = [f for k, f in found.items() if k[1] == "order" and k[2] == order["id"]]
    assert len(refund_findings) == 1, "one cause, one finding — no second 'not in full' row"
    f = refund_findings[0]
    assert (f.kind, f.expected, f.actual) == ("order_refund", order["total_amount"], 0)   # theo sổ vs đang lưu
    assert f.delta == -order["total_amount"]

    async with SessionLocal() as db:
        await db.execute(text(migration.BACKFILL_REFUNDS_SQL))
        await db.commit()
        assert (await db.get(Order, order["id"])).refunded_amount == order["total_amount"]
        report = await reconcile_ledger(db)
    assert report.ok, report.findings


@pytest.mark.asyncio
async def test_pre_lock_withdrawal_patched_by_hand_is_made_whole(client):
    _, seller_token, _, _, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_h(seller_token))).json()["id"]
    async with SessionLocal() as db:
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == seller_id))
        wallet.available_balance += 1_000
        db.add(Transaction(wallet_id=wallet.id, type="adjustment_credit", amount=1_000, description="seed"))
        await db.commit()
        # Old flow (before q1a2b3c4d5e6): approve debited the balance and booked
        # only `withdraw`; later someone patched the log by hand.
        wallet = await db.get(Wallet, wallet.id)
        wallet.available_balance -= 300
        db.add(Transaction(wallet_id=wallet.id, type="withdraw", amount=300, description="Withdrawal approved"))
        db.add(Transaction(wallet_id=wallet.id, type="adjustment_debit", amount=300,
                           description="Đối soát số dư — chênh lệch do migration q1a2b3c4d5e6 đổi lớp số dư mà không ghi sổ"))
        await db.commit()
        found = await _findings(db)
    assert set(found) == {("wallet_locked", "wallet", wallet.id), ("platform", "platform", 0)}
    assert found[("platform", "platform", 0)].delta == 300

    for _ in range(2):  # idempotent
        async with SessionLocal() as db:
            await db.execute(text(migration.LEGACY_WITHDRAW_SQL))
            await db.commit()
    async with SessionLocal() as db:
        added = (await db.execute(select(Transaction.type, Transaction.amount)
                                  .where(Transaction.reference_id == f"{migration.FIX_REF}{wallet.id}"))).all()
        assert sorted((t.value, a) for t, a in added) == [("adjustment_credit", 300), ("withdraw_lock", 300)]
        assert (await db.get(Wallet, wallet.id)).available_balance == 700
        report = await reconcile_ledger(db)
    assert report.ok, report.findings


@pytest.mark.asyncio
async def test_unexplained_negative_lock_is_left_for_a_human(client):
    _, seller_token, _, _, _ = await setup_buyable_product(client)
    seller_id = (await client.get("/me", headers=_h(seller_token))).json()["id"]
    async with SessionLocal() as db:
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == seller_id))
        db.add(Transaction(wallet_id=wallet.id, type="withdraw", amount=300, description="?"))
        await db.commit()
        before = await db.scalar(select(func.count()).select_from(Transaction))
        await db.execute(text(migration.LEGACY_WITHDRAW_SQL))
        await db.commit()
        assert await db.scalar(select(func.count()).select_from(Transaction)) == before
        assert ("wallet_locked", "wallet", wallet.id) in await _findings(db)
