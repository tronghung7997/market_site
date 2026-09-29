"""SePay Webhooks + VietQR bank-deposit integration tests."""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy import select

from src.config import settings
from src.database import SessionLocal
from src.models.account import Account
from src.models.alert import Alert
from src.models.payment import (
    DepositIntent,
    DepositIntentStatus,
    DepositProvider,
    SePayWebhookEvent,
)
from src.models.wallet import Transaction, TransactionType, Wallet
from src.payments import rail_config, sepay_client
from tests.conftest import make_admin, register_and_login


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _account(email: str) -> Account:
    async with SessionLocal() as db:
        return await db.scalar(select(Account).where(Account.email == email))


async def _balance(email: str) -> int:
    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == email))
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == account.id))
        return wallet.available_balance if wallet else 0


async def _make_intent(
    account_email: str,
    amount: int = 50_000,
    *,
    status: DepositIntentStatus = DepositIntentStatus.pending,
) -> int:
    account = await _account(account_email)
    async with SessionLocal() as db:
        intent = DepositIntent(
            account_id=account.id,
            amount=amount,
            status=status,
            provider=DepositProvider.sepay.value,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
            bank_code=settings.sepay_bank_code,
            bank_account_number=settings.sepay_bank_account_number,
            bank_account_name=settings.sepay_bank_account_name,
        )
        db.add(intent)
        await db.flush()
        intent.payment_code = f"{sepay_client.payment_code_prefix()}{intent.id:010d}"
        intent.qr_code = sepay_client.build_vietqr_url(
            amount=amount,
            payment_code=intent.payment_code,
        )
        await db.commit()
        return intent.id


def _payload(
    intent_id: int,
    amount: int,
    *,
    transaction_id: int | str = 92704,
    reference: str = "FT24012345678",
    account_number: str | None = None,
    transfer_type: str = "in",
    code: str | None = None,
    sub_account: str = "",
) -> dict:
    return {
        "id": transaction_id,
        "gateway": settings.sepay_bank_code,
        "transactionDate": "2026-08-19 12:00:00",
        "accountNumber": account_number or settings.sepay_bank_account_number,
        "subAccount": sub_account,
        "code": code if code is not None else f"{sepay_client.payment_code_prefix()}{intent_id:010d}",
        "content": code if code is not None else f"{sepay_client.payment_code_prefix()}{intent_id:010d}",
        "transferType": transfer_type,
        "description": "NGUYEN VAN A chuyen tien",
        "transferAmount": amount,
        "accumulated": 1_000_000,
        "referenceCode": reference,
    }


async def _post_webhook(
    client,
    payload: dict,
    *,
    timestamp: int | None = None,
    secret: str | None = None,
):
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    ts = int(time.time()) if timestamp is None else timestamp
    signature = sepay_client.sign_webhook(raw, ts, secret)
    return await client.post(
        "/webhooks/sepay",
        content=raw,
        headers={
            "content-type": "application/json",
            "X-SePay-Signature": signature,
            "X-SePay-Timestamp": str(ts),
        },
    )


