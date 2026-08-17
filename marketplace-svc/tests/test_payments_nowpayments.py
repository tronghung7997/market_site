"""NOWPayments USDT deposit — unit + integration.

Plan: docs/superpowers/plans/2026-08-11-nowpayments-usdt-deposit-plan.md
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from src.config import settings
from src.database import SessionLocal
from src.models.payment import DepositIntent, DepositIntentStatus, DepositProvider, NowpaymentsIpnEvent
from src.models.wallet import Wallet
from src.payments import fx, nowpayments_client
from tests.conftest import make_admin, register_and_login


# ---------------------------------------------------------------------------
# Unit: IPN / order_id / FX
# ---------------------------------------------------------------------------


class TestNowPaymentsUnit:
    def test_ipn_signature_vector_stable(self, monkeypatch):
        monkeypatch.setattr(settings, "nowpayments_ipn_secret", "test-ipn-secret")
        payload = {"payment_id": 1, "payment_status": "finished", "b": 2, "a": 1}
        sig1 = nowpayments_client.sign_ipn_payload(payload)
        # Key order must not matter
        payload2 = {"b": 2, "a": 1, "payment_status": "finished", "payment_id": 1}
        sig2 = nowpayments_client.sign_ipn_payload(payload2)
        assert sig1 == sig2
        assert len(sig1) == 128  # sha512 hex
        assert nowpayments_client.verify_ipn_signature(payload, sig1)

    def test_ipn_rejects_tampered_empty_wrong(self, monkeypatch):
        monkeypatch.setattr(settings, "nowpayments_ipn_secret", "test-ipn-secret")
        payload = {"payment_id": "9", "payment_status": "finished"}
        good = nowpayments_client.sign_ipn_payload(payload)
        assert not nowpayments_client.verify_ipn_signature(payload, "0" * 128)
        tampered = {**payload, "payment_status": "waiting"}
        assert not nowpayments_client.verify_ipn_signature(tampered, good)
        monkeypatch.setattr(settings, "nowpayments_ipn_secret", "")
        assert not nowpayments_client.verify_ipn_signature(payload, good)

    def test_order_id_parse(self):
        assert nowpayments_client.parse_order_id("DEP-123") == 123
        assert nowpayments_client.parse_order_id("DEP-0") == 0
        assert nowpayments_client.parse_order_id("123") is None
        assert nowpayments_client.parse_order_id("DEP-abc") is None
        assert nowpayments_client.parse_order_id(None) is None
        assert nowpayments_client.format_order_id(7) == "DEP-7"

    def test_vnd_to_usd_quote(self):
        q = fx.vnd_to_usd_quote(255_000, 25_500)
        assert q == Decimal("10.000000")
        q2 = fx.vnd_to_usd_quote(100_000, 25_500)
        assert q2 > 0

    def test_underpay(self):
        assert fx.underpay(Decimal("9.9"), Decimal("10"))
        assert not fx.underpay(Decimal("10"), Decimal("10"))
        assert not fx.underpay(Decimal("10.1"), Decimal("10"))

    @pytest.mark.asyncio
    async def test_list_payments_by_invoice_uses_short_lived_server_token(self, monkeypatch):
        _enable_now(monkeypatch)
        monkeypatch.setattr(nowpayments_client, "_payment_history_token", None)
        monkeypatch.setattr(nowpayments_client, "_payment_history_token_expires_at", 0.0)
        calls: list[tuple[str, str]] = []

        async def fake_request(method, path, *, json_body=None, params=None, headers=None):
            calls.append((method, path))
            if path == "auth":
                assert json_body == {"email": "now@example.com", "password": "test-now-password"}
                assert headers == {"Content-Type": "application/json"}
                return {"token": "short-lived-token"}
            assert params == {"invoiceid": "invoice-9001", "limit": "50"}
            assert headers and headers["Authorization"] == "Bearer short-lived-token"
            return {"data": [{"payment_id": "payment-1"}]}

        monkeypatch.setattr(nowpayments_client, "_request", fake_request)
        assert await nowpayments_client.list_payments_by_invoice("invoice-9001") == [{"payment_id": "payment-1"}]
        assert await nowpayments_client.list_payments_by_invoice("invoice-9001") == [{"payment_id": "payment-1"}]
        assert calls == [("POST", "auth"), ("GET", "payment/"), ("GET", "payment/")]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _enable_now(monkeypatch):
    """Secrets + env seeds. Admin flag set via DB seed after truncate."""
    monkeypatch.setattr(settings, "nowpayments_enabled", True)
    monkeypatch.setattr(settings, "nowpayments_api_key", "test-now-key")
    monkeypatch.setattr(settings, "nowpayments_ipn_secret", "test-now-ipn-secret")
    monkeypatch.setattr(settings, "nowpayments_auth_email", "now@example.com")
    monkeypatch.setattr(settings, "nowpayments_auth_password", "test-now-password")
    monkeypatch.setattr(settings, "nowpayments_outcome_currency", "usdtbsc")
    monkeypatch.setattr(settings, "deposit_usdt_min_vnd", 50_000)
    monkeypatch.setattr(settings, "deposit_usdt_max_vnd", 50_000_000)
    monkeypatch.setattr(settings, "display_fx_rate", 25_500)


async def _seed_rail_now_enabled():
    """Ensure deposit_rail_config has NOW flag on (seed from env after _enable_now)."""
    from src.payments import rail_config

    async with SessionLocal() as db:
        row = await rail_config.ensure_seeded(db)
        row.nowpayments_enabled = True
        row.payos_enabled = True
        await db.commit()


def _mock_now_http(monkeypatch, *, invoice_id: str = "invoice-9001"):
    async def fake_create_invoice(**kwargs):
        return {
            "id": invoice_id,
            "invoice_url": "https://nowpayments.example/invoice-9001",
            "price_amount": float(kwargs.get("price_amount") or 10),
            "price_currency": "usd",
            "order_id": kwargs.get("order_id"),
        }

    monkeypatch.setattr(nowpayments_client, "create_invoice", fake_create_invoice)


def _signed_ipn(payload: dict, monkeypatch=None) -> tuple[dict, str]:
    # secret must match settings when posting
    sig = nowpayments_client.sign_ipn_payload(payload)
    return payload, sig


async def _balance(email: str) -> int:
    from src.models.account import Account

    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == email))
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == account.id))
        return wallet.available_balance if wallet else 0


async def _make_now_intent(
    email: str,
    amount: int = 255_000,
    *,
    payment_id: str | None = "9001",
    pay_amount: str = "10",
    invoice_id: str | None = None,
    status=DepositIntentStatus.pending,
) -> int:
    from src.models.account import Account

    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == email))
        intent = DepositIntent(
            account_id=account.id,
            amount=amount,
            status=status,
            provider=DepositProvider.nowpayments.value,
            pay_currency="usdtbsc",
            now_invoice_id=invoice_id,
            now_payment_id=payment_id,
            pay_address="0xABC",
            pay_amount=Decimal(pay_amount),
            quoted_usd_amount=Decimal("10"),
            vnd_per_usd_snapshot=25_500,
            price_currency="usd",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=60),
        )
        db.add(intent)
        await db.commit()
        return intent.id


def _finished_payload(
    intent_id: int,
    *,
    payment_id: str = "9001",
    actually_paid: float = 10.0,
    pay_amount: float = 10.0,
    pay_currency: str = "usdtbsc",
    invoice_id: str | None = None,
) -> dict:
    payload = {
        "payment_id": payment_id,
        "payment_status": "finished",
        "pay_address": "0xABC",
        "price_amount": 10,
        "price_currency": "usd",
        "pay_amount": pay_amount,
        "actually_paid": actually_paid,
        "pay_currency": pay_currency,
        "order_id": f"DEP-{intent_id}",
        "outcome_amount": actually_paid * 0.995,
        "outcome_currency": pay_currency,
        "updated_at": "2026-08-12T00:00:00Z",
    }
    if invoice_id is not None:
        payload["invoice_id"] = invoice_id
    return payload


# ---------------------------------------------------------------------------
# Integration
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestNowPaymentsCreate:
    @pytest.mark.asyncio
    async def test_create_hosted_invoice_checkout(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await _seed_rail_now_enabled()
        _mock_now_http(monkeypatch)
        token = await register_and_login(client, "now1@example.com")
        resp = await client.post(
            "/wallet/deposits",
            json={"amount": 255_000, "method": "nowpayments"},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["provider"] == "nowpayments"
        assert body["status"] == "pending"
        assert body["now_invoice_id"] == "invoice-9001"
        assert body["checkout_url"] == "https://nowpayments.example/invoice-9001"
        assert body["now_payment_id"] is None
        assert body["pay_currency"] is None
        assert body["vnd_per_usd_snapshot"] == 25_500

    @pytest.mark.asyncio
    async def test_flag_off_503(self, client, monkeypatch):
        _enable_now(monkeypatch)
        # Secrets present but admin flag off
        from src.payments import rail_config
        async with SessionLocal() as db:
            row = await rail_config.ensure_seeded(db)
            row.nowpayments_enabled = False
            await db.commit()
        token = await register_and_login(client, "now2@example.com")
        resp = await client.post(
            "/wallet/deposits",
            json={"amount": 100_000, "method": "nowpayments"},
            headers=_auth(token),
        )
        assert resp.status_code == 503

    @pytest.mark.asyncio
    async def test_rejects_pinning_network_in_api(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await _seed_rail_now_enabled()
        _mock_now_http(monkeypatch)
        token = await register_and_login(client, "now3@example.com")
        resp = await client.post(
            "/wallet/deposits",
            json={"amount": 255_000, "method": "nowpayments", "pay_currency": "usdtbsc"},
            headers=_auth(token),
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_method_default_payos_compat(self, client, monkeypatch):
        """Omit method → payos (existing clients)."""
        token = await register_and_login(client, "now4@example.com")
        monkeypatch.setattr(
            "src.payments.payos_client.create_payment_request",
            AsyncMock(return_value={
                "paymentLinkId": "pl1",
                "checkoutUrl": "https://pay.example/x",
                "qrCode": "qr",
            }),
        )
        resp = await client.post("/wallet/deposits", json={"amount": 50_000}, headers=_auth(token))
        assert resp.status_code == 201, resp.text
        assert resp.json().get("provider", "payos") == "payos"
        assert resp.json()["checkout_url"]


class TestNowPaymentsIpn:
    @pytest.mark.asyncio
    async def test_hosted_invoice_binds_selected_usdt_network(self, client, monkeypatch):
        """Any USDT network chosen on NOW checkout can credit (no admin allowlist)."""
        _enable_now(monkeypatch)
        await _seed_rail_now_enabled()
        await register_and_login(client, "hostedipn@example.com")
        intent_id = await _make_now_intent(
            "hostedipn@example.com",
            payment_id=None,
            invoice_id="invoice-9001",
        )
        payload = _finished_payload(
            intent_id,
            payment_id="payment-from-checkout",
            pay_currency="usdttrc20",
            invoice_id="invoice-9001",
        )
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200, resp.text
        assert await _balance("hostedipn@example.com") == 255_000
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.now_payment_id == "payment-from-checkout"
            assert intent.pay_currency == "usdttrc20"

    @pytest.mark.asyncio
    async def test_hosted_invoice_rejects_wrong_invoice_or_non_usdt(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "hostedbad@example.com")
        intent_id = await _make_now_intent(
            "hostedbad@example.com",
            payment_id=None,
            invoice_id="invoice-9002",
        )
        payload = _finished_payload(
            intent_id,
            payment_id="payment-wrong-invoice",
            pay_currency="btc",
            invoice_id="invoice-other",
        )
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200
        assert await _balance("hostedbad@example.com") == 0

    @pytest.mark.asyncio
    async def test_hosted_invoice_underpay_no_credit(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await _seed_rail_now_enabled()
        await register_and_login(client, "hostedunderpay@example.com")
        intent_id = await _make_now_intent(
            "hostedunderpay@example.com",
            payment_id=None,
            invoice_id="invoice-underpay",
            pay_amount="0",
        )
        payload = _finished_payload(
            intent_id,
            payment_id="payment-underpay",
            actually_paid=9.9,
            pay_amount=10,
            invoice_id="invoice-underpay",
        )
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200
        assert await _balance("hostedunderpay@example.com") == 0

    @pytest.mark.asyncio
    async def test_waiting_no_credit(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "ipn1@example.com")
        intent_id = await _make_now_intent("ipn1@example.com")
        payload = _finished_payload(intent_id)
        payload["payment_status"] = "waiting"
        payload["actually_paid"] = 0
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200
        assert await _balance("ipn1@example.com") == 0

    @pytest.mark.asyncio
    async def test_finished_credits_target_vnd_once(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "ipn2@example.com")
        intent_id = await _make_now_intent("ipn2@example.com", 255_000)
        payload = _finished_payload(intent_id, actually_paid=10.0)
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200, resp.text
        assert await _balance("ipn2@example.com") == 255_000

        # Replay
        resp2 = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp2.status_code == 200
        assert await _balance("ipn2@example.com") == 255_000

        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.status == DepositIntentStatus.paid
            assert intent.paid_amount == 255_000
            assert intent.paid_crypto_amount == Decimal("10")
            events = (await db.execute(select(NowpaymentsIpnEvent))).scalars().all()
            assert len(events) == 1

    @pytest.mark.asyncio
    async def test_bad_signature_401(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "ipn3@example.com")
        intent_id = await _make_now_intent("ipn3@example.com")
        payload = _finished_payload(intent_id)
        resp = await client.post(
            "/webhooks/nowpayments",
            json=payload,
            headers={"x-nowpayments-sig": "0" * 128},
        )
        assert resp.status_code == 401
        assert await _balance("ipn3@example.com") == 0

    @pytest.mark.asyncio
    async def test_underpay_no_credit(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "ipn4@example.com")
        intent_id = await _make_now_intent("ipn4@example.com", pay_amount="10")
        payload = _finished_payload(intent_id, actually_paid=5.0, pay_amount=10.0)
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200
        assert await _balance("ipn4@example.com") == 0

    @pytest.mark.asyncio
    async def test_actually_paid_zero_no_credit(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "ipn5@example.com")
        intent_id = await _make_now_intent("ipn5@example.com")
        payload = _finished_payload(intent_id, actually_paid=0)
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200
        assert await _balance("ipn5@example.com") == 0

    @pytest.mark.asyncio
    async def test_unknown_order_200(self, client, monkeypatch):
        _enable_now(monkeypatch)
        payload = _finished_payload(999_999)
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_wrong_payment_id_no_credit(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "ipn6@example.com")
        intent_id = await _make_now_intent("ipn6@example.com", payment_id="9001")
        payload = _finished_payload(intent_id, payment_id="other")
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200
        assert await _balance("ipn6@example.com") == 0

    @pytest.mark.asyncio
    async def test_missing_pay_currency_no_credit(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "ipn9@example.com")
        intent_id = await _make_now_intent("ipn9@example.com")
        payload = _finished_payload(intent_id, actually_paid=10.0)
        del payload["pay_currency"]
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200
        assert await _balance("ipn9@example.com") == 0

    @pytest.mark.asyncio
    async def test_missing_order_id_no_credit(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "ipn10@example.com")
        intent_id = await _make_now_intent("ipn10@example.com")
        payload = _finished_payload(intent_id, actually_paid=10.0)
        del payload["order_id"]
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200
        assert await _balance("ipn10@example.com") == 0

    @pytest.mark.asyncio
    async def test_reconcile_missing_fields_no_credit(self, client, monkeypatch):
        _enable_now(monkeypatch)
        token = await register_and_login(client, "ipn11@example.com")
        await make_admin("ipn11@example.com")
        intent_id = await _make_now_intent("ipn11@example.com", 255_000, payment_id="9001")

        async def fake_get_missing(pid):
            p = _finished_payload(intent_id, payment_id=str(pid), actually_paid=10.0)
            del p["pay_currency"]
            del p["order_id"]
            return p

        monkeypatch.setattr(nowpayments_client, "get_payment", fake_get_missing)
        resp = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(token),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] != "paid"
        assert await _balance("ipn11@example.com") == 0

    @pytest.mark.asyncio
    async def test_reconcile_reports_provider_status_separately_from_local_status(self, client, monkeypatch):
        _enable_now(monkeypatch)
        token = await register_and_login(client, "reconcile-status@example.com")
        await make_admin("reconcile-status@example.com")
        intent_id = await _make_now_intent(
            "reconcile-status@example.com", 255_000, payment_id="payment-confirming",
        )

        async def fake_get(payment_id):
            assert payment_id == "payment-confirming"
            return {"payment_id": payment_id, "payment_status": "confirming"}

        monkeypatch.setattr(nowpayments_client, "get_payment", fake_get)
        resp = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(token),
        )

        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "id": intent_id,
            "status": "pending",
            "provider_status": "confirming",
            "reconcile_result": "checked",
        }

    @pytest.mark.asyncio
    async def test_reconcile_provider_error_is_written_to_admin_logs_without_secrets(self, client, monkeypatch):
        _enable_now(monkeypatch)
        token = await register_and_login(client, "reconcile-debug@example.com")
        await make_admin("reconcile-debug@example.com")
        intent_id = await _make_now_intent(
            "reconcile-debug@example.com", 255_000, payment_id="payment-debug",
        )

        async def fake_get(payment_id):
            assert payment_id == "payment-debug"
            raise nowpayments_client.NowPaymentsError(
                f"HTTP 401: rejected {settings.nowpayments_api_key} "
                f"{settings.nowpayments_auth_password}"
            )

        monkeypatch.setattr(nowpayments_client, "get_payment", fake_get)
        resp = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(token),
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["reconcile_result"] == "provider_error"

        logs_resp = await client.get(
            f"/admin/logs?order_id={intent_id}",
            headers=_auth(token),
        )
        assert logs_resp.status_code == 200, logs_resp.text
        debug_log = next(
            row for row in logs_resp.json()
            if row["metadata"].get("event") == "nowpayments_reconcile_debug"
        )
        assert "[DEBUG-NOW-RECONCILE]" in debug_log["message"]
        assert debug_log["metadata"]["branch"] == "direct_payment_fetch"
        assert debug_log["metadata"]["error_type"] == "NowPaymentsError"
        assert "HTTP 401" in debug_log["metadata"]["error"]
        assert "[REDACTED]" in debug_log["metadata"]["error"]
        serialized_log = str(debug_log)
        assert settings.nowpayments_api_key not in serialized_log
        assert settings.nowpayments_auth_password not in serialized_log

    @pytest.mark.asyncio
    async def test_reconcile_reports_missing_hosted_invoice_credentials(self, client, monkeypatch):
        _enable_now(monkeypatch)
        monkeypatch.setattr(settings, "nowpayments_auth_email", "")
        monkeypatch.setattr(settings, "nowpayments_auth_password", "")
        token = await register_and_login(client, "reconcile-config@example.com")
        await make_admin("reconcile-config@example.com")
        intent_id = await _make_now_intent(
            "reconcile-config@example.com",
            255_000,
            payment_id=None,
            invoice_id="invoice-missing-auth",
        )

        resp = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(token),
        )

        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "id": intent_id,
            "status": "pending",
            "provider_status": None,
            "reconcile_result": "not_configured",
        }

    @pytest.mark.asyncio
    async def test_reconcile_missed_ipn(self, client, monkeypatch):
        _enable_now(monkeypatch)
        token = await register_and_login(client, "ipn7@example.com")
        await make_admin("ipn7@example.com")
        intent_id = await _make_now_intent("ipn7@example.com", 255_000, payment_id="9001")

        async def fake_get(pid):
            return _finished_payload(intent_id, payment_id=str(pid), actually_paid=10.0)

        monkeypatch.setattr(nowpayments_client, "get_payment", fake_get)
        resp = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "paid"
        assert await _balance("ipn7@example.com") == 255_000

    @pytest.mark.asyncio
    async def test_reconcile_hosted_invoice_by_invoice_id(self, client, monkeypatch):
        """A missed hosted-checkout IPN is recovered without operator input."""
        _enable_now(monkeypatch)
        token = await register_and_login(client, "hosted-manual@example.com")
        await make_admin("hosted-manual@example.com")
        intent_id = await _make_now_intent(
            "hosted-manual@example.com",
            255_000,
            payment_id=None,
            invoice_id="invoice-9001",
        )

        async def fake_list(invoice_id):
            assert invoice_id == "invoice-9001"
            return [{"payment_id": "payment-from-invoice"}]

        async def fake_get(payment_id):
            assert payment_id == "payment-from-invoice"
            return _finished_payload(
                intent_id,
                payment_id=payment_id,
                pay_currency="usdtbsc",
                invoice_id="invoice-9001",
            )

        monkeypatch.setattr(nowpayments_client, "list_payments_by_invoice", fake_list)
        monkeypatch.setattr(nowpayments_client, "get_payment", fake_get)
        resp = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "paid"
        assert await _balance("hosted-manual@example.com") == 255_000
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.now_payment_id == "payment-from-invoice"

    @pytest.mark.asyncio
    async def test_reconcile_hosted_invoice_rejects_payment_from_another_invoice(self, client, monkeypatch):
        _enable_now(monkeypatch)
        token = await register_and_login(client, "hosted-manual-wrong@example.com")
        await make_admin("hosted-manual-wrong@example.com")
        intent_id = await _make_now_intent(
            "hosted-manual-wrong@example.com",
            255_000,
            payment_id=None,
            invoice_id="invoice-9001",
        )

        async def fake_list(invoice_id):
            assert invoice_id == "invoice-9001"
            return [{"payment_id": "payment-from-invoice"}]

        async def fake_get(payment_id):
            return _finished_payload(
                intent_id,
                payment_id=payment_id,
                pay_currency="usdtbsc",
                invoice_id="different-invoice",
            )

        monkeypatch.setattr(nowpayments_client, "list_payments_by_invoice", fake_list)
        monkeypatch.setattr(nowpayments_client, "get_payment", fake_get)
        resp = await client.post(
            f"/admin/deposits/{intent_id}/reconcile",
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "pending"
        assert await _balance("hosted-manual-wrong@example.com") == 0
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.now_payment_id is None

    @pytest.mark.asyncio
    async def test_late_finished_after_cancel_credits(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await register_and_login(client, "ipn8@example.com")
        intent_id = await _make_now_intent(
            "ipn8@example.com", 255_000, status=DepositIntentStatus.cancelled,
        )
        payload = _finished_payload(intent_id, actually_paid=10.0)
        sig = nowpayments_client.sign_ipn_payload(payload)
        resp = await client.post(
            "/webhooks/nowpayments", json=payload, headers={"x-nowpayments-sig": sig},
        )
        assert resp.status_code == 200
        assert await _balance("ipn8@example.com") == 255_000


class TestDepositMethods:
    @pytest.mark.asyncio
    async def test_methods_endpoint(self, client, monkeypatch):
        _enable_now(monkeypatch)
        await _seed_rail_now_enabled()
        resp = await client.get("/wallet/deposit-methods")
        assert resp.status_code == 200
        body = resp.json()
        assert body["nowpayments_enabled"] is True
        assert "nowpayments_allowed_pay_currencies" not in body
        assert "deposit_usdt_min_vnd" in body

    @pytest.mark.asyncio
    async def test_admin_rail_config_get_patch(self, client, monkeypatch):
        _enable_now(monkeypatch)
        token = await register_and_login(client, "railadmin@example.com")
        await make_admin("railadmin@example.com")
        r = await client.get("/admin/deposit-rail-config", headers=_auth(token))
        assert r.status_code == 200, r.text
        assert "nowpayments_enabled" in r.json()
        assert r.json()["nowpayments_secrets_configured"] is True

        r2 = await client.patch(
            "/admin/deposit-rail-config",
            headers=_auth(token),
            json={"nowpayments_enabled": True, "deposit_usdt_min_vnd": 60_000},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["nowpayments_enabled"] is True
        assert r2.json()["deposit_usdt_min_vnd"] == 60_000
        assert r2.json()["effective_nowpayments_enabled"] is True
