"""A3.4 — nightly books check: balances must equal what the transaction log says."""
import pytest
from sqlalchemy import select, text

from src.database import SessionLocal
from src.ledger.service import reconcile_ledger, run_and_record
from src.models.alert import Alert
from src.models.log_entry import LogEntry
from src.models.wallet import Wallet
from tests.test_orders import setup_buyable_product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _flow(client):
    """Topup → buy (escrow open) → second order confirmed (released + fee) → withdraw lock → approve."""
    buyer_token, seller_token, admin_token, instant_vid, _ = await setup_buyable_product(client)
    open_order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    done_order = await client.post("/orders", json={"variant_id": instant_vid, "quantity": 1}, headers=_auth(buyer_token))
    assert open_order.status_code == 201 and done_order.status_code == 201
    assert (await client.post(f"/orders/{done_order.json()['id']}/confirm", headers=_auth(buyer_token))).status_code == 200
    withdraw = await client.post("/wallet/withdraw", json={"amount": 500, "bank_name": "MB", "bank_account_number": "0123456789", "bank_account_holder": "SELLER"}, headers=_auth(seller_token))
    assert withdraw.status_code == 200, withdraw.text
    approve = await client.post(f"/admin/withdrawals/{withdraw.json()['id']}/approve", headers=_auth(admin_token))
    assert approve.status_code == 200, approve.text
    return buyer_token, seller_token, admin_token, open_order.json()["id"], done_order.json()["id"]


@pytest.mark.asyncio
async def test_clean_books_reconcile_and_totals_add_up(client):
    _, _, admin_token, open_id, done_id = await _flow(client)
    async with SessionLocal() as db:
        report = await reconcile_ledger(db)
    assert report.ok, report.findings
    assert report.orders_checked == 2 and report.wallets_checked >= 3
    t = report.totals
    assert t["escrow_open"] == 1_000                       # the unconfirmed order
    assert t["money_out"] == 500                           # approved withdrawal left the platform
    assert t["held_total"] == t["net_in"]
    # Endpoint stores the run and reports it.
    run = await client.post("/admin/ledger/reconcile-runs", headers=_auth(admin_token))
    assert run.status_code == 201, run.text
    assert run.json()["ok"] is True and run.json()["trigger"] == "manual" and run.json()["findings"] == []
    runs = (await client.get("/admin/ledger/reconcile-runs", headers=_auth(admin_token))).json()
    assert len(runs) == 1 and runs[0]["id"] == run.json()["id"]


@pytest.mark.asyncio
async def test_tampered_balance_and_order_raise_incidents_then_self_resolve(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    buyer_id = (await client.get("/me", headers=_auth(buyer_token))).json()["id"]
    async with SessionLocal() as db:
        wallet_id = await db.scalar(select(Wallet.id).where(Wallet.account_id == buyer_id))
        # Money appears out of nowhere on the buyer wallet, and one order claims a refund nobody booked.
        await db.execute(text("UPDATE wallets SET available_balance = available_balance + 777 WHERE id = :w"), {"w": wallet_id})
        await db.execute(text("UPDATE orders SET refunded_amount = 100 WHERE id = :o"), {"o": open_id})
        await db.commit()

    async with SessionLocal() as db:
        run = await run_and_record(db, trigger="manual")
    kinds = {(f["kind"], f["target_type"], f["target_id"]) for f in run.findings}
    assert ("wallet_available", "wallet", wallet_id) in kinds
    assert ("order_refund", "order", open_id) in kinds
    assert ("platform", "platform", 0) in kinds
    assert run.ok is False and run.mismatch_count == 3
    wallet_finding = next(f for f in run.findings if f["kind"] == "wallet_available")
    assert wallet_finding["delta"] == 777

    alerts = (await client.get("/admin/alerts", headers=_auth(admin_token))).json()
    ledger_alerts = [a for a in alerts if a["type"] == "ledger_mismatch"]
    assert {a["fingerprint"] for a in ledger_alerts} == {f"ledger:wallet:{wallet_id}", f"ledger:order:{open_id}", "ledger:platform:0"}
    assert all(a["severity"] == "critical" for a in ledger_alerts)
    assert any("+777" in a["message"] for a in ledger_alerts)

    # A second run with the same state updates the incidents instead of duplicating them.
    async with SessionLocal() as db:
        await run_and_record(db, trigger="schedule")
    async with SessionLocal() as db:
        rows = list((await db.execute(select(Alert).where(Alert.type == "ledger_mismatch"))).scalars())
    assert len(rows) == 3 and all(r.occurrence_count == 2 and r.is_active for r in rows)

    # Fix the books → the next run retires every ledger incident.
    async with SessionLocal() as db:
        await db.execute(text("UPDATE wallets SET available_balance = available_balance - 777 WHERE id = :w"), {"w": wallet_id})
        await db.execute(text("UPDATE orders SET refunded_amount = 0 WHERE id = :o"), {"o": open_id})
        await db.commit()
    async with SessionLocal() as db:
        clean = await run_and_record(db, trigger="schedule")
        assert clean.ok
        rows = list((await db.execute(select(Alert).where(Alert.type == "ledger_mismatch"))).scalars())
        assert rows and all(not r.is_active and r.resolved_at is not None for r in rows)
        logs = list((await db.execute(select(LogEntry).where(LogEntry.metadata_["event"].astext == "ledger_reconcile").order_by(LogEntry.id))).scalars())
    assert [entry.level for entry in logs] == ["warning", "warning", "info"]
    assert logs[-1].metadata_["alerts_resolved"] == 3


@pytest.mark.asyncio
async def test_non_admin_cannot_run_or_read(client):
    buyer_token, *_ = await _flow(client)
    assert (await client.post("/admin/ledger/reconcile-runs", headers=_auth(buyer_token))).status_code == 403
    assert (await client.get("/admin/ledger/reconcile-runs", headers=_auth(buyer_token))).status_code == 403
