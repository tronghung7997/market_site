import asyncio

import pytest
from tests.conftest import make_admin, make_seller, register_and_login


@pytest.mark.asyncio
async def test_get_wallet_zero_balance(client):
    token = await register_and_login(client, "wallet1@example.com")
    resp = await client.get("/wallet", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["balance"] == 0


@pytest.mark.asyncio
async def test_topup_requires_admin(client):
    token = await register_and_login(client, "wallet2@example.com")
    resp = await client.post("/wallet/topup", json={"reason": "test topup", "account_id": 1, "amount": 10000},
                             headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_topup_success(client):
    buyer_token = await register_and_login(client, "wallet3@example.com")
    buyer_me = await client.get("/me", headers={"Authorization": f"Bearer {buyer_token}"})
    buyer_id = buyer_me.json()["id"]

    admin_token = await register_and_login(client, "walletadmin@example.com")
    await make_admin("walletadmin@example.com")
    admin_token = await register_and_login(client, "walletadmin@example.com")

    resp = await client.post("/wallet/topup", json={"reason": "test topup", "account_id": buyer_id, "amount": 50000},
                             headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    assert resp.json()["balance"] == 50000


@pytest.mark.asyncio
async def test_transaction_history(client):
    token = await register_and_login(client, "wallet4@example.com")
    resp = await client.get("/wallet/transactions", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


async def _seller_with_balance(client, email, amount):
    seller_token = await register_and_login(client, email)
    await make_seller(email)
    seller_token = await register_and_login(client, email)
    seller_me = await client.get("/me", headers={"Authorization": f"Bearer {seller_token}"})
    seller_id = seller_me.json()["id"]

    admin_token = await register_and_login(client, "walletadmin2@example.com")
    await make_admin("walletadmin2@example.com")
    admin_token = await register_and_login(client, "walletadmin2@example.com")
    await client.post("/wallet/topup", json={"reason": "test topup", "account_id": seller_id, "amount": amount},
                      headers={"Authorization": f"Bearer {admin_token}"})
    return seller_token, admin_token


@pytest.mark.asyncio
async def test_request_withdraw_locks_balance(client):
    seller_token, _ = await _seller_with_balance(client, "wallet5@example.com", 1_000_000)

    resp = await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 500_000},
                             headers={"Authorization": f"Bearer {seller_token}"})
    assert resp.status_code == 200

    wallet = (await client.get("/wallet", headers={"Authorization": f"Bearer {seller_token}"})).json()
    assert wallet["available_balance"] == 500_000
    assert wallet["locked_balance"] == 500_000
    assert wallet["balance"] == 500_000


@pytest.mark.asyncio
async def test_second_withdraw_request_fails_once_balance_is_locked(client):
    """Tái hiện bug cũ: request_withdraw trước đây chỉ kiểm tra balance mà không
    khoá tiền, nên 2 request liên tiếp có thể cùng vượt qua check dù tổng vượt
    quá số dư thực. Sau khi khoá đúng lúc request, request thứ 2 phải fail."""
    seller_token, _ = await _seller_with_balance(client, "wallet6@example.com", 1_000_000)

    first = await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 700_000},
                              headers={"Authorization": f"Bearer {seller_token}"})
    assert first.status_code == 200

    second = await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 700_000},
                               headers={"Authorization": f"Bearer {seller_token}"})
    assert second.status_code == 402

    wallet = (await client.get("/wallet", headers={"Authorization": f"Bearer {seller_token}"})).json()
    assert wallet["available_balance"] == 300_000
    assert wallet["locked_balance"] == 700_000


@pytest.mark.asyncio
async def test_concurrent_withdrawals_cannot_exceed_available_balance(client):
    seller_token, _ = await _seller_with_balance(client, "wallet_race@example.com", 1_000_000)
    headers = {"Authorization": f"Bearer {seller_token}"}
    body = {
        "bank_name": "Vietcombank",
        "bank_account_number": "0123456789",
        "bank_account_holder": "TEST USER",
        "amount": 700_000,
    }

    first, second = await asyncio.gather(
        client.post("/wallet/withdraw", json=body, headers=headers),
        client.post("/wallet/withdraw", json=body, headers=headers),
    )

    assert sorted((first.status_code, second.status_code)) == [200, 402]
    wallet = (await client.get("/wallet", headers=headers)).json()
    assert wallet["available_balance"] == 300_000
    assert wallet["locked_balance"] == 700_000