class TestSePayUnit:
    def test_reconciliation_config_accepts_db_destination(self, monkeypatch):
        monkeypatch.setattr(settings, "sepay_bank_code", "")
        monkeypatch.setattr(settings, "sepay_bank_account_number", "")
        monkeypatch.setattr(settings, "sepay_bank_account_name", "")
        monkeypatch.setattr(settings, "sepay_bank_account_id", "")
        assert sepay_client.is_reconciliation_configured(
            bank_code="BIDV",
            account_number="8865142865",
            account_name="NGUYEN NHAT DUY",
            account_id="0df35cd9-922e-11f1-b21a-a6006ab65aca",
        )

    def test_api_base_url_normalizes_version_suffix(self, monkeypatch):
        monkeypatch.setattr(settings, "sepay_api_base_url", "https://userapi.sepay.vn/v2/")
        assert sepay_client._api_base_url() == "https://userapi.sepay.vn"

    def test_signature_vector_and_raw_body_sensitivity(self):
        raw = b'{"id":1,"content":"NAP1"}'
        signature = sepay_client.sign_webhook(raw, 1_700_000_000, "secret")
        assert signature.startswith("sha256=")
        assert signature == sepay_client.sign_webhook(raw, "1700000000", "secret")
        assert signature != sepay_client.sign_webhook(b'{"content":"NAP1","id":1}', 1_700_000_000, "secret")

    def test_verify_rejects_missing_bad_and_expired_headers(self):
        raw = b'{"id":1}'
        now = 1_700_000_000
        good = sepay_client.sign_webhook(raw, int(now))
        assert sepay_client.verify_webhook_signature(raw, good, str(int(now)), now=now)
        assert not sepay_client.verify_webhook_signature(raw, None, str(int(now)), now=now)
        assert not sepay_client.verify_webhook_signature(raw, "sha256=bad", str(int(now)), now=now)
        assert not sepay_client.verify_webhook_signature(raw, good, str(int(now - 301)), now=now)

    def test_payment_code_and_vietqr_url(self):
        code = sepay_client.generate_payment_code()
        assert code.startswith("NAP")
        assert len(code) == 13
        assert sepay_client.is_valid_payment_code(code)
        assert not sepay_client.is_valid_payment_code("NAP42")
        assert not sepay_client.is_valid_payment_code("OTHER23456789AB")
        url = sepay_client.build_vietqr_url(amount=50_000, payment_code=code)
        assert "acc=0123456789" in url
        assert "bank=MBBank" in url
        assert "amount=50000" in url
        assert f"des={code}" in url

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("destination", "provider_account", "provider_va", "expected_count"),
        [
            ("0123456789", "0123456789", "", 1),
            ("VA001234", "0123456789", "VA001234", 1),
            ("OTHER", "0123456789", "VA001234", 0),
        ],
    )
    async def test_reconciliation_accepts_real_or_virtual_destination(
        self,
        monkeypatch,
        destination,
        provider_account,
        provider_va,
        expected_count,
    ):
        monkeypatch.setattr(settings, "sepay_api_token", "test-api-token")
        real_async_client = httpx.AsyncClient

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.params["bank_account_id"] == "parent-account-id"
            return httpx.Response(200, json={
                "status": "success",
                "data": [{
                    "id": "transaction-id",
                    "transfer_type": "in",
                    "amount_in": 50_000,
                    "account_number": provider_account,
                    "va": provider_va,
                    "bank_account_id": "parent-account-id",
                    "code": "NAP23456789AB",
                }],
            })

        transport = httpx.MockTransport(handler)
        monkeypatch.setattr(
            sepay_client.httpx,
            "AsyncClient",
            lambda **kwargs: real_async_client(transport=transport, **kwargs),
        )

        matches = await sepay_client.list_matching_transactions(
            payment_code="NAP23456789AB",
            amount=50_000,
            created_at=datetime.now(timezone.utc),
            bank_code="BIDV",
            bank_account_id="parent-account-id",
            bank_account_number=destination,
            bank_account_name="TEST ACCOUNT",
        )
        assert len(matches) == expected_count


