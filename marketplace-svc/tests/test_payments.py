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
            assert "SePay" in txs[0].description

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