@pytest.mark.asyncio
async def test_approve_keeps_money_locked_until_transfer_is_confirmed(client):
    """Approval is a decision; the money leaves only when the admin confirms
    the bank transfer. Until then it stays locked and nothing is booked."""
    seller_token, admin_token = await _seller_with_balance(client, "wallet7@example.com", 1_000_000)
    auth_s, auth_a = {"Authorization": f"Bearer {seller_token}"}, {"Authorization": f"Bearer {admin_token}"}
    req = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 500_000},
                             headers=auth_s)).json()

    resp = await client.post(f"/admin/withdrawals/{req['id']}/approve", headers=auth_a)
    assert resp.status_code == 200 and resp.json()["status"] == "approved"
    wallet = (await client.get("/wallet", headers=auth_s)).json()
    assert wallet["available_balance"] == 500_000 and wallet["locked_balance"] == 500_000
    txs = (await client.get("/wallet/transactions", headers=auth_s)).json()
    assert "withdraw" not in {t["type"] for t in txs}

    paid = await client.post(f"/admin/withdrawals/{req['id']}/paid", json={"payout_reference": "FT123"}, headers=auth_a)
    assert paid.status_code == 200 and paid.json()["status"] == "paid"
    wallet = (await client.get("/wallet", headers=auth_s)).json()
    assert wallet["available_balance"] == 500_000 and wallet["locked_balance"] == 0
    txs = (await client.get("/wallet/transactions", headers=auth_s)).json()
    assert [t["amount"] for t in txs if t["type"] == "withdraw"] == [500_000]
    # Confirming twice is refused, and never books twice.
    again = await client.post(f"/admin/withdrawals/{req['id']}/paid", json={"payout_reference": "FT123"}, headers=auth_a)
    assert again.status_code == 400


@pytest.mark.asyncio
async def test_approved_request_can_still_be_rejected_before_transfer(client):
    seller_token, admin_token = await _seller_with_balance(client, "wallet7b@example.com", 1_000_000)
    auth_s, auth_a = {"Authorization": f"Bearer {seller_token}"}, {"Authorization": f"Bearer {admin_token}"}
    req = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 400_000},
                             headers=auth_s)).json()
    assert (await client.post(f"/admin/withdrawals/{req['id']}/approve", headers=auth_a)).status_code == 200
    rej = await client.post(f"/admin/withdrawals/{req['id']}/reject", json={"reason": "Sai số tài khoản"}, headers=auth_a)
    assert rej.status_code == 200 and rej.json()["status"] == "rejected"
    wallet = (await client.get("/wallet", headers=auth_s)).json()
    assert wallet["available_balance"] == 1_000_000 and wallet["locked_balance"] == 0
    assert (await client.post(f"/admin/withdrawals/{req['id']}/paid", json={"payout_reference": "FT9"}, headers=auth_a)).status_code == 400


@pytest.mark.asyncio
async def test_legacy_approval_already_booked_is_paid_without_double_booking(client):
    """Requests approved under the old flow already carry the `withdraw` row
    and left the locked balance: confirming them must not book again, and
    they can no longer be rejected."""
    from sqlalchemy import select, update

    from src.database import SessionLocal
    from src.models.wallet import Transaction, Wallet, WithdrawRequest, WithdrawStatus
    from src.ledger.service import reconcile_ledger

    seller_token, admin_token = await _seller_with_balance(client, "wallet7c@example.com", 1_000_000)
    auth_s, auth_a = {"Authorization": f"Bearer {seller_token}"}, {"Authorization": f"Bearer {admin_token}"}
    req = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 300_000},
                             headers=auth_s)).json()
    async with SessionLocal() as db:  # what the old approve did
        w = await db.get(WithdrawRequest, req["id"])
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == w.account_id))
        wallet.locked_balance -= w.amount
        w.status = WithdrawStatus.approved
        db.add(Transaction(wallet_id=wallet.id, type="withdraw", amount=w.amount, reference_id=f"withdraw-{w.id}"))
        await db.commit()
    assert (await client.post(f"/admin/withdrawals/{req['id']}/reject", json={"reason": "x y z"}, headers=auth_a)).status_code == 409
    paid = await client.post(f"/admin/withdrawals/{req['id']}/paid", json={"payout_reference": "FT-OLD"}, headers=auth_a)
    assert paid.status_code == 200, paid.text
    txs = (await client.get("/wallet/transactions", headers=auth_s)).json()
    assert [t["amount"] for t in txs if t["type"] == "withdraw"] == [300_000]
    async with SessionLocal() as db:
        assert (await reconcile_ledger(db)).ok