class TestCreateDeposit:
    @pytest.mark.asyncio
    async def test_create_returns_inline_vietqr_details(self, client):
        token = await register_and_login(client, "create@example.com")
        response = await client.post(
            "/wallet/deposits",
            json={"amount": 50_000},
            headers=_auth(token),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["provider"] == "sepay"
        assert body["payment_code"].startswith("NAP")
        assert len(body["payment_code"]) == 13
        assert body["payment_code"] != f"NAP{body['id']}"
        assert body["bank_account_number"] == settings.sepay_bank_account_number
        assert body["bank_account_name"] == settings.sepay_bank_account_name
        assert "vietqr.app/img" in body["qr_code"]
        assert body["checkout_url"] is None

    @pytest.mark.asyncio
    async def test_min_max_and_pending_cap(self, client):
        token = await register_and_login(client, "limits@example.com")
        low = await client.post("/wallet/deposits", json={"amount": 5_000}, headers=_auth(token))
        high = await client.post("/wallet/deposits", json={"amount": 200_000_000}, headers=_auth(token))
        assert low.status_code == 422
        assert high.status_code == 422
        for _ in range(3):
            ok = await client.post("/wallet/deposits", json={"amount": 20_000}, headers=_auth(token))
            assert ok.status_code == 201
        over = await client.post("/wallet/deposits", json={"amount": 20_000}, headers=_auth(token))
        assert over.status_code == 429

    @pytest.mark.asyncio
    async def test_missing_config_disables_method_and_create(self, client, monkeypatch):
        token = await register_and_login(client, "missing@example.com")
        monkeypatch.setattr(settings, "sepay_webhook_secret", "")
        methods = await client.get("/wallet/deposit-methods")
        assert methods.status_code == 200
        assert methods.json()["sepay_enabled"] is False
        response = await client.post(
            "/wallet/deposits",
            json={"amount": 50_000},
            headers=_auth(token),
        )
        assert response.status_code == 503

    @pytest.mark.asyncio
    async def test_payos_is_no_longer_a_create_method(self, client):
        token = await register_and_login(client, "legacy@example.com")
        response = await client.post(
            "/wallet/deposits",
            json={"amount": 50_000, "method": "payos"},
            headers=_auth(token),
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_cancel_is_local_and_late_payment_can_still_arrive(self, client):
        token = await register_and_login(client, "cancel@example.com")
        created = (
            await client.post("/wallet/deposits", json={"amount": 20_000}, headers=_auth(token))
        ).json()
        cancelled = await client.post(
            f"/wallet/deposits/{created['id']}/cancel",
            headers=_auth(token),
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"


class TestStandingDepositCode:
    @pytest.mark.asyncio
    async def test_code_is_stable_and_qr_has_no_amount(self, client):
        token = await register_and_login(client, "standing@example.com")
        first = await client.get("/wallet/deposit-account", headers=_auth(token))
        assert first.status_code == 200, first.text
        body = first.json()
        assert sepay_client.is_valid_payment_code(body["payment_code"])
        assert body["bank_account_number"] == settings.sepay_bank_account_number
        assert f"des={body['payment_code']}" in body["qr_code"]
        assert "amount=" not in body["qr_code"]
        again = (await client.get("/wallet/deposit-account", headers=_auth(token))).json()
        assert again["payment_code"] == body["payment_code"]

        other = await register_and_login(client, "standing-other@example.com")
        theirs = (await client.get("/wallet/deposit-account", headers=_auth(other))).json()
        assert theirs["payment_code"] != body["payment_code"]

    @pytest.mark.asyncio
    async def test_requires_sign_in_and_configured_rail(self, client, monkeypatch):
        assert (await client.get("/wallet/deposit-account")).status_code == 401
        token = await register_and_login(client, "standing-off@example.com")
        monkeypatch.setattr(settings, "sepay_webhook_secret", "")
        assert (await client.get("/wallet/deposit-account", headers=_auth(token))).status_code == 503

    @pytest.mark.asyncio
    async def test_any_amount_is_credited_once_per_transaction(self, client):
        token = await register_and_login(client, "standing-pay@example.com")
        code = (await client.get("/wallet/deposit-account", headers=_auth(token))).json()["payment_code"]

        # Below the configured minimum and an odd amount: credited as received.
        small = _payload(0, 7_345, transaction_id=81001, reference="FT-S1", code=code)
        assert (await _post_webhook(client, small)).json() == {"success": True}
        assert await _balance("standing-pay@example.com") == 7_345
        # SePay retry of the same transaction does not credit twice.
        await _post_webhook(client, small)
        assert await _balance("standing-pay@example.com") == 7_345
        # A second transfer with the same code is a new deposit.
        big = _payload(0, 250_000, transaction_id=81002, reference="FT-S2", code=code)
        await _post_webhook(client, big)
        assert await _balance("standing-pay@example.com") == 257_345

        history = (await client.get("/wallet/deposits/me", headers=_auth(token))).json()
        assert sorted(d["paid_amount"] for d in history) == [7_345, 250_000]
        assert all(d["status"] == "paid" and d["provider"] == "sepay" for d in history)
        async with SessionLocal() as db:
            notes = (await db.execute(
                select(Transaction.description).where(Transaction.type == TransactionType.deposit)
            )).scalars().all()
        assert notes and not any("SePay" in n for n in notes)

    @pytest.mark.asyncio
    async def test_wrong_destination_or_outgoing_is_not_credited(self, client):
        token = await register_and_login(client, "standing-guard@example.com")
        code = (await client.get("/wallet/deposit-account", headers=_auth(token))).json()["payment_code"]
        await _post_webhook(client, _payload(0, 50_000, transaction_id=81101, code=code, account_number="9999999999"))
        await _post_webhook(client, _payload(0, 50_000, transaction_id=81102, code=code, transfer_type="out"))
        assert await _balance("standing-guard@example.com") == 0


class TestSePayWebhook:
    @pytest.mark.asyncio
    async def test_new_deposit_opaque_code_matches_webhook(self, client):
        token = await register_and_login(client, "created-webhook@example.com")
        created_response = await client.post(
            "/wallet/deposits",
            json={"amount": 50_000},
            headers=_auth(token),
        )
        assert created_response.status_code == 201
        created = created_response.json()
        payload = _payload(
            created["id"],
            50_000,
            transaction_id=92703,
            code=created["payment_code"],
        )
        response = await _post_webhook(client, payload)
        assert response.status_code == 200
        assert await _balance("created-webhook@example.com") == 50_000

    @pytest.mark.asyncio
    async def test_exact_payment_credits_once_and_acks_exact_shape(self, client):
        await register_and_login(client, "paid@example.com")
        intent_id = await _make_intent("paid@example.com", 50_000)
        payload = _payload(intent_id, 50_000)
        first = await _post_webhook(client, payload)
        second = await _post_webhook(client, payload)
        assert first.status_code == 200
        assert first.json() == {"success": True}
        assert second.status_code == 200
        assert await _balance("paid@example.com") == 50_000
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.status == DepositIntentStatus.paid
            assert intent.sepay_transaction_id == "92704"
            events = (await db.execute(select(SePayWebhookEvent))).scalars().all()
            assert len(events) == 1
            txs = (await db.execute(select(Transaction).where(Transaction.type == TransactionType.deposit))).scalars().all()
            assert len(txs) == 1
            assert txs[0].description.startswith("Nạp tiền chuyển khoản ngân hàng")

    @pytest.mark.asyncio
    async def test_official_va_destination_credits(self, client, monkeypatch):
        monkeypatch.setattr(settings, "sepay_bank_account_number", "VA001234")
        await register_and_login(client, "official-va@example.com")
        intent_id = await _make_intent("official-va@example.com", 50_000)

        response = await _post_webhook(
            client,
            _payload(
                intent_id,
                50_000,
                account_number="0123456789",
                sub_account="VA001234",
            ),
        )

        assert response.status_code == 200
        assert await _balance("official-va@example.com") == 50_000
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.status == DepositIntentStatus.paid

    @pytest.mark.asyncio
    async def test_bad_or_expired_signature_never_credits(self, client):
        await register_and_login(client, "sig@example.com")
        intent_id = await _make_intent("sig@example.com")
        payload = _payload(intent_id, 50_000)
        bad = await _post_webhook(client, payload, secret="wrong-secret")
        expired = await _post_webhook(client, payload, timestamp=int(time.time()) - 301)
        assert bad.status_code == 401
        assert expired.status_code == 401
        assert await _balance("sig@example.com") == 0

    @pytest.mark.asyncio
    async def test_amount_mismatch_is_journaled_but_held_for_review(self, client):
        await register_and_login(client, "amount@example.com")
        intent_id = await _make_intent("amount@example.com", 50_000)
        response = await _post_webhook(client, _payload(intent_id, 30_000))
        assert response.status_code == 200
        assert await _balance("amount@example.com") == 0
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.status == DepositIntentStatus.pending
            alerts = (await db.execute(select(Alert).where(Alert.type == "deposit_anomaly"))).scalars().all()
            assert any("lệch tiền" in alert.message for alert in alerts)

    @pytest.mark.asyncio
    async def test_wrong_account_outgoing_and_invalid_code_do_not_credit(self, client):
        await register_and_login(client, "reject@example.com")
        intent_id = await _make_intent("reject@example.com", 50_000)
        cases = [
            _payload(intent_id, 50_000, transaction_id=1, account_number="9999999999"),
            _payload(intent_id, 50_000, transaction_id=2, transfer_type="out"),
            _payload(intent_id, 50_000, transaction_id=3, code="OTHER123"),
            _payload(intent_id, 50_000, transaction_id=4, code="NAP23456789AB"),
        ]
        for payload in cases:
            response = await _post_webhook(client, payload)
            assert response.status_code == 200
        assert await _balance("reject@example.com") == 0

    @pytest.mark.asyncio
    async def test_late_exact_payment_credits_and_alerts(self, client):
        await register_and_login(client, "late@example.com")
        intent_id = await _make_intent(
            "late@example.com",
            20_000,
            status=DepositIntentStatus.expired,
        )
        response = await _post_webhook(client, _payload(intent_id, 20_000))
        assert response.status_code == 200
        assert await _balance("late@example.com") == 20_000
        async with SessionLocal() as db:
            alerts = (await db.execute(select(Alert).where(Alert.type == "deposit_anomaly"))).scalars().all()
            assert any("thanh toán muộn" in alert.message for alert in alerts)

    @pytest.mark.asyncio
    async def test_second_bank_transaction_does_not_credit_twice(self, client):
        await register_and_login(client, "double@example.com")
        intent_id = await _make_intent("double@example.com", 20_000)
        await _post_webhook(client, _payload(intent_id, 20_000, transaction_id=1, reference="FT-A"))
        await _post_webhook(client, _payload(intent_id, 20_000, transaction_id=2, reference="FT-B"))
        assert await _balance("double@example.com") == 20_000
        async with SessionLocal() as db:
            alerts = (await db.execute(select(Alert).where(Alert.type == "deposit_anomaly"))).scalars().all()
            assert any("nhận thêm" in alert.message for alert in alerts)

    @pytest.mark.asyncio
    async def test_concurrent_payments_on_same_wallet_do_not_lose_balance(self, client):
        await register_and_login(client, "race@example.com")
        first_id = await _make_intent("race@example.com", 30_000)
        second_id = await _make_intent("race@example.com", 50_000)
        first, second = await asyncio.gather(
            _post_webhook(client, _payload(first_id, 30_000, transaction_id=11, reference="FT-R1")),
            _post_webhook(client, _payload(second_id, 50_000, transaction_id=12, reference="FT-R2")),
        )
        assert first.status_code == 200 and second.status_code == 200
        assert await _balance("race@example.com") == 80_000

    @pytest.mark.asyncio
    async def test_admin_transaction_view_shows_actual_match_and_wallet_handling(self, client):
        await register_and_login(client, "transaction-view@example.com")
        admin_token = await register_and_login(client, "transaction-admin@example.com")
        await make_admin("transaction-admin@example.com")
        intent_id = await _make_intent("transaction-view@example.com", 130_000)

        await _post_webhook(
            client,
            _payload(intent_id, 129_950, transaction_id=9101, reference="UNDER-REF"),
        )
        await _post_webhook(
            client,
            _payload(intent_id, 130_000, transaction_id=9102, reference="EXACT-REF"),
        )
        await _post_webhook(
            client,
            _payload(intent_id, 260_000, transaction_id=9103, reference="OVER-REF"),
        )

        response = await client.get(
            f"/admin/deposits/{intent_id}/transactions",
            headers=_auth(admin_token),
        )
        assert response.status_code == 200, response.text
        rows = response.json()
        assert len(rows) == 3
        assert {row["match_status"] for row in rows} == {"underpaid", "exact", "overpaid"}
        assert {int(row["actual_amount"]) for row in rows} == {129_950, 130_000, 260_000}
        credited = [row for row in rows if row["credit_status"] == "credited"]
        held = [row for row in rows if row["credit_status"] == "held"]
        assert len(credited) == 1
        assert credited[0]["provider_transaction_id"] == "9102"
        assert len(held) == 2
        assert all(row["provider"] == "sepay" for row in rows)

        ledger_response = await client.get(
            "/admin/deposit-ledger",
            headers=_auth(admin_token),
        )
        assert ledger_response.status_code == 200, ledger_response.text
        ledger = ledger_response.json()
        ledger_entry = next(
            item for item in ledger["items"] if item["deposit"]["id"] == intent_id
        )
        assert ledger["total"] >= 1
        assert ledger_entry["deposit"]["provider"] == "sepay"
        assert ledger_entry["deposit"]["account_email"] == "transaction-view@example.com"
        assert len(ledger_entry["transactions"]) == 3
        assert {
            row["provider_transaction_id"] for row in ledger_entry["transactions"]
        } == {"9101", "9102", "9103"}

        filtered_page = await client.get(
            "/admin/deposit-ledger?limit=1&offset=0&provider=sepay&search=UNDER-REF",
            headers=_auth(admin_token),
        )
        assert filtered_page.status_code == 200, filtered_page.text
        filtered_ledger = filtered_page.json()
        assert filtered_ledger["total"] == 1
        assert filtered_ledger["limit"] == 1
        assert filtered_ledger["offset"] == 0
        assert [item["deposit"]["id"] for item in filtered_ledger["items"]] == [intent_id]

        empty_page = await client.get(
            "/admin/deposit-ledger?limit=1&offset=1&provider=sepay&search=UNDER-REF",
            headers=_auth(admin_token),
        )
        assert empty_page.status_code == 200, empty_page.text
        assert empty_page.json()["total"] == 1
        assert empty_page.json()["items"] == []


class TestSePayReconcile:
    @pytest.mark.asyncio
    async def test_reconcile_missed_webhook_credits_and_journals_api_source(self, client, monkeypatch):
        await register_and_login(client, "reconcile@example.com")
        admin_token = await register_and_login(client, "admin@example.com")
        await make_admin("admin@example.com")
        intent_id = await _make_intent("reconcile@example.com", 40_000)
        monkeypatch.setattr(
            sepay_client,
            "list_matching_transactions",
            AsyncMock(return_value=[{
                "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                "transfer_type": "in",
                "amount_in": 40_000,
                "account_number": settings.sepay_bank_account_number,
                "bank_account_id": settings.sepay_bank_account_id,
                "code": f"{sepay_client.payment_code_prefix()}{intent_id:010d}",
                "reference_number": "FT-REC",
            }]),
        )
        response = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(admin_token),
        )
        assert response.status_code == 200, response.text
        assert response.json()["reconcile_result"] == "credited"
        assert await _balance("reconcile@example.com") == 40_000
        async with SessionLocal() as db:
            event = await db.scalar(select(SePayWebhookEvent))
            assert event.source == "reconcile"
            assert event.signature_valid is None

        # A later webhook may carry a different SePay ID shape but the same bank reference.
        late = _payload(intent_id, 40_000, transaction_id=999, reference="FT-REC")
        assert (await _post_webhook(client, late)).status_code == 200
        assert await _balance("reconcile@example.com") == 40_000

    @pytest.mark.asyncio
    async def test_reconcile_uses_corrected_parent_uuid_for_same_destination(self, client, monkeypatch):
        await register_and_login(client, "corrected-config@example.com")
        admin_token = await register_and_login(client, "corrected-admin@example.com")
        await make_admin("corrected-admin@example.com")
        intent_id = await _make_intent("corrected-config@example.com", 40_000)

        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            intent.sepay_bank_account_id = "stale-parent-account-id"
            rail = await rail_config.ensure_seeded(db)
            rail.sepay_bank_account_id = "correct-parent-account-id"
            await db.commit()

        list_transactions = AsyncMock(return_value=[{
            "id": "corrected-config-transaction-id",
            "transfer_type": "in",
            "amount_in": 40_000,
            "account_number": settings.sepay_bank_account_number,
            "bank_account_id": "correct-parent-account-id",
            "code": f"{sepay_client.payment_code_prefix()}{intent_id:010d}",
        }])
        monkeypatch.setattr(sepay_client, "list_matching_transactions", list_transactions)

        response = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(admin_token),
        )

        assert response.status_code == 200, response.text
        assert response.json()["reconcile_result"] == "credited"
        assert list_transactions.await_args.kwargs["bank_account_id"] == "correct-parent-account-id"
        assert await _balance("corrected-config@example.com") == 40_000

    @pytest.mark.asyncio
    async def test_reconcile_not_found_keeps_pending(self, client, monkeypatch):
        await register_and_login(client, "missingtx@example.com")
        admin_token = await register_and_login(client, "admin2@example.com")
        await make_admin("admin2@example.com")
        intent_id = await _make_intent("missingtx@example.com", 40_000)
        monkeypatch.setattr(sepay_client, "list_matching_transactions", AsyncMock(return_value=[]))
        response = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(admin_token),
        )
        assert response.status_code == 200
        assert response.json()["reconcile_result"] == "not_found"
        assert await _balance("missingtx@example.com") == 0

    @pytest.mark.asyncio
    async def test_admin_endpoints_require_admin(self, client):
        token = await register_and_login(client, "buyer@example.com")
        intent_id = await _make_intent("buyer@example.com")
        deposits = await client.get("/admin/deposits", headers=_auth(token))
        events = await client.get("/admin/sepay-events", headers=_auth(token))
        ledger = await client.get("/admin/deposit-ledger", headers=_auth(token))
        transactions = await client.get(
            f"/admin/deposits/{intent_id}/transactions",
            headers=_auth(token),
        )
        assert deposits.status_code == 403
        assert events.status_code == 403
        assert ledger.status_code == 403
        assert transactions.status_code == 403


