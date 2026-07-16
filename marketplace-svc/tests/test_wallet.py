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

    resp = await client.post("/wallet/withdraw", json={"amount": 500_000},
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

    first = await client.post("/wallet/withdraw", json={"amount": 700_000},
                              headers={"Authorization": f"Bearer {seller_token}"})
    assert first.status_code == 200

    second = await client.post("/wallet/withdraw", json={"amount": 700_000},
                               headers={"Authorization": f"Bearer {seller_token}"})
    assert second.status_code == 402

    wallet = (await client.get("/wallet", headers={"Authorization": f"Bearer {seller_token}"})).json()
    assert wallet["available_balance"] == 300_000
    assert wallet["locked_balance"] == 700_000


@pytest.mark.asyncio
async def test_approve_withdrawal_moves_from_locked_only(client):
    seller_token, admin_token = await _seller_with_balance(client, "wallet7@example.com", 1_000_000)
    req = (await client.post("/wallet/withdraw", json={"amount": 500_000},
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
    req = (await client.post("/wallet/withdraw", json={"amount": 500_000},
                             headers={"Authorization": f"Bearer {seller_token}"})).json()

    resp = await client.post(f"/admin/withdrawals/{req['id']}/reject",
                             headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200

    wallet = (await client.get("/wallet", headers={"Authorization": f"Bearer {seller_token}"})).json()
    assert wallet["available_balance"] == 1_000_000
    assert wallet["locked_balance"] == 0
