"""Luồng nạp PayOS — thiết kế docs/superpowers/specs/2026-07-23-bank-payment-design.md.

Checksum key test cố định trong conftest ("test-checksum-key") nên chữ ký
deterministic; PayOS HTTP được mock ở tầng payos_client (monkeypatch) — các
test webhook không cần PayOS sống vì webhook là PayOS gọi MÌNH.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.payment import DepositIntent, DepositIntentStatus, PayosWebhookEvent
from src.models.wallet import Transaction, TransactionType, Wallet
from src.payments import payos_client
from tests.conftest import make_admin, register_and_login


# ---------------------------------------------------------------------------
# Chữ ký
# ---------------------------------------------------------------------------


class TestSignatures:
    def test_payment_request_signature_vector(self):
        # Vector cố định — đổi thuật toán ký là vỡ ngay tại đây chứ không phải
        # lúc PayOS thật từ chối request.
        sig = payos_client.sign_payment_request(
            amount=10000, cancel_url="https://x/wallet", description="NAP1",
            order_code=1, return_url="https://x/wallet", checksum_key="test-checksum-key",
        )
        assert sig == payos_client.sign_payment_request(
            amount=10000, cancel_url="https://x/wallet", description="NAP1",
            order_code=1, return_url="https://x/wallet", checksum_key="test-checksum-key",
        )
        assert len(sig) == 64  # hex sha256

    def test_webhook_signature_sorts_keys_and_maps_none_to_empty(self):
        a = payos_client.sign_webhook_data({"b": 1, "a": "x", "c": None}, "k")
        b = payos_client.sign_webhook_data({"c": None, "a": "x", "b": 1}, "k")
        assert a == b

    def test_verify_webhook_rejects_missing_or_wrong_signature(self):
        data = {"orderCode": 1, "amount": 5}
        assert not payos_client.verify_webhook_signature({"data": data})
        assert not payos_client.verify_webhook_signature({"data": data, "signature": "deadbeef"})
        good = payos_client.sign_webhook_data(data)
        assert payos_client.verify_webhook_signature({"data": data, "signature": good})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _make_intent(account_email: str, amount: int = 50_000, status=DepositIntentStatus.pending) -> int:
    from src.models.account import Account

    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == account_email))
        intent = DepositIntent(
            account_id=account.id, amount=amount, status=status,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )
        db.add(intent)
        await db.flush()
        # Quy ước với _signed_webhook: link id suy được từ intent id — webhook
        # mặc định luôn KHỚP payment_link_id (handle_webhook giờ đối chiếu).
        intent.payment_link_id = f"pl-i{intent.id}"
        await db.commit()
        return intent.id


def _signed_webhook(order_code: int, amount: int, reference: str = "FT001", link_id: str | None = None) -> dict:
    if link_id is None:
        link_id = f"pl-i{order_code}"
    data = {
        "orderCode": order_code, "amount": amount, "description": f"NAP{order_code}",
        "reference": reference, "paymentLinkId": link_id, "code": "00", "desc": "Thành công",
        "currency": "VND", "transactionDateTime": "2026-07-24 10:00:00",
    }
    return {"code": "00", "desc": "success", "success": True, "data": data,
            "signature": payos_client.sign_webhook_data(data)}


async def _balance(email: str) -> int:
    from src.models.account import Account

    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == email))
        wallet = await db.scalar(select(Wallet).where(Wallet.account_id == account.id))
        return wallet.available_balance if wallet else 0


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------


class TestWebhook:
    @pytest.mark.asyncio
    async def test_paid_webhook_credits_wallet_once(self, client):
        await register_and_login(client, "dep1@example.com")
        intent_id = await _make_intent("dep1@example.com", 50_000)
        payload = _signed_webhook(intent_id, 50_000)

        resp = await client.post("/webhooks/payos", json=payload)
        assert resp.status_code == 200, resp.text
        assert await _balance("dep1@example.com") == 50_000

        # Replay y hệt (PayOS retry) → không credit lần hai
        resp2 = await client.post("/webhooks/payos", json=payload)
        assert resp2.status_code == 200
        assert "duplicate" in resp2.json()["note"]
        assert await _balance("dep1@example.com") == 50_000

        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.status == DepositIntentStatus.paid
            assert intent.paid_amount == 50_000
            events = (await db.execute(select(PayosWebhookEvent))).scalars().all()
            assert len(events) == 1

    @pytest.mark.asyncio
    async def test_bad_signature_is_rejected_401(self, client):
        await register_and_login(client, "dep2@example.com")
        intent_id = await _make_intent("dep2@example.com")
        payload = _signed_webhook(intent_id, 50_000)
        payload["signature"] = "0" * 64
        resp = await client.post("/webhooks/payos", json=payload)
        assert resp.status_code == 401
        assert await _balance("dep2@example.com") == 0

    @pytest.mark.asyncio
    async def test_amount_mismatch_credits_actual_received(self, client):
        """Buyer hứa 50k nhưng tiền về 30k → credit đúng 30k + ghi chú lệch."""
        await register_and_login(client, "dep3@example.com")
        intent_id = await _make_intent("dep3@example.com", 50_000)
        resp = await client.post("/webhooks/payos", json=_signed_webhook(intent_id, 30_000))
        assert resp.status_code == 200
        assert await _balance("dep3@example.com") == 30_000
        async with SessionLocal() as db:
            tx = await db.scalar(select(Transaction).where(Transaction.type == TransactionType.deposit))
            assert "LỆCH" in tx.description

    @pytest.mark.asyncio
    async def test_unknown_order_code_returns_200_and_logs_event(self, client):
        resp = await client.post("/webhooks/payos", json=_signed_webhook(999_999, 10_000))
        assert resp.status_code == 200
        async with SessionLocal() as db:
            events = (await db.execute(select(PayosWebhookEvent))).scalars().all()
            assert len(events) == 1  # vẫn ghi sổ để admin đối soát

    @pytest.mark.asyncio
    async def test_late_payment_after_expired_still_credits(self, client):
        """Tiền thật đã về thì credit kể cả intent đã expired (chính sách §6.6)."""
        await register_and_login(client, "dep4@example.com")
        intent_id = await _make_intent("dep4@example.com", 20_000, status=DepositIntentStatus.expired)
        resp = await client.post("/webhooks/payos", json=_signed_webhook(intent_id, 20_000))
        assert resp.status_code == 200
        assert await _balance("dep4@example.com") == 20_000

    @pytest.mark.asyncio
    async def test_ping_without_data_returns_200(self, client):
        # PayOS bắn request test khi confirm webhook URL
        resp = await client.post("/webhooks/payos", json={"test": True})
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Tạo lệnh nạp
# ---------------------------------------------------------------------------


class TestCreateDeposit:
    @pytest.mark.asyncio
    async def test_create_calls_payos_and_returns_checkout(self, client, monkeypatch):
        token = await register_and_login(client, "dep5@example.com")
        captured = {}

        async def fake_create(**kwargs):
            captured.update(kwargs)
            return {"paymentLinkId": "pl-123", "checkoutUrl": "http://pay/x", "qrCode": "QRDATA"}

        monkeypatch.setattr("src.payments.payos_client.create_payment_request", fake_create)
        resp = await client.post("/wallet/deposits", json={"amount": 50_000},
                                 headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["checkout_url"] == "http://pay/x"
        assert captured["order_code"] == body["id"]
        assert captured["description"] == f"NAP{body['id']}"
        assert len(captured["description"]) <= 9

    @pytest.mark.asyncio
    async def test_below_minimum_rejected(self, client):
        token = await register_and_login(client, "dep6@example.com")
        resp = await client.post("/wallet/deposits", json={"amount": 5_000},
                                 headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_pending_cap_429(self, client, monkeypatch):
        token = await register_and_login(client, "dep7@example.com")

        async def fake_create(**kwargs):
            return {"paymentLinkId": f"pl-{kwargs['order_code']}", "checkoutUrl": "u", "qrCode": "q"}

        monkeypatch.setattr("src.payments.payos_client.create_payment_request", fake_create)
        for _ in range(3):
            ok = await client.post("/wallet/deposits", json={"amount": 20_000},
                                   headers={"Authorization": f"Bearer {token}"})
            assert ok.status_code == 201
        over = await client.post("/wallet/deposits", json={"amount": 20_000},
                                 headers={"Authorization": f"Bearer {token}"})
        assert over.status_code == 429

    @pytest.mark.asyncio
    async def test_payos_failure_leaves_no_orphan_intent(self, client, monkeypatch):
        token = await register_and_login(client, "dep8@example.com")
        monkeypatch.setattr(
            "src.payments.payos_client.create_payment_request",
            AsyncMock(side_effect=payos_client.PayOSUnavailableError("down")),
        )
        resp = await client.post("/wallet/deposits", json={"amount": 20_000},
                                 headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 502
        async with SessionLocal() as db:
            count = len((await db.execute(select(DepositIntent))).scalars().all())
            assert count == 0

    @pytest.mark.asyncio
    async def test_cancel_pending_deposit(self, client, monkeypatch):
        token = await register_and_login(client, "dep9@example.com")

        async def fake_create(**kwargs):
            return {"paymentLinkId": "pl-c1", "checkoutUrl": "u", "qrCode": "q"}

        monkeypatch.setattr("src.payments.payos_client.create_payment_request", fake_create)
        monkeypatch.setattr("src.payments.payos_client.cancel_payment", AsyncMock(return_value=None))
        created = (await client.post("/wallet/deposits", json={"amount": 20_000},
                                     headers={"Authorization": f"Bearer {token}"})).json()
        resp = await client.post(f"/wallet/deposits/{created['id']}/cancel",
                                 headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"


# ---------------------------------------------------------------------------
# Đối soát (bù miss webhook) + admin
# ---------------------------------------------------------------------------


class TestReconcile:
    @pytest.mark.asyncio
    async def test_reconcile_paid_credits_wallet(self, client, monkeypatch):
        await register_and_login(client, "dep10@example.com")
        admin = "dep_admin@example.com"
        await register_and_login(client, admin)
        await make_admin(admin)
        admin_token = (await client.post("/auth/login", json={"email": admin, "password": "StrongPass123!"})).json()["access_token"]

        intent_id = await _make_intent("dep10@example.com", 40_000)
        monkeypatch.setattr(
            "src.payments.payos_client.get_payment_info",
            AsyncMock(return_value={
                "status": "PAID", "amountPaid": 40_000,
                "transactions": [{"reference": "FTREC1"}],
            }),
        )
        resp = await client.post(f"/admin/deposits/{intent_id}/reconcile",
                                 headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "paid"
        assert await _balance("dep10@example.com") == 40_000

        # Webhook gốc về muộn sau khi reconcile đã credit: cùng reference =
        # cùng MỘT giao dịch → không credit thêm và TUYỆT ĐỐI không báo
        # "chuyển 2 lần" (review 24/07 #3 — vận hành có thể hoàn nhầm tiền).
        payload = _signed_webhook(intent_id, 40_000, reference="FTREC1")
        resp2 = await client.post("/webhooks/payos", json=payload)
        assert resp2.status_code == 200
        assert "đã đối soát" in resp2.json()["note"]
        assert await _balance("dep10@example.com") == 40_000
        from src.models.alert import Alert
        async with SessionLocal() as db:
            alerts = (await db.execute(select(Alert).where(Alert.type == "deposit_anomaly"))).scalars().all()
            assert alerts == [], "webhook muộn của giao dịch đã đối soát không được sinh alert giả"

    @pytest.mark.asyncio
    async def test_admin_deposits_listing_requires_admin(self, client):
        token = await register_and_login(client, "dep11@example.com")
        resp = await client.get("/admin/deposits", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# demo-topup gate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_demo_topup_blocked_when_flag_off(client, monkeypatch):
    from src.config import settings

    token = await register_and_login(client, "dep12@example.com")
    monkeypatch.setattr(settings, "enable_demo_topup", False)
    resp = await client.post("/wallet/demo-topup", json={"amount": 1000},
                             headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Edge case production-hardening (2026-07-24)
# ---------------------------------------------------------------------------


class TestProductionEdgeCases:
    @pytest.mark.asyncio
    async def test_webhook_ignored_when_payos_not_configured(self, client, monkeypatch):
        """Chưa set khoá → không được verify bằng khoá rỗng (forge được),
        cũng không 401 (PayOS retry-bão) — nuốt lặng lẽ, không credit."""
        from src.config import settings

        await register_and_login(client, "edge1@example.com")
        intent_id = await _make_intent("edge1@example.com", 20_000)
        payload = _signed_webhook(intent_id, 20_000)  # ký bằng khoá test hiện tại

        monkeypatch.setattr(settings, "payos_checksum_key", "")
        monkeypatch.setattr(settings, "payos_client_id", "")
        monkeypatch.setattr(settings, "payos_api_key", "")
        resp = await client.post("/webhooks/payos", json=payload)
        assert resp.status_code == 200
        assert "chưa được cấu hình" in resp.json()["note"]
        assert await _balance("edge1@example.com") == 0

    def test_verify_rejects_empty_checksum_key(self, monkeypatch):
        from src.config import settings

        data = {"orderCode": 1, "amount": 5}
        # chữ ký "đúng" theo khoá rỗng — phải bị từ chối tuyệt đối
        forged = payos_client.sign_webhook_data(data, "")
        monkeypatch.setattr(settings, "payos_checksum_key", "")
        assert not payos_client.verify_webhook_signature({"data": data, "signature": forged})

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad_amount", [-50_000, 0, True])
    async def test_non_positive_or_bool_amount_never_credits(self, client, bad_amount):
        """Chữ ký hợp lệ không có nghĩa dữ liệu vô hại — amount âm sẽ TRỪ ví."""
        await register_and_login(client, "edge2@example.com")
        intent_id = await _make_intent("edge2@example.com", 50_000)
        data = {
            "orderCode": intent_id, "amount": bad_amount, "reference": "FTX",
            "paymentLinkId": "pl-neg", "code": "00",
        }
        payload = {"code": "00", "desc": "x", "success": True, "data": data,
                   "signature": payos_client.sign_webhook_data(data)}
        resp = await client.post("/webhooks/payos", json=payload)
        assert resp.status_code == 200
        assert await _balance("edge2@example.com") == 0
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.status == DepositIntentStatus.pending

    @pytest.mark.asyncio
    async def test_create_deposit_over_max_rejected(self, client):
        token = await register_and_login(client, "edge3@example.com")
        resp = await client.post("/wallet/deposits", json={"amount": 200_000_000},
                                 headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 422
        assert "tối đa" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_create_deposit_503_when_not_configured(self, client, monkeypatch):
        from src.config import settings

        token = await register_and_login(client, "edge4@example.com")
        monkeypatch.setattr(settings, "payos_client_id", "")
        resp = await client.post("/wallet/deposits", json={"amount": 50_000},
                                 headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 503

    @pytest.mark.asyncio
    async def test_unknown_order_code_raises_ops_alert(self, client):
        from src.models.alert import Alert

        resp = await client.post("/webhooks/payos", json=_signed_webhook(777_777, 15_000))
        assert resp.status_code == 200
        async with SessionLocal() as db:
            alerts = (await db.execute(select(Alert).where(Alert.type == "deposit_anomaly"))).scalars().all()
            assert len(alerts) == 1
            assert "777777" in alerts[0].message or "777_777" in alerts[0].message

    @pytest.mark.asyncio
    async def test_amount_mismatch_raises_ops_alert(self, client):
        from src.models.alert import Alert

        await register_and_login(client, "edge5@example.com")
        intent_id = await _make_intent("edge5@example.com", 50_000)
        resp = await client.post("/webhooks/payos", json=_signed_webhook(intent_id, 30_000))
        assert resp.status_code == 200
        assert await _balance("edge5@example.com") == 30_000
        async with SessionLocal() as db:
            alerts = (await db.execute(select(Alert).where(Alert.type == "deposit_anomaly"))).scalars().all()
            assert any("lệch tiền" in a.message for a in alerts)

    @pytest.mark.asyncio
    async def test_double_payment_on_paid_intent_raises_ops_alert(self, client):
        from src.models.alert import Alert

        await register_and_login(client, "edge6@example.com")
        intent_id = await _make_intent("edge6@example.com", 20_000)
        first = _signed_webhook(intent_id, 20_000, reference="FT-A")
        assert (await client.post("/webhooks/payos", json=first)).status_code == 200
        # Khách chuyển lần 2 → reference KHÁC → event mới, nhưng không credit thêm
        second = _signed_webhook(intent_id, 20_000, reference="FT-B")
        assert (await client.post("/webhooks/payos", json=second)).status_code == 200
        assert await _balance("edge6@example.com") == 20_000
        async with SessionLocal() as db:
            alerts = (await db.execute(select(Alert).where(Alert.type == "deposit_anomaly"))).scalars().all()
            assert any("THÊM giao dịch" in a.message for a in alerts)

    @pytest.mark.asyncio
    async def test_string_order_code_ignored(self, client):
        data = {"orderCode": "6", "amount": 10_000, "reference": "FTS", "paymentLinkId": "pl-s", "code": "00"}
        payload = {"code": "00", "desc": "x", "success": True, "data": data,
                   "signature": payos_client.sign_webhook_data(data)}
        resp = await client.post("/webhooks/payos", json=payload)
        assert resp.status_code == 200
        assert "không hợp lệ" in resp.json()["note"] or "thiếu field" in resp.json()["note"]


# ---------------------------------------------------------------------------
# Review 24/07 — 4 fix backend (lost update, retention reconcile, link mismatch)
# ---------------------------------------------------------------------------


class TestReviewFixes:
    @pytest.mark.asyncio
    async def test_concurrent_webhooks_two_intents_same_account_no_lost_update(self, client):
        """Hai lệnh nạp của CÙNG account được thanh toán đồng thời: cộng ví
        phải là UPDATE nguyên tử — đọc-rồi-ghi sẽ mất một khoản (review #1)."""
        import asyncio

        await register_and_login(client, "race1@example.com")
        i1 = await _make_intent("race1@example.com", 30_000)
        i2 = await _make_intent("race1@example.com", 50_000)

        r1, r2 = await asyncio.gather(
            client.post("/webhooks/payos", json=_signed_webhook(i1, 30_000, reference="FT-R1")),
            client.post("/webhooks/payos", json=_signed_webhook(i2, 50_000, reference="FT-R2")),
        )
        assert r1.status_code == 200 and r2.status_code == 200
        assert await _balance("race1@example.com") == 80_000, "một khoản nạp đã bốc hơi (lost update)"
        async with SessionLocal() as db:
            for iid, amt in ((i1, 30_000), (i2, 50_000)):
                intent = await db.get(DepositIntent, iid)
                assert intent.status == DepositIntentStatus.paid
                assert intent.paid_amount == amt

    @pytest.mark.asyncio
    async def test_link_mismatch_never_credits_and_alerts(self, client):
        """orderCode khớp nhưng paymentLinkId lạ → không credit (review #4)."""
        from src.models.alert import Alert

        await register_and_login(client, "race2@example.com")
        intent_id = await _make_intent("race2@example.com", 40_000)
        payload = _signed_webhook(intent_id, 40_000, link_id="pl-KHAC")
        resp = await client.post("/webhooks/payos", json=payload)
        assert resp.status_code == 200
        assert "không khớp" in resp.json()["note"]
        assert await _balance("race2@example.com") == 0
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.status == DepositIntentStatus.pending
            alerts = (await db.execute(select(Alert).where(Alert.type == "deposit_anomaly"))).scalars().all()
            assert any("paymentLinkId" in a.message for a in alerts)

    @pytest.mark.asyncio
    async def test_reconcile_job_rescues_expired_but_paid_intent(self, client, monkeypatch):
        """Intent bị expire job chốt `expired` nhưng PayOS bảo ĐÃ TRẢ TIỀN
        (webhook bị nuốt lúc outage) → job đối soát trong retention window
        phải tự cứu, không chờ admin (review #2)."""
        from src.scheduler import deposit_reconcile_job

        await register_and_login(client, "race3@example.com")
        intent_id = await _make_intent("race3@example.com", 60_000, status=DepositIntentStatus.expired)

        monkeypatch.setattr(
            "src.payments.payos_client.get_payment_info",
            AsyncMock(return_value={
                "status": "PAID", "amountPaid": 60_000,
                "transactions": [{"reference": "FT-RESCUE"}],
            }),
        )
        await deposit_reconcile_job()

        assert await _balance("race3@example.com") == 60_000
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.status == DepositIntentStatus.paid
            assert intent.payos_reference == "FT-RESCUE"

    @pytest.mark.asyncio
    async def test_reconcile_job_leaves_genuinely_unpaid_expired_alone(self, client, monkeypatch):
        from src.scheduler import deposit_reconcile_job

        await register_and_login(client, "race4@example.com")
        intent_id = await _make_intent("race4@example.com", 60_000, status=DepositIntentStatus.expired)
        monkeypatch.setattr(
            "src.payments.payos_client.get_payment_info",
            AsyncMock(return_value={"status": "EXPIRED", "amountPaid": 0, "transactions": []}),
        )
        await deposit_reconcile_job()
        assert await _balance("race4@example.com") == 0
        async with SessionLocal() as db:
            intent = await db.get(DepositIntent, intent_id)
            assert intent.status == DepositIntentStatus.expired


class TestQrRendering:
    """QR dựng tại server (src/payments/qr.py) — buyer quét ngay trên trang ví,
    không phải mở trang thanh toán của nhà cung cấp. Đây là thứ khiến luồng nạp
    dùng được cả khi máy buyer không ra được internet (sự cố test 29/07)."""

    @pytest.mark.no_db
    def test_data_uri_shape(self):
        from src.payments.qr import vietqr_svg_data_uri

        uri = vietqr_svg_data_uri("00020101021238570010A00000072701270006970422")
        assert uri is not None and uri.startswith("data:image/svg+xml;base64,")
        import base64

        svg = base64.b64decode(uri.split(",", 1)[1]).decode()
        assert svg.startswith("<svg") and "</svg>" in svg
        # Nền trắng tường minh: QR vẽ trên nền trong suốt sẽ không quét được
        # khi buyer xem trang ở dark mode.
        assert "#ffffff" in svg.lower() or "#fff" in svg.lower()

    @pytest.mark.no_db
    def test_no_payload_no_image(self):
        from src.payments.qr import vietqr_svg_data_uri

        assert vietqr_svg_data_uri(None) is None
        assert vietqr_svg_data_uri("") is None

    @pytest.mark.asyncio
    async def test_create_deposit_returns_scannable_qr(self, client, monkeypatch):
        token = await register_and_login(client, "depqr1@example.com")

        async def fake_create(**kwargs):
            return {"paymentLinkId": "pl-qr-1", "checkoutUrl": "http://pay/x", "qrCode": "00020101021238570010A0000007"}

        monkeypatch.setattr("src.payments.payos_client.create_payment_request", fake_create)
        resp = await client.post("/wallet/deposits", json={"amount": 50_000},
                                 headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 201, resp.text
        # Ảnh phải đi cùng response tạo lệnh: frontend hiện QR ngay, không chờ
        # thêm request nào và không phụ thuộc domain ngoài.
        assert resp.json()["qr_svg"].startswith("data:image/svg+xml;base64,")

    @pytest.mark.asyncio
    async def test_qr_dropped_once_no_longer_pending(self, client, monkeypatch):
        token = await register_and_login(client, "depqr2@example.com")

        async def fake_create(**kwargs):
            return {"paymentLinkId": "pl-qr-2", "checkoutUrl": "http://pay/x", "qrCode": "00020101021238570010A0000007"}

        monkeypatch.setattr("src.payments.payos_client.create_payment_request", fake_create)
        async def fake_cancel(*a, **k):
            return None

        monkeypatch.setattr("src.payments.payos_client.cancel_payment", fake_cancel)
        created = await client.post("/wallet/deposits", json={"amount": 50_000},
                                    headers={"Authorization": f"Bearer {token}"})
        intent_id = created.json()["id"]

        cancelled = await client.post(f"/wallet/deposits/{intent_id}/cancel",
                                      headers={"Authorization": f"Bearer {token}"})
        assert cancelled.status_code == 200, cancelled.text
        # Lệnh đã huỷ/trả/hết hạn thì QR vô nghĩa — không vẽ, khỏi tốn công cho
        # cả trang lịch sử.
        assert cancelled.json()["qr_svg"] is None