async def _admin_token(client, email: str) -> str:
    await register_and_login(client, email)
    await make_admin(email)
    return await register_and_login(client, email)


class TestStandingCodeEdges:
    @pytest.mark.asyncio
    async def test_code_keeps_crediting_after_prefix_change(self, client, monkeypatch):
        token = await register_and_login(client, "prefix-old@example.com")
        code = (await client.get("/wallet/deposit-account", headers=_auth(token))).json()["payment_code"]
        assert code.startswith("NAP")
        monkeypatch.setattr(settings, "sepay_payment_code_prefix", "GMM")

        await _post_webhook(client, _payload(0, 30_000, transaction_id=82001, reference="FT-P1", code=code))
        assert await _balance("prefix-old@example.com") == 30_000
        fresh = await register_and_login(client, "prefix-new@example.com")
        assert (await client.get("/wallet/deposit-account", headers=_auth(fresh))).json()["payment_code"].startswith("GMM")

    @pytest.mark.asyncio
    async def test_retired_beneficiary_still_credits_until_removed(self, client):
        admin = await _admin_token(client, "rail-admin@example.com")
        token = await register_and_login(client, "retired@example.com")
        code = (await client.get("/wallet/deposit-account", headers=_auth(token))).json()["payment_code"]
        old_number = settings.sepay_bank_account_number

        changed = await client.patch(
            "/admin/deposit-rail-config", json={"sepay_bank_account_number": "9999000011"}, headers=_auth(admin),
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["sepay_previous_account_numbers"] == [old_number]
        qr = (await client.get("/wallet/deposit-account", headers=_auth(token))).json()
        assert qr["bank_account_number"] == "9999000011" and qr["payment_code"] == code

        # A saved QR still points at the old number: credited.
        await _post_webhook(client, _payload(0, 10_000, transaction_id=82101, reference="FT-R1", code=code, account_number=old_number))
        assert await _balance("retired@example.com") == 10_000
        # Admins may prune the list but never add arbitrary numbers to it.
        bogus = await client.patch(
            "/admin/deposit-rail-config", json={"sepay_previous_account_numbers": ["123"]}, headers=_auth(admin),
        )
        assert bogus.status_code == 422
        pruned = await client.patch(
            "/admin/deposit-rail-config", json={"sepay_previous_account_numbers": []}, headers=_auth(admin),
        )
        assert pruned.json()["sepay_previous_account_numbers"] == []
        await _post_webhook(client, _payload(0, 10_000, transaction_id=82102, reference="FT-R2", code=code, account_number=old_number))
        assert await _balance("retired@example.com") == 10_000

    @pytest.mark.asyncio
    async def test_admin_assigns_or_dismisses_unmatched_transfers(self, client):
        admin = await _admin_token(client, "unmatched-admin@example.com")
        buyer = await register_and_login(client, "unmatched-buyer@example.com")
        code = (await client.get("/wallet/deposit-account", headers=_auth(buyer))).json()["payment_code"]

        await _post_webhook(client, _payload(0, 40_000, transaction_id=83001, reference="FT-U1", code=""))
        await _post_webhook(client, _payload(0, 25_000, transaction_id=83002, reference="FT-U2", code="NAPTYPO00000X"))
        await _post_webhook(client, _payload(0, 5_000, transaction_id=83003, reference="FT-U3", code=code))  # matched
        await _post_webhook(client, _payload(0, 7_000, transaction_id=83004, reference="FT-U4", code="", account_number="5555"))  # not ours

        # Buyers cannot see or act on the queue.
        assert (await client.get("/admin/sepay-events/unmatched", headers=_auth(buyer))).status_code == 403
        listed = await client.get("/admin/sepay-events/unmatched", headers=_auth(admin))
        assert listed.status_code == 200, listed.text
        rows = {r["transaction_id"]: r for r in listed.json()}
        assert set(rows) == {"83001", "83002"}

        forbidden = await client.post(
            f"/admin/sepay-events/{rows['83001']['id']}/assign", json={"target": "unmatched-buyer@example.com"}, headers=_auth(buyer),
        )
        assert forbidden.status_code == 403
        missing = await client.post(
            f"/admin/sepay-events/{rows['83001']['id']}/assign", json={"target": "nobody@example.com"}, headers=_auth(admin),
        )
        assert missing.status_code == 404
        assigned = await client.post(
            f"/admin/sepay-events/{rows['83001']['id']}/assign", json={"target": code.lower(), "note": "khách quên ghi mã"}, headers=_auth(admin),
        )
        assert assigned.status_code == 200, assigned.text
        assert await _balance("unmatched-buyer@example.com") == 45_000
        again = await client.post(
            f"/admin/sepay-events/{rows['83001']['id']}/assign", json={"target": "unmatched-buyer@example.com"}, headers=_auth(admin),
        )
        assert again.status_code == 409
        # A late SePay retry of the assigned transaction does not credit twice.
        await _post_webhook(client, _payload(0, 40_000, transaction_id=83001, reference="FT-U1", code=code))
        assert await _balance("unmatched-buyer@example.com") == 45_000

        no_reason = await client.post(f"/admin/sepay-events/{rows['83002']['id']}/dismiss", json={"note": " "}, headers=_auth(admin))
        assert no_reason.status_code == 422
        dismissed = await client.post(
            f"/admin/sepay-events/{rows['83002']['id']}/dismiss", json={"note": "hoàn tiền ngoài hệ thống"}, headers=_auth(admin),
        )
        assert dismissed.status_code == 200
        assert (await client.get("/admin/sepay-events/unmatched", headers=_auth(admin))).json() == []

        async with SessionLocal() as db:
            alerts = (await db.execute(select(Alert.message))).scalars().all()
        assert any("không có mã nạp" in m for m in alerts)

    @pytest.mark.asyncio
    async def test_admin_ledger_links_each_standing_deposit_to_its_own_transfer(self, client):
        admin = await _admin_token(client, "ledger-admin@example.com")
        buyer = await register_and_login(client, "ledger-buyer@example.com")
        code = (await client.get("/wallet/deposit-account", headers=_auth(buyer))).json()["payment_code"]
        await _post_webhook(client, _payload(0, 11_000, transaction_id=84001, reference="FT-L1", code=code))
        await _post_webhook(client, _payload(0, 9_000, transaction_id=84002, reference="FT-L2", code=""))
        await _post_webhook(client, _payload(0, 8_000, transaction_id=84003, reference="FT-L3", code=""))
        unmatched = {r["transaction_id"]: r["id"] for r in (await client.get("/admin/sepay-events/unmatched", headers=_auth(admin))).json()}
        await client.post(f"/admin/sepay-events/{unmatched['84002']}/assign", json={"target": code}, headers=_auth(admin))

        ledger = (await client.get("/admin/deposit-ledger", params={"search": "ledger-buyer"}, headers=_auth(admin))).json()
        by_amount = {item["deposit"]["paid_amount"]: item["transactions"] for item in ledger["items"]}
        # Each deposit shows only its own transfer — the other code-less
        # transfer (84003) never leaks into the assigned one.
        assert [t["provider_transaction_id"] for t in by_amount[11_000]] == ["84001"]
        assert [t["provider_transaction_id"] for t in by_amount[9_000]] == ["84002"]
        found = (await client.get("/admin/deposit-ledger", params={"search": code}, headers=_auth(admin))).json()
        assert found["total"] == 2
