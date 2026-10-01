"""Tài chính › Báo cáo: period P&L, balance of held money, close and export."""
import csv
import io
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.ledger.report import _cell, period_label
from src.models.finance_period_close import FinancePeriodClose
from src.models.wallet import Transaction, Wallet
from tests.test_ledger_reconcile import _auth, _flow


def _range(days_back: int = 2, until: datetime | None = None) -> dict:
    end = until or datetime.now(timezone.utc) + timedelta(minutes=1)
    return {"start": (end - timedelta(days=days_back)).isoformat(), "end": end.isoformat()}


@pytest.mark.asyncio
async def test_report_pl_and_balance_add_up(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    r = await client.get("/admin/finance/report", params=_range(), headers=_auth(admin_token))
    assert r.status_code == 200, r.text
    rep = r.json()
    cur = rep["current"]
    assert cur["orders"] == 2 and cur["gmv"] == 2_000
    assert cur["revenue"] == cur["order_fee"] + cur["withdraw_fee"]
    assert cur["net"] == cur["revenue"] - cur["costs"]
    assert cur["withdrawn"] == 500 and cur["withdraw_count"] == 1
    # The comparison period is the same length right before, empty here.
    assert rep["previous"]["gmv"] == 0
    assert datetime.fromisoformat(rep["compare_end"]) == datetime.fromisoformat(rep["start"])

    bal = rep["balance"]
    assert bal["opening"] == 0
    assert bal["closing"] == bal["opening"] + bal["deposits"] + bal["injected"] - bal["withdrawn"] - bal["removed"]
    assert bal["matches"] is True and bal["delta"] == 0
    assert bal["escrow"] == 1_000                 # the unconfirmed order
    assert bal["withdrawn"] == 500
    assert [s["email"] for s in rep["top_sellers"]][:1] == [(await client.get("/me", headers=_auth(seller_token))).json()["email"]]
    assert rep["closed"] is None


@pytest.mark.asyncio
async def test_balance_flags_wallet_tampering(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    buyer_id = (await client.get("/me", headers=_auth(buyer_token))).json()["id"]
    async with SessionLocal() as db:
        # Money that appears in a wallet without a ledger row.
        await db.execute(update(Wallet).where(Wallet.account_id == buyer_id).values(available_balance=Wallet.available_balance + 123))
        await db.commit()
    bal = (await client.get("/admin/finance/report", params=_range(), headers=_auth(admin_token))).json()["balance"]
    assert bal["matches"] is False and bal["delta"] == 123
    assert bal["stored_total"] == bal["closing"] + 123
    # A period that ended in the past is checked by replay only.
    past = _range(until=datetime.now(timezone.utc) - timedelta(seconds=1))
    old = (await client.get("/admin/finance/report", params=past, headers=_auth(admin_token))).json()["balance"]
    assert old["stored_total"] is None and old["matches"] is True


@pytest.mark.asyncio
async def test_close_period_snapshot_overlap_and_drift(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    now = datetime.now(timezone.utc)

    # A period that has not ended cannot be closed.
    future = _range(until=now + timedelta(hours=1))
    check = (await client.get("/admin/finance/close-checklist", params=future, headers=_auth(admin_token))).json()
    assert check["period_ended"] is False and check["can_close"] is False
    assert (await client.post("/admin/finance/closes", json=future, headers=_auth(admin_token))).status_code == 409

    period = _range(until=now)
    check = (await client.get("/admin/finance/close-checklist", params=period, headers=_auth(admin_token)))
    assert check.status_code == 200, check.text
    assert check.json()["can_close"] is True
    # setup_buyable_product funds the buyer with an admin credit that has no proof image
    assert check.json()["manual_adjustments"] == {"count": 1, "without_proof": 1}

    closed = await client.post("/admin/finance/closes", json={**period, "note": "chốt thử"}, headers=_auth(admin_token))
    assert closed.status_code == 201, closed.text
    assert closed.json()["note"] == "chốt thử" and closed.json()["closed_by"]
    again = await client.post("/admin/finance/closes", json=period, headers=_auth(admin_token))
    assert again.status_code == 409
    overlapping = {"start": (now - timedelta(hours=1)).isoformat(), "end": (now - timedelta(minutes=1)).isoformat()}
    assert (await client.post("/admin/finance/closes", json=overlapping, headers=_auth(admin_token))).status_code == 409

    rows = (await client.get("/admin/finance/closes", headers=_auth(admin_token))).json()
    assert len(rows) == 1 and rows[0]["drift"] == {"net_delta": 0, "late_rows": 0, "late_amount": 0}
    report = (await client.get("/admin/finance/report", params=period, headers=_auth(admin_token))).json()
    assert report["closed"]["id"] == rows[0]["id"]

    # A fee booked into the closed period afterwards shows up as drift.
    async with SessionLocal() as db:
        platform_wallet = await db.scalar(select(Wallet).where(Wallet.account_id == 1))
        db.add(Transaction(wallet_id=platform_wallet.id, type="platform_fee", amount=77, description="late",
                           reference_id="order-999999", created_at=now - timedelta(minutes=5)))
        await db.commit()
        snap = (await db.scalar(select(FinancePeriodClose))).snapshot
    assert snap["current"]["gmv"] == 2_000
    drift = (await client.get("/admin/finance/closes", headers=_auth(admin_token))).json()[0]["drift"]
    assert drift == {"net_delta": 77, "late_rows": 1, "late_amount": 77}


@pytest.mark.asyncio
async def test_export_package_is_a_zip_of_csvs(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    r = await client.get("/admin/finance/export.zip", params=_range(), headers=_auth(admin_token))
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    assert "attachment;" in r.headers["content-disposition"]
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert set(z.namelist()) == {"bao-cao.csv", "so-chi-tiet.csv", "nap-tien.csv", "rut-tien.csv", "dieu-chinh-tay.csv", "so-du-cuoi-ky.csv"}
    ledger = list(csv.reader(io.StringIO(z.read("so-chi-tiet.csv").decode("utf-8-sig"))))
    async with SessionLocal() as db:
        total = len((await db.execute(select(Transaction.id))).all())
    assert len(ledger) == total + 1 and ledger[0][0] == "Mã GD"
    withdrawals = list(csv.reader(io.StringIO(z.read("rut-tien.csv").decode("utf-8-sig"))))
    assert len(withdrawals) == 2 and withdrawals[1][3] == "500"


def test_csv_cells_never_become_formulas_and_labels():
    assert _cell("=HYPERLINK(\"x\")") == "'=HYPERLINK(\"x\")"
    assert _cell("@SUM(A1)") == "'@SUM(A1)"
    assert _cell("-500") == "-500" and _cell(-500) == "-500"
    assert _cell(None) == ""
    vn = timezone(timedelta(hours=7))
    assert period_label(datetime(2026, 9, 1, tzinfo=vn), datetime(2026, 10, 1, tzinfo=vn)) == "Tháng 09/2026"
    assert period_label(datetime(2026, 7, 1, tzinfo=vn), datetime(2026, 10, 1, tzinfo=vn)) == "Quý 3/2026"
    assert period_label(datetime(2026, 9, 7, tzinfo=vn), datetime(2026, 9, 14, tzinfo=vn)) == "07/09/2026 – 13/09/2026"


@pytest.mark.asyncio
async def test_finance_is_admin_only_and_validates(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    q = _range()
    for method, path, kw in (
        ("get", "/admin/finance/report", {"params": q}),
        ("get", "/admin/finance/close-checklist", {"params": q}),
        ("get", "/admin/finance/closes", {}),
        ("get", "/admin/finance/export.zip", {"params": q}),
        ("post", "/admin/finance/closes", {"json": q}),
    ):
        assert (await getattr(client, method)(path, **kw)).status_code == 401, path
        for token in (buyer_token, seller_token):
            assert (await getattr(client, method)(path, headers=_auth(token), **kw)).status_code == 403, path

    bad = [
        {"start": "2026-09-01T00:00:00", "end": "2026-10-01T00:00:00"},
        {"start": "2026-10-01T00:00:00+07:00", "end": "2026-09-01T00:00:00+07:00"},
        {"start": "2024-01-01T00:00:00+07:00", "end": "2026-01-01T00:00:00+07:00"},
        {**q, "compare_start": q["start"]},
    ]
    for params in bad:
        r = await client.get("/admin/finance/report", params=params, headers=_auth(admin_token))
        assert r.status_code == 422, (params, r.text)
    naive = await client.post("/admin/finance/closes", json={"start": "2026-09-01T00:00:00", "end": "2026-09-02T00:00:00"},
                              headers=_auth(admin_token))
    assert naive.status_code == 422
