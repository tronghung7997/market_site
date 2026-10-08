"""Admin money journal (Tài chính › Dòng tiền): read-only views over the ledger."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.order import Order
from src.models.wallet import Transaction, Wallet
from tests.conftest import register_and_login
from tests.test_ledger_reconcile import _auth, _flow
from tests.test_wallet import _seller_with_balance


async def _me(client, token) -> dict:
    return (await client.get("/me", headers=_auth(token))).json()


async def _all_entries(client, token, **params) -> list[dict]:
    """Walk every page with the keyset cursor."""
    items, cursor = [], None
    while True:
        q = {**params, "limit": 2}
        if cursor:
            q["cursor"] = cursor
        page = await client.get("/admin/ledger/entries", params=q, headers=_auth(token))
        assert page.status_code == 200, page.text
        body = page.json()
        items += body["items"]
        cursor = body["next_cursor"]
        if not cursor:
            return items


@pytest.mark.asyncio
async def test_entries_page_with_cursor_newest_first_and_running_balance(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    entries = await _all_entries(client, admin_token)
    async with SessionLocal() as db:
        total = len((await db.execute(select(Transaction.id))).all())
    assert len(entries) == total and len({e["id"] for e in entries}) == total
    keys = [(e["created_at"], e["id"]) for e in entries]
    assert keys == sorted(keys, reverse=True)

    # The newest row of each wallet carries that wallet's current available balance.
    async with SessionLocal() as db:
        balances = {aid: bal for aid, bal in (await db.execute(select(Wallet.account_id, Wallet.available_balance))).all()}
    seen = set()
    for e in entries:
        if e["account_id"] in seen:
            continue
        seen.add(e["account_id"])
        assert e["balance_after"] == balances[e["account_id"]], e

    buyer = await _me(client, buyer_token)
    buyer_rows = [e for e in entries if e["account_id"] == buyer["id"]]
    assert {e["account_role"] for e in buyer_rows} == {"buyer"}
    hold = next(e for e in buyer_rows if e["type"] == "purchase_hold")
    assert hold["direction"] == "out" and hold["group_label"].startswith("ORD-")
    assert hold["group"] in {f"order:{open_id}", f"order:{done_id}"}


@pytest.mark.asyncio
async def test_entries_filters(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    seller = await _me(client, seller_token)

    outs = await _all_entries(client, admin_token, direction="out")
    assert outs and all(e["direction"] == "out" for e in outs)

    seller_rows = await _all_entries(client, admin_token, account_id=seller["id"])
    assert seller_rows and all(e["account_id"] == seller["id"] for e in seller_rows)
    assert {"purchase_release", "withdraw_lock", "withdraw"} <= {e["type"] for e in seller_rows}

    by_type = await _all_entries(client, admin_token, type=["withdraw_lock", "withdraw"])
    assert {e["type"] for e in by_type} == {"withdraw_lock", "withdraw"}

    group = await _all_entries(client, admin_token, group=f"order:{done_id}")
    assert {e["type"] for e in group} >= {"purchase_hold", "purchase_release"}
    assert all(e["group"] == f"order:{done_id}" for e in group)

    sellers = await _all_entries(client, admin_token, role="seller")
    assert sellers and all(e["account_role"] == "seller" for e in sellers)

    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    empty = await client.get("/admin/ledger/entries", params={"start": future}, headers=_auth(admin_token))
    assert empty.status_code == 200 and empty.json() == {"items": [], "next_cursor": None}

    nobody = await client.get("/admin/ledger/entries", params={"account_id": 99999}, headers=_auth(admin_token))
    assert nobody.status_code == 200 and nobody.json()["items"] == []

    one = seller_rows[0]
    by_amount = await _all_entries(client, admin_token, amount=one["amount"])
    assert one["id"] in {e["id"] for e in by_amount} and all(e["amount"] == one["amount"] for e in by_amount)


@pytest.mark.asyncio
async def test_group_includes_dispute_refund_suffixes_and_reports_escrow(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    async with SessionLocal() as db:
        order = await db.get(Order, open_id)
        buyer_wallet = await db.scalar(select(Wallet).where(Wallet.account_id == order.buyer_id))
        # A partial dispute refund the way disputes.service books it.
        db.add(Transaction(wallet_id=buyer_wallet.id, type="refund", amount=300,
                           description="Order refund", reference_id=f"order-{open_id}:dispute:1:admin-partial"))
        # Another order's id is a prefix of this one: it must not leak in.
        db.add(Transaction(wallet_id=buyer_wallet.id, type="refund", amount=1,
                           description="noise", reference_id=f"order-{open_id}0"))
        await db.commit()
        total = order.total_amount

    resp = await client.get(f"/admin/ledger/groups/order:{open_id}", headers=_auth(admin_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["header"]["label"].startswith("ORD-")
    assert [e["type"] for e in body["entries"]] == ["purchase_hold", "refund"]
    assert body["header"]["escrow_remaining"] == total - 300
    assert body["header"]["escrow_open"] is True


@pytest.mark.asyncio
async def test_summary_and_account_statement_add_up(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    summary = await client.get("/admin/ledger/summary", headers=_auth(admin_token))
    assert summary.status_code == 200, summary.text
    s = summary.json()
    assert s["money_out"] == 500                    # approved withdrawal
    assert s["escrow_open_orders"] == 1 and s["escrow_open_amount"] == 1_000
    assert s["by_type"]["purchase_hold"]["count"] == 2
    assert s["platform_revenue"] == s["by_type"].get("platform_fee", {}).get("amount", 0)
    entries = await _all_entries(client, admin_token)
    assert s["filtered_count"] == len(entries)
    assert s["filtered_in"] == sum(e["amount"] for e in entries if e["direction"] == "in")
    assert s["filtered_out"] == sum(e["amount"] for e in entries if e["direction"] == "out")

    seller = await _me(client, seller_token)
    stmt = await client.get(f"/admin/ledger/accounts/{seller['id']}/statement", headers=_auth(admin_token))
    assert stmt.status_code == 200, stmt.text
    st = stmt.json()
    assert st["opening"] == 0 and st["closing"] == st["money_in"] - st["money_out"]
    assert st["matches_wallet"] is True and st["closing"] == st["available_now"]

    # A period that starts now: everything so far is opening balance.
    now = datetime.now(timezone.utc).isoformat()
    later = await client.get(f"/admin/ledger/accounts/{seller['id']}/statement", params={"start": now},
                             headers=_auth(admin_token))
    assert later.json()["opening"] == st["closing"] and later.json()["count"] == 0


@pytest.mark.asyncio
async def test_smart_search_resolves_order_email_amount(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    async with SessionLocal() as db:
        code = (await db.get(Order, open_id)).order_code
    buyer = await _me(client, buyer_token)

    async def search(q):
        r = await client.get("/admin/ledger/search", params={"q": q}, headers=_auth(admin_token))
        assert r.status_code == 200, r.text
        return r.json()

    hits = await search(code.lower())
    assert hits[0]["kind"] == "order" and hits[0]["filter"]["group"] == f"order:{open_id}"

    hits = await search(buyer["email"][:6])
    assert any(h["kind"] == "account" and h["filter"]["account_id"] == buyer["id"] for h in hits)

    hits = await search("1.000")
    assert hits[0]["kind"] == "amount" and hits[0]["filter"]["amount"] == 1000

    # LIKE wildcards are matched literally, not as patterns.
    assert await search("%%") == []
    assert await search("x") == []


@pytest.mark.asyncio
async def test_journal_is_admin_only_and_validates_input(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    for path in ("/admin/ledger/entries", "/admin/ledger/summary", "/admin/ledger/search?q=ab",
                 f"/admin/ledger/groups/order:{open_id}", "/admin/ledger/accounts/1/statement"):
        assert (await client.get(path)).status_code == 401, path
        assert (await client.get(path, headers=_auth(buyer_token))).status_code == 403, path
        assert (await client.get(path, headers=_auth(seller_token))).status_code == 403, path

    bad = [
        {"cursor": "nonsense"},
        {"group": "order:abc"},
        {"group": "order:1' OR 1=1"},
        {"direction": "sideways"},
        {"type": "not_a_type"},
        {"start": "2026-10-01T00:00:00"},                       # no timezone
        {"start": "2026-10-02T00:00:00+07:00", "end": "2026-10-01T00:00:00+07:00"},
        {"limit": 0},
        {"limit": 1000},
    ]
    for params in bad:
        r = await client.get("/admin/ledger/entries", params=params, headers=_auth(admin_token))
        assert r.status_code == 422, (params, r.status_code, r.text)
    assert (await client.get("/admin/ledger/groups/bogus:1", headers=_auth(admin_token))).status_code == 422
    assert (await client.get("/admin/ledger/accounts/99999/statement", headers=_auth(admin_token))).status_code == 404


@pytest.mark.asyncio
async def test_manual_adjustments_are_attributed_to_admin(client):
    buyer_token, seller_token, admin_token, open_id, done_id = await _flow(client)
    buyer = await _me(client, buyer_token)
    credit = await client.post("/wallet/topup", json={"account_id": buyer["id"], "amount": 777, "reason": "đền bù"},
                               headers=_auth(admin_token))
    assert credit.status_code == 200, credit.text
    rows = await _all_entries(client, admin_token, account_id=buyer["id"], amount=777)
    assert len(rows) == 1 and rows[0]["actor"] == "admin" and rows[0]["direction"] == "in"
    # The actor filter is the SQL twin of the per-row actor label.
    everything = await _all_entries(client, admin_token)
    for actor in ("admin", "system", "user", "demo"):
        filtered = await _all_entries(client, admin_token, actor=actor)
        assert {e["id"] for e in filtered} == {e["id"] for e in everything if e["actor"] == actor}, actor
    assert (await client.get("/admin/ledger/entries", params={"actor": "robot"}, headers=_auth(admin_token))).status_code == 422
    assert rows[0]["balance_after"] == credit.json()["available_balance"]


@pytest.mark.asyncio
async def test_new_admin_without_data_gets_empty_journal(client):
    token = await register_and_login(client, "solo-admin@example.com")
    from tests.conftest import make_admin
    await make_admin("solo-admin@example.com")
    token = await register_and_login(client, "solo-admin@example.com")
    r = await client.get("/admin/ledger/entries", headers=_auth(token))
    assert r.status_code == 200 and r.json() == {"items": [], "next_cursor": None}
    s = await client.get("/admin/ledger/summary", headers=_auth(token))
    assert s.status_code == 200 and s.json()["by_type"] == {} and s.json()["last_reconcile"] is None


@pytest.mark.asyncio
async def test_withdrawal_rows_name_the_admin_and_the_request_status(client):
    """Confirming a transfer or rejecting a request is the admin's act, and each
    row of a withdrawal says where that request stands."""
    seller_token, admin_token = await _seller_with_balance(client, "journal_wd@example.com", 1_000_000)

    async def withdraw(amount):
        res = await client.post("/wallet/withdraw", json={
            "bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": amount,
        }, headers=_auth(seller_token))
        assert res.status_code == 200, res.text
        return res.json()["id"]

    paid, rejected, waiting = await withdraw(200_000), await withdraw(150_000), await withdraw(100_000)
    await client.post(f"/admin/withdrawals/{paid}/approve", headers=_auth(admin_token))
    await client.post(f"/admin/withdrawals/{paid}/paid", json={"payout_reference": "FT-J1"}, headers=_auth(admin_token))
    await client.post(f"/admin/withdrawals/{rejected}/reject", json={"reason": "Sai tên"}, headers=_auth(admin_token))

    seller = await _me(client, seller_token)
    rows = await _all_entries(client, admin_token, account_id=seller["id"], type=[
        "withdraw_lock", "withdraw_unlock", "withdraw", "withdraw_fee",
    ])
    by_key = {(e["type"], e["group"]): e for e in rows}
    assert by_key[("withdraw_lock", f"withdraw:{paid}")]["actor"] == "user"
    assert by_key[("withdraw", f"withdraw:{paid}")]["actor"] == "admin"
    assert by_key[("withdraw_unlock", f"withdraw:{rejected}")]["actor"] == "admin"
    assert by_key[("withdraw_lock", f"withdraw:{paid}")]["withdraw_status"] == "paid"
    assert by_key[("withdraw_lock", f"withdraw:{rejected}")]["withdraw_status"] == "rejected"
    assert by_key[("withdraw_lock", f"withdraw:{waiting}")]["withdraw_status"] == "pending"
    fee_income = await _all_entries(client, admin_token, type=["platform_fee"], group=f"withdraw:{paid}")
    assert all(e["actor"] == "admin" for e in fee_income)

    # The actor filter stays the SQL twin of the per-row label.
    everything = await _all_entries(client, admin_token)
    for actor in ("admin", "system", "user"):
        filtered = await _all_entries(client, admin_token, actor=actor)
        assert {e["id"] for e in filtered} == {e["id"] for e in everything if e["actor"] == actor}, actor

    header = (await client.get(f"/admin/ledger/groups/withdraw:{paid}", headers=_auth(admin_token))).json()["header"]
    assert header["status"] == "paid" and header["payout_reference"] == "FT-J1"
    header = (await client.get(f"/admin/ledger/groups/withdraw:{rejected}", headers=_auth(admin_token))).json()["header"]
    assert header["status"] == "rejected" and header["reject_reason"] == "Sai tên"