@pytest.mark.asyncio
async def test_pre_lock_approval_with_unreferenced_payout_is_not_refunded(client):
    """Prod withdrawal #1 (2026-07-15): approved before balance layers, so it
    has no `withdraw-<id>` lock and its payout row carries no reference.
    Rejecting it used to unlock money that was never locked (500 on
    ck_wallets_locked_nonnegative); it must read as already paid out."""
    from sqlalchemy import select

    from src.database import SessionLocal
    from src.models.wallet import Transaction, Wallet, WithdrawRequest, WithdrawStatus

    seller_token, admin_token = await _seller_with_balance(client, "wallet7d@example.com", 1_000_000)
    auth_s, auth_a = {"Authorization": f"Bearer {seller_token}"}, {"Authorization": f"Bearer {admin_token}"}
    seller_id = (await client.get("/me", headers=auth_s)).json()["id"]
    async with SessionLocal() as db:  # what the pre-lock flow left behind
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == seller_id))
        req = WithdrawRequest(account_id=seller_id, amount=100_000, fee_amount=0, net_amount=100_000,
                              status=WithdrawStatus.approved, bank_name="VCB", bank_account_number="1", bank_account_holder="A")
        db.add(req)
        await db.flush()
        wallet.available_balance -= 100_000
        db.add(Transaction(wallet_id=wallet.id, type="withdraw", amount=100_000, description="Withdrawal approved"))
        await db.commit()
        req_id = req.id

    rej = await client.post(f"/admin/withdrawals/{req_id}/reject", json={"reason": "đóng lệnh cũ"}, headers=auth_a)
    assert rej.status_code == 409, rej.text
    wallet = (await client.get("/wallet", headers=auth_s)).json()
    assert wallet["available_balance"] == 900_000 and wallet["locked_balance"] == 0

    paid = await client.post(f"/admin/withdrawals/{req_id}/paid", json={"payout_reference": "FT-LEGACY"}, headers=auth_a)
    assert paid.status_code == 200, paid.text
    assert paid.json()["status"] == "paid"
    txs = (await client.get("/wallet/transactions", headers=auth_s)).json()
    assert [t["amount"] for t in txs if t["type"] == "withdraw"] == [100_000]


@pytest.mark.asyncio
async def test_reject_refuses_when_locked_balance_is_short(client):
    from sqlalchemy import select

    from src.database import SessionLocal
    from src.models.wallet import Wallet

    seller_token, admin_token = await _seller_with_balance(client, "wallet7e@example.com", 1_000_000)
    auth_s, auth_a = {"Authorization": f"Bearer {seller_token}"}, {"Authorization": f"Bearer {admin_token}"}
    req = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 300_000},
                             headers=auth_s)).json()
    async with SessionLocal() as db:
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == req["account_id"]))
        wallet.locked_balance = 0
        await db.commit()
    rej = await client.post(f"/admin/withdrawals/{req['id']}/reject", json={"reason": "x y z"}, headers=auth_a)
    assert rej.status_code == 409
    assert (await client.get("/wallet", headers=auth_s)).json()["available_balance"] == 700_000


