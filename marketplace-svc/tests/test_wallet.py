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
    resp = await client.post("/wallet/topup", json={"account_id": 1, "amount": 10000},
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

    resp = await client.post("/wallet/topup", json={"account_id": buyer_id, "amount": 50000},
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
    await client.post("/wallet/topup", json={"account_id": seller_id, "amount": amount},
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
async def test_approve_withdrawal_moves_from_locked_only(client):
    seller_token, admin_token = await _seller_with_balance(client, "wallet7@example.com", 1_000_000)
    req = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 500_000},
                             headers={"Authorization": f"Bearer {seller_token}"})).json()

    resp = await client.post(f"/admin/withdrawals/{req['id']}/approve",
                             headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200

    wallet = (await client.get("/wallet", headers={"Authorization": f"Bearer {seller_token}"})).json()
    assert wallet["available_balance"] == 500_000  # unchanged — already deducted at request time
    assert wallet["locked_balance"] == 0


@pytest.mark.asyncio
async def test_reject_withdrawal_returns_to_available(client):
    seller_token, admin_token = await _seller_with_balance(client, "wallet8@example.com", 1_000_000)
    req = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 500_000},
                             headers={"Authorization": f"Bearer {seller_token}"})).json()

    resp = await client.post(f"/admin/withdrawals/{req['id']}/reject",
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
    await client.post("/wallet/topup", json={"account_id": me["id"], "amount": 50_000},
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

    # Approved withdrawal: locks, then draws down locked only.
    approved = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 300_000},
                                  headers={"Authorization": f"Bearer {seller_token}"})).json()
    await client.post(f"/admin/withdrawals/{approved['id']}/approve",
                      headers={"Authorization": f"Bearer {admin_token}"})

    # Rejected withdrawal: locks, then returns the money.
    rejected = (await client.post("/wallet/withdraw", json={"bank_name": "Vietcombank", "bank_account_number": "0123456789", "bank_account_holder": "TEST USER", "amount": 200_000},
                                  headers={"Authorization": f"Bearer {seller_token}"})).json()
    await client.post(f"/admin/withdrawals/{rejected['id']}/reject",
                      headers={"Authorization": f"Bearer {admin_token}"})

    txs = (await client.get("/wallet/transactions",
                            headers={"Authorization": f"Bearer {seller_token}"})).json()
    wallet = (await client.get("/wallet", headers={"Authorization": f"Bearer {seller_token}"})).json()

    total_in = sum(t["amount"] for t in txs if t["direction"] == TransactionDirection.in_.value)
    total_out = sum(t["amount"] for t in txs if t["direction"] == TransactionDirection.out.value)
    assert total_in - total_out == wallet["available_balance"]

    # And the `withdraw` row is what would double-count if it were an outflow.
    assert [t["direction"] for t in txs if t["type"] == "withdraw"] == ["neutral"]
