"""Retiring test/seed accounts: balances written off, books still reconcile,
the period P&L ignores the write-off, seeded products and reviews disappear."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.ledger.service import reconcile_ledger
from src.models.account import Account
from src.models.order import Order
from src.models.product import Product, ProductStatus
from src.models.review import Review
from src.models.wallet import Wallet
from src.ops.retire_seed import retire_seed_accounts
from tests.test_ledger_reconcile import _auth, _flow


def _range() -> dict:
    end = datetime.now(timezone.utc) + timedelta(minutes=1)
    return {"start": (end - timedelta(days=2)).isoformat(), "end": end.isoformat()}


@pytest.mark.asyncio
async def test_write_off_keeps_books_clean_and_out_of_the_pnl(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    buyer_id = (await client.get("/me", headers=_auth(buyer_token))).json()["id"]
    seller_id = (await client.get("/me", headers=_auth(seller_token))).json()["id"]
    admin_id = (await client.get("/me", headers=_auth(admin_token))).json()["id"]
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == done_id).values(is_seeded=True))
        done = await db.get(Order, done_id)
        db.add(Review(order_id=done_id, buyer_id=buyer_id, product_id=done.product_id, rating=5))
        await db.commit()
    before = (await client.get("/admin/finance/report", params=_range(), headers=_auth(admin_token))).json()["current"]

    async with SessionLocal() as db:
        balance = await db.scalar(select(Wallet.available_balance).where(Wallet.account_id == buyer_id))
        result = await retire_seed_accounts(db, zero=[buyer_id], seed=[seller_id], actor_id=admin_id)
        await db.commit()
    assert balance > 0 and result["debits"] == {buyer_id: balance}
    assert result["reviews_hidden"] == 1

    async with SessionLocal() as db:
        report = await reconcile_ledger(db)
        assert await db.scalar(select(Wallet.available_balance).where(Wallet.account_id == buyer_id)) == 0
        assert (await db.get(Account, seller_id)).is_seeded is True
        statuses = set((await db.execute(select(Product.status).where(Product.seller_id == seller_id))).scalars())
        review = (await db.execute(select(Review).where(Review.order_id == done_id))).scalar_one()
        product = await db.get(Product, done.product_id)
    assert report.ok, report.findings
    assert statuses == {ProductStatus.suspended}
    assert review.is_hidden and review.hidden_by_id == admin_id
    assert product.rating_count == 0 and product.sold_count == 0  # the only completed sale was seeded

    rep = (await client.get("/admin/finance/report", params=_range(), headers=_auth(admin_token))).json()
    cur = rep["current"]
    # Not a cost, not income: P&L unchanged, the write-off reported on its own.
    assert cur["manual_net"] == before["manual_net"] and cur["net"] == before["net"]
    assert cur["seed_writeoffs"] == balance
    # Still money out in the cash balance, which keeps matching.
    assert rep["balance"]["matches"] is True and rep["balance"]["removed"] >= balance

    # Running again changes nothing.
    async with SessionLocal() as db:
        again = await retire_seed_accounts(db, zero=[buyer_id], seed=[seller_id], actor_id=admin_id)
        await db.commit()
    assert again["debits"] == {buyer_id: 0} and again["suspended"] == [] and again["reviews_hidden"] == 0


@pytest.mark.asyncio
async def test_money_journal_hides_seed_money_unless_asked(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    buyer_id = (await client.get("/me", headers=_auth(buyer_token))).json()["id"]
    admin_id = (await client.get("/me", headers=_auth(admin_token))).json()["id"]
    async with SessionLocal() as db:
        await db.execute(update(Order).where(Order.id == done_id).values(is_seeded=True))
        await db.commit()
    async with SessionLocal() as db:
        result = await retire_seed_accounts(db, zero=[buyer_id], seed=[], actor_id=admin_id)
        await db.commit()
    written_off = result["debits"][buyer_id]
    assert written_off > 0

    def writeoffs(page: dict) -> list[dict]:
        return [e for e in page["items"] if "test/seed" in (e.get("description") or "")]

    def seeded_order_rows(page: dict) -> list[dict]:
        return [e for e in page["items"] if e.get("group") == f"order:{done_id}"]

    hidden = (await client.get("/admin/ledger/entries", headers=_auth(admin_token))).json()
    shown = (await client.get("/admin/ledger/entries", params={"include_seed": "true"}, headers=_auth(admin_token))).json()
    assert writeoffs(hidden) == [] and seeded_order_rows(hidden) == []
    assert len(writeoffs(shown)) == 1 and seeded_order_rows(shown)

    s_hidden = (await client.get("/admin/ledger/summary", headers=_auth(admin_token))).json()
    s_shown = (await client.get("/admin/ledger/summary", params={"include_seed": "true"}, headers=_auth(admin_token))).json()
    assert s_shown["money_out"] - s_hidden["money_out"] == written_off
    # The badge comes from the full books, not from the filtered view.
    async with SessionLocal() as db:
        assert (await reconcile_ledger(db)).ok