@pytest.mark.asyncio
async def test_reject_withdrawal_returns_to_available(client):
    seller_token, admin_token = await _seller_with_balance(client, "wallet8@example.com", 1_000_000)
    req = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 500_000},
                             headers={"Authorization": f"Bearer {seller_token}"})).json()

    resp = await client.post(f"/admin/withdrawals/{req['id']}/reject",
                             json={"reason": "Không đủ điều kiện rút"},
                             headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200

    wallet = (await client.get("/wallet", headers={"Authorization": f"Bearer {seller_token}"})).json()
    assert wallet["available_balance"] == 1_000_000
    assert wallet["locked_balance"] == 0


# ---------------------------------------------------------------------------
# Ledger direction — Σ(in) − Σ(out) must equal available_balance
# ---------------------------------------------------------------------------


def test_every_transaction_type_has_a_direction():
    """The bug this guards: the wallet UI used to classify by negation — anything
    not in a hand-written credit set counted as money out. A type added without a
    direction here would silently break the totals again."""
    from src.models.wallet import TRANSACTION_DIRECTION, TransactionType

    missing = [t.value for t in TransactionType if t not in TRANSACTION_DIRECTION]
    assert missing == [], f"TransactionType thiếu direction: {missing}"


@pytest.mark.asyncio
async def test_transactions_expose_direction(client):
    token = await register_and_login(client, "wallet_dir@example.com")
    admin_token = await register_and_login(client, "wallet_dir_admin@example.com")
    await make_admin("wallet_dir_admin@example.com")
    admin_token = await register_and_login(client, "wallet_dir_admin@example.com")

    me = (await client.get("/me", headers={"Authorization": f"Bearer {token}"})).json()
    await client.post("/wallet/topup", json={"reason": "test topup", "account_id": me["id"], "amount": 50_000},
                      headers={"Authorization": f"Bearer {admin_token}"})

    txs = (await client.get("/wallet/transactions",
                            headers={"Authorization": f"Bearer {token}"})).json()
    assert [t["direction"] for t in txs] == ["in"]


@pytest.mark.asyncio
async def test_ledger_sums_to_available_balance_across_a_full_lifecycle(client):
    """Walks a wallet through every mutation that touches available_balance and
    asserts the ledger still adds up — the property the wallet page reports."""
    from src.models.wallet import TransactionDirection

    seller_token, admin_token = await _seller_with_balance(client, "wallet_recon@example.com", 1_000_000)

    # Paid withdrawal: locks, approval keeps it locked, the confirmed transfer draws down locked only.
    approved = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 300_000},
                                  headers={"Authorization": f"Bearer {seller_token}"})).json()
    await client.post(f"/admin/withdrawals/{approved['id']}/approve",
                      headers={"Authorization": f"Bearer {admin_token}"})
    await client.post(f"/admin/withdrawals/{approved['id']}/paid", json={"payout_reference": "FT-REC"},
                      headers={"Authorization": f"Bearer {admin_token}"})

    # Rejected withdrawal: locks, then returns the money.
    rejected = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 200_000},
                                  headers={"Authorization": f"Bearer {seller_token}"})).json()
    await client.post(f"/admin/withdrawals/{rejected['id']}/reject",
                      json={"reason": "Sai thông tin ngân hàng"},
                      headers={"Authorization": f"Bearer {admin_token}"})

    txs = (await client.get("/wallet/transactions",
                            headers={"Authorization": f"Bearer {seller_token}"})).json()
    wallet = (await client.get("/wallet", headers={"Authorization": f"Bearer {seller_token}"})).json()

    total_in = sum(t["amount"] for t in txs if t["direction"] == TransactionDirection.in_.value)
    total_out = sum(t["amount"] for t in txs if t["direction"] == TransactionDirection.out.value)
    assert total_in - total_out == wallet["available_balance"]

    # And the `withdraw` row is what would double-count if it were an outflow.
    assert [t["direction"] for t in txs if t["type"] == "withdraw"] == ["neutral"]


@pytest.mark.asyncio
async def test_withdrawal_rows_carry_their_request_status(client):
    """The lock row reads "waiting" only while the request is open: every row of
    a withdrawal names its request's status."""
    seller_token, admin_token = await _seller_with_balance(client, "wallet_wstatus@example.com", 1_000_000)
    auth_s, auth_a = {"Authorization": f"Bearer {seller_token}"}, {"Authorization": f"Bearer {admin_token}"}

    def withdraw(amount):
        return client.post("/wallet/withdraw", json={
            "bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": amount,
        }, headers=auth_s)

    open_req = (await withdraw(100_000)).json()
    paid_req = (await withdraw(200_000)).json()
    rejected_req = (await withdraw(300_000)).json()
    await client.post(f"/admin/withdrawals/{paid_req['id']}/approve", headers=auth_a)
    await client.post(f"/admin/withdrawals/{paid_req['id']}/paid", json={"payout_reference": "FT-S"}, headers=auth_a)
    await client.post(f"/admin/withdrawals/{rejected_req['id']}/reject", json={"reason": "Sai tên"}, headers=auth_a)

    txs = (await client.get("/wallet/transactions", headers=auth_s)).json()
    by_amount = {(t["type"], t["amount"]): t["withdraw_status"] for t in txs}
    assert by_amount[("withdraw_lock", 100_000)] == "pending"
    assert by_amount[("withdraw_lock", 200_000)] == "paid"
    assert by_amount[("withdraw_lock", 300_000)] == "rejected"
    assert by_amount[("withdraw_unlock", 300_000)] == "rejected"
    assert {t["withdraw_status"] for t in txs if t["type"] == "withdraw"} == {"paid"}
    assert [t["withdraw_status"] for t in txs if t["type"] == "topup"] == [None]
    assert all(t["fee_amount"] is None for t in txs)
    # Internal ids stay out of the visible reference.
    assert all(t["reference_label"] is None for t in txs if t["type"].startswith("withdraw"))
    assert open_req["status"] == "pending"


@pytest.mark.asyncio
async def test_sale_payout_shows_the_platform_fee_it_was_net_of(client):
    from sqlalchemy import select

    from src.database import SessionLocal
    from src.models.order import Order
    from src.wallet.service import release_escrow
    from tests.test_orders import setup_buyable_product

    buyer_token, seller_token, _, instant_variant_id, _ = await setup_buyable_product(client)
    order = await client.post("/orders", json={"variant_id": instant_variant_id, "quantity": 1},
                              headers={"Authorization": f"Bearer {buyer_token}"})
    assert order.status_code == 201, order.text
    order_id = order.json()["id"]
    async with SessionLocal() as db:
        seller_id = await db.scalar(select(Order.seller_id).where(Order.id == order_id))
        await release_escrow(order_id, seller_id, 1000, 70, db)
        await db.commit()

    seller_txs = (await client.get("/wallet/transactions", headers={"Authorization": f"Bearer {seller_token}"})).json()
    [sale] = [t for t in seller_txs if t["type"] == "purchase_release"]
    assert (sale["amount"], sale["fee_amount"]) == (930, 70)
    assert sale["order_code"] == order.json()["order_code"]
    buyer_txs = (await client.get("/wallet/transactions", headers={"Authorization": f"Bearer {buyer_token}"})).json()
    assert all(t["fee_amount"] is None for t in buyer_txs)


@pytest.mark.asyncio
async def test_ledger_page_filters_pages_and_summarises_in_sql(client):
    """GET /wallet/ledger: the /transactions page without shipping the whole history."""
    from sqlalchemy import select, update

    from src.database import SessionLocal
    from src.models.order import Order, OrderStatus
    from src.models.wallet import Transaction
    from src.wallet.service import refund_escrow, release_escrow
    from tests.test_orders import setup_buyable_product

    buyer_token, seller_token, _, variant_id, _ = await setup_buyable_product(client)
    buyer, seller = {"Authorization": f"Bearer {buyer_token}"}, {"Authorization": f"Bearer {seller_token}"}
    held = (await client.post("/orders", json={"variant_id": variant_id, "quantity": 1}, headers=buyer)).json()
    sold = (await client.post("/orders", json={"variant_id": variant_id, "quantity": 1}, headers=buyer)).json()
    refunded = (await client.post("/orders", json={"variant_id": variant_id, "quantity": 1}, headers=buyer)).json()
    async with SessionLocal() as db:
        seller_id = await db.scalar(select(Order.seller_id).where(Order.id == sold["id"]))
        buyer_id = await db.scalar(select(Order.buyer_id).where(Order.id == sold["id"]))
        await release_escrow(sold["id"], seller_id, 1000, 100, db)
        await db.execute(update(Order).where(Order.id == sold["id"]).values(status=OrderStatus.completed))
        await db.execute(update(Order).where(Order.id == held["id"]).values(status=OrderStatus.delivered))
        await refund_escrow(refunded["id"], buyer_id, 1000, db)
        await db.execute(update(Order).where(Order.id == refunded["id"]).values(status=OrderStatus.refunded))
        await db.commit()

    async def page(headers, **params):
        resp = await client.get("/wallet/ledger", params=params, headers=headers)
        assert resp.status_code == 200, resp.text
        return resp.json()

    # Buyer: the top-up, three purchases and a refund.
    everything = await page(buyer)
    assert everything["total"] == 5
    assert everything["summary"] == {"count": 5, "in": 100_000 + 1000, "out": 3000, "net": 98_000, "open": 1}
    assert everything["group_counts"] == {"all": 5, "buy": 4, "sell": 0, "funds": 1, "other": 0}
    assert everything["present"] == {"groups": ["buy", "funds"], "kinds": ["topup", "purchase", "refund"], "channels": []}
    assert everything["open_total"] == 1
    assert [t["type"] for t in everything["items"]][-1] == "topup"  # newest first

    buys = await page(buyer, group="buy")
    assert buys["total"] == 4 and buys["group_counts"]["funds"] == 1  # tabs ignore the group
    assert {t["type"] for t in buys["items"]} == {"purchase_hold", "refund"}
    assert (await page(buyer, kind="refund"))["total"] == 1
    assert (await page(buyer, dir="in"))["total"] == 2
    opened = await page(buyer, open="true")
    assert [t["order_code"] for t in opened["items"]] == [held["order_code"]]
    by_code = await page(buyer, q=refunded["order_code"].lower())
    assert {t["type"] for t in by_code["items"]} == {"purchase_hold", "refund"}
    assert (await page(buyer, q="hoan tien", q_types="refund"))["total"] == 1
    assert (await page(buyer, q="zzz-no-match"))["total"] == 0

    # Paging: newest first, stable, nothing lost or repeated.
    first, second = await page(buyer, per_page=2, page=1), await page(buyer, per_page=2, page=2)
    third = await page(buyer, per_page=2, page=3)
    ids = [t["id"] for p in (first, second, third) for t in p["items"]]
    assert len(ids) == len(set(ids)) == 5 and first["total"] == 5

    # Period bounds are [start, end).
    async with SessionLocal() as db:
        topup_at = await db.scalar(select(Transaction.created_at).where(Transaction.type == "topup", Transaction.amount == 100_000).order_by(Transaction.id.desc()).limit(1))
    assert (await page(buyer, end=topup_at.isoformat()))["total"] == 0
    assert (await page(buyer, start=topup_at.isoformat(), group="funds"))["total"] == 1

    # Seller: the sale payout (net of the fee) and nothing of the buyer's.
    sales = await page(seller, group="sell")
    [payout] = sales["items"]
    assert (payout["type"], payout["amount"], payout["fee_amount"]) == ("purchase_release", 900, 100)
    assert sales["group_counts"]["buy"] == 0

    # Bad input and no session.
    assert (await client.get("/wallet/ledger", params={"group": "nope"}, headers=buyer)).status_code == 422
    assert (await client.get("/wallet/ledger", params={"per_page": 500}, headers=buyer)).status_code == 422
    assert (await client.get("/wallet/ledger")).status_code == 401


@pytest.mark.asyncio
async def test_ledger_page_tracks_withdrawals_and_channels(client):
    seller_token, admin_token = await _seller_with_balance(client, "wallet_ledger_w@example.com", 1_000_000)
    auth_s, auth_a = {"Authorization": f"Bearer {seller_token}"}, {"Authorization": f"Bearer {admin_token}"}

    def withdraw(amount):
        return client.post("/wallet/withdraw", json={
            "bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": amount,
        }, headers=auth_s)

    await withdraw(100_000)
    paid = (await withdraw(200_000)).json()
    await client.post(f"/admin/withdrawals/{paid['id']}/approve", headers=auth_a)
    await client.post(f"/admin/withdrawals/{paid['id']}/paid", json={"payout_reference": "FT-L"}, headers=auth_a)

    body = (await client.get("/wallet/ledger", params={"open": "true"}, headers=auth_s)).json()
    assert [(t["type"], t["withdraw_status"]) for t in body["items"]] == [("withdraw_lock", "pending")]
    assert body["open_total"] == 1
    everything = (await client.get("/wallet/ledger", headers=auth_s)).json()
    assert everything["present"]["channels"] == ["bank"]
    assert everything["summary"]["out"] == 300_000  # the payout itself draws on locked money only
    bank = (await client.get("/wallet/ledger", params={"channel": "bank"}, headers=auth_s)).json()
    assert {t["type"] for t in bank["items"]} == {"withdraw_lock", "withdraw"}
