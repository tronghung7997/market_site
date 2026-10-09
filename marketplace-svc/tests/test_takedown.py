"""Link takedown: buyer requests mirrored to the partner ("Takedown Module").

The partner is faked in memory behind httpx.MockTransport; its admin side
(quote, confirm-payment, complete, fail, success) is driven by the tests and
reported through signed webhooks, exactly as the real module does.
"""

import json
import time

import httpx
import pytest
from sqlalchemy import select, update

from src.config import settings
from src.database import SessionLocal
from src.models.order import Order, OrderStatus
from src.models.takedown import TakedownEvent, TakedownRequest
from src.models.wallet import Wallet
from src.takedown import client as partner_client
from src.takedown import lifecycle
from src.takedown.service import sync_due_requests
from tests.conftest import make_admin, make_seller, register_and_login

BASE = "https://partner.test/api/v1"
SECRET = "whsec-test"
SELLER = "takedown-seller@test.example"
PNG = b"\x89PNG\r\n\x1a\nfake"


class FakePartner:
    """Just enough of the partner module: orders, member actions, evidence."""

    def __init__(self):
        self.orders: dict[int, dict] = {}
        self.events = 0
        self.fail_next_create = False
        self.evidence_ready = True
        self.calls: list[tuple[str, str]] = []

    def _ok(self, data, code=200):
        return httpx.Response(code, json={"status": "success", "message": "ok", "data": data, "meta": None, "errors": None})

    def _err(self, code, message):
        return httpx.Response(code, json={"status": "error", "message": message, "data": None, "meta": None, "errors": None})

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "img.test":
            # Screenshot host: never receives our key; ".svg" stands in for a non-raster file.
            assert "X-API-Key" not in request.headers
            if request.url.path.endswith(".svg"):
                return httpx.Response(200, content=b"<svg/>", headers={"content-type": "image/svg+xml"})
            return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
        assert request.headers.get("X-API-Key") == "tdk_test"
        path = request.url.path.removeprefix("/api/v1")
        self.calls.append((request.method, path))
        if request.method == "POST" and path == "/orders":
            body = json.loads(request.content)
            oid = len(self.orders) + 1
            self.orders[oid] = {
                "id": oid, "client": "gmmo@test", "service": body["service"], "platform": body["platform"],
                "target_url": body["target_url"], "reason": body.get("reason"), "warranty_hours": body["warranty_hours"],
                "price": None, "status": "pending_review", "warranty_until": None, "refunded_at": None,
                "completed_at": None, "created_at": "2026-10-09 10:00:00", "updated_at": "2026-10-09 10:00:00",
            }
            if self.fail_next_create:
                self.fail_next_create = False
                raise httpx.ConnectError("lost response")
            return self._ok(self.orders[oid], 201)
        if request.method == "GET" and path == "/orders":
            return self._ok(list(self.orders.values()))
        parts = path.strip("/").split("/")
        oid = int(parts[1])
        order = self.orders.get(oid)
        if order is None:
            return self._err(404, "Order not found")
        if request.method == "GET" and len(parts) == 2:
            return self._ok(order)
        if request.method == "GET" and parts[2] == "evidence":
            if order["status"] not in ("in_warranty", "warranty_pending", "success"):
                return self._err(409, "Evidence is available after the order is done")
            if not self.evidence_ready:
                return self._ok({"id": oid, "evidence_live_url": None, "evidence_dead_url": None})
            return self._ok({"id": oid, "evidence_live_url": "https://img.test/live.png", "evidence_dead_url": "https://img.test/dead.png"})
        action = parts[2]
        moves = {
            "accept": ({"quoted"}, "awaiting_payment"), "decline": ({"quoted"}, "quote_rejected"),
            "cancel": ({"pending_review", "quoted", "awaiting_payment"}, "cancelled"),
            "warranty": ({"in_warranty"}, "warranty_pending"),
        }
        allowed, target = moves[action]
        if order["status"] not in allowed:
            return self._err(409, f"Cannot {action} an order in status {order['status']}")
        order["status"] = target
        return self._ok(order)

    def admin(self, oid: int, status: str, **fields) -> dict:
        """Partner admin moves an order; returns the webhook payload it would send."""
        order = self.orders[oid]
        before = order["status"]
        order["status"] = status
        order.update(fields)
        self.events += 1
        return {
            "id": self.events, "type": "order.status_changed", "created_at": "2026-10-09 10:05:00",
            "data": {"order_id": oid, "client": "gmmo@test", "service": order["service"], "platform": order["platform"],
                     "target_url": order["target_url"], "action": fields.pop("action", status), "from_status": before,
                     "to_status": status, "actor_role": "admin", "note": None, "price": order["price"],
                     "warranty_until": order["warranty_until"]},
        }


@pytest.fixture
def partner(monkeypatch):
    fake = FakePartner()
    real = httpx.AsyncClient
    monkeypatch.setattr(partner_client.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(fake.handler), **kw))
    monkeypatch.setattr(settings, "takedown_api_base_url", BASE)
    monkeypatch.setattr(settings, "takedown_client_key", "tdk_test")
    monkeypatch.setattr(settings, "takedown_webhook_secret", SECRET)
    monkeypatch.setattr(settings, "takedown_seller_email", SELLER)
    monkeypatch.setattr(settings, "takedown_escrow_days", 0)
    return fake


async def _webhook(client, payload: dict, *, secret=SECRET, ts=None):
    raw = json.dumps(payload).encode()
    ts = str(int(time.time()) if ts is None else ts)
    sig = partner_client.sign_webhook(raw, ts, secret)
    return await client.post("/webhooks/takedown", content=raw,
                             headers={"Content-Type": "application/json", "X-Webhook-Timestamp": ts, "X-Webhook-Signature": sig})


async def _buyer(client, email="td-buyer@test.example", balance=1_000_000):
    token = await register_and_login(client, email)
    headers = {"Authorization": f"Bearer {token}"}
    buyer_id = (await client.get("/me", headers=headers)).json()["id"]
    async with SessionLocal() as db:
        await db.execute(update(Wallet).where(Wallet.account_id == buyer_id).values(available_balance=balance))
        await db.commit()
    return headers, buyer_id


async def _admin(client):
    await register_and_login(client, "td-admin@test.example")
    await make_admin("td-admin@test.example")
    token = await register_and_login(client, "td-admin@test.example")
    return {"Authorization": f"Bearer {token}"}


async def _seller(client):
    await register_and_login(client, SELLER)
    await make_seller(SELLER)


async def _balance(buyer_id: int) -> int:
    async with SessionLocal() as db:
        return await db.scalar(select(Wallet.available_balance).where(Wallet.account_id == buyer_id))


async def _create(client, headers, url="https://www.tiktok.com/@reup/video/123"):
    resp = await client.post("/takedown/requests", headers=headers, json={
        "url": url, "note": "Video của tôi", "service": "article_copyright", "warranty_hours": 24,
    })
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _quoted(client, partner, headers, admin_headers, *, cost=300_000, price=400_000):
    req = await _create(client, headers)
    assert (await _webhook(client, partner.admin(1, "quoted", price=cost, action="quote"))).status_code == 200
    resp = await client.post(f"/admin/takedown/requests/{req['code']}/price", headers=admin_headers, json={"price": price})
    assert resp.status_code == 200, resp.text
    return req["code"]


# ----------------------------------------------------------------- pure rules

@pytest.mark.no_db
def test_status_mapping_and_webhook_order():
    assert lifecycle.status_for("quoted", price_set=False, order_held=False) == "review"
    assert lifecycle.status_for("quoted", price_set=True, order_held=False) == "quoted"
    assert lifecycle.status_for("quoted", price_set=True, order_held=True) == "started"
    assert lifecycle.status_for("warranty_pending", price_set=True, order_held=True) == "warranty_claim"
    assert lifecycle.status_for("rejected", price_set=False, order_held=False) == "declined"
    assert lifecycle.webhook_applies(None, None)
    assert lifecycle.webhook_applies("quoted", "quoted")
    assert not lifecycle.webhook_applies("processing", "quoted")


@pytest.mark.no_db
def test_link_helpers():
    assert lifecycle.platform_for("https://vt.tiktok.com/ZS1/") == "tiktok"
    assert lifecycle.platform_for("m.facebook.com/x") == "facebook"
    assert lifecycle.platform_for("not a link") == "web"
    reason = lifecycle.reason_for("TD-ABCDEFGH", " note ")
    assert reason == "[TD-ABCDEFGH] note"
    assert lifecycle.code_in_reason(reason) == "TD-ABCDEFGH"
    assert lifecycle.code_in_reason("TD-ABCDEFGH") is None
    assert lifecycle.safe_http_url("javascript:alert(1)") is None


@pytest.mark.no_db
def test_partner_time_is_utc_plus_7(monkeypatch):
    parsed = partner_client.parse_time("2026-10-09 15:07:51")
    assert parsed.isoformat() == "2026-10-09T08:07:51+00:00"
    assert partner_client.parse_time(None) is None


@pytest.mark.no_db
def test_webhook_signature(monkeypatch):
    monkeypatch.setattr(settings, "takedown_webhook_secret", SECRET)
    raw = b'{"id":1}'
    now = time.time()
    sig = partner_client.sign_webhook(raw, int(now))
    assert partner_client.verify_webhook(raw, sig, str(int(now)), now=now)
    assert not partner_client.verify_webhook(raw + b" ", sig, str(int(now)), now=now)
    assert not partner_client.verify_webhook(raw, sig, str(int(now)), now=now + 3600)
    assert not partner_client.verify_webhook(raw, partner_client.sign_webhook(raw, int(now), "other"), str(int(now)), now=now)


# ----------------------------------------------------------------- flows

@pytest.mark.asyncio
async def test_create_sends_partner_order_with_our_code(client, partner):
    headers, _ = await _buyer(client)
    req = await _create(client, headers)
    assert req["status"] == "review" and req["code"].startswith("TD-")
    order = partner.orders[1]
    assert order["platform"] == "tiktok"
    assert order["reason"] == f"[{req['code']}] Video của tôi"
    listed = (await client.get("/takedown/requests", headers=headers)).json()
    assert [r["code"] for r in listed] == [req["code"]]


@pytest.mark.asyncio
async def test_create_refused_when_partner_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "takedown_api_base_url", "")
    headers, _ = await _buyer(client)
    resp = await client.post("/takedown/requests", headers=headers, json={
        "url": "https://x.test/a", "service": "group_copyright", "warranty_hours": 72,
    })
    assert resp.status_code == 503
    assert resp.json()["error_code"] == "TAKEDOWN_UNAVAILABLE"


@pytest.mark.asyncio
async def test_create_validates_service_and_warranty(client, partner):
    headers, _ = await _buyer(client)
    resp = await client.post("/takedown/requests", headers=headers, json={
        "url": "https://x.test/a", "service": "copyright", "warranty_hours": 168,
    })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_full_flow_done_delivers_order(client, partner):
    await _seller(client)
    admin_headers = await _admin(client)
    headers, buyer_id = await _buyer(client)
    req = await _create(client, headers)
    code = req["code"]

    # Partner quotes its cost: the buyer still sees "review" until we price it.
    await _webhook(client, partner.admin(1, "quoted", price=300_000, action="quote"))
    assert (await client.get(f"/takedown/requests/{code}", headers=headers)).json()["status"] == "review"
    detail = (await client.get(f"/admin/takedown/requests/{code}", headers=admin_headers)).json()
    assert detail["partner_price"] == 300_000 and detail["price"] is None

    await client.post(f"/admin/takedown/requests/{code}/price", headers=admin_headers, json={"price": 400_000})
    mine = (await client.get(f"/takedown/requests/{code}", headers=headers)).json()
    assert mine["status"] == "quoted" and mine["price"] == 400_000

    resp = await client.post(f"/takedown/requests/{code}/accept", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "started"
    assert partner.orders[1]["status"] == "awaiting_payment"
    assert await _balance(buyer_id) == 600_000

    await _webhook(client, partner.admin(1, "processing", action="confirm-payment"))
    assert (await client.get(f"/takedown/requests/{code}", headers=headers)).json()["status"] == "processing"
    await _webhook(client, partner.admin(1, "in_warranty", warranty_until="2026-10-10 10:00:00", action="complete"))
    mine = (await client.get(f"/takedown/requests/{code}", headers=headers)).json()
    assert mine["status"] == "warranty"
    assert mine["warranty_until"].startswith("2026-10-10T03:00:00")
    assert mine["evidence"] == ["live", "dead"] and "evidence_dead_url" not in mine
    shot = await client.get(f"/takedown/requests/{code}/evidence/dead", headers=headers)
    assert shot.status_code == 200 and shot.content == PNG
    assert shot.headers["content-type"] == "image/png" and shot.headers["x-content-type-options"] == "nosniff"
    assert (await client.get(f"/takedown/requests/{code}/evidence/other", headers=headers)).status_code == 404
    detail = (await client.get(f"/admin/takedown/requests/{code}", headers=admin_headers)).json()
    assert detail["evidence_dead_url"] == "https://img.test/dead.png"
    assert (await client.get(f"/admin/takedown/requests/{code}/evidence/live", headers=admin_headers)).content == PNG

    await _webhook(client, partner.admin(1, "success", action="auto_success"))
    mine = (await client.get(f"/takedown/requests/{code}", headers=headers)).json()
    assert mine["status"] == "done" and mine["refunded"] is False
    async with SessionLocal() as db:
        row = await db.scalar(select(TakedownRequest).where(TakedownRequest.code == code))
        order = await db.get(Order, row.order_id)
        assert order.status == OrderStatus.delivered and order.total_amount == 400_000
        assert order.escrow_expires_at is not None
    assert await _balance(buyer_id) == 600_000


@pytest.mark.asyncio
async def test_accept_needs_enough_balance(client, partner):
    await _seller(client)
    admin_headers = await _admin(client)
    headers, buyer_id = await _buyer(client, balance=1_000)
    code = await _quoted(client, partner, headers, admin_headers)
    resp = await client.post(f"/takedown/requests/{code}/accept", headers=headers)
    assert resp.status_code in (400, 402)
    assert (await client.get(f"/takedown/requests/{code}", headers=headers)).json()["status"] == "quoted"
    assert partner.orders[1]["status"] == "quoted"
    assert await _balance(buyer_id) == 1_000


@pytest.mark.asyncio
async def test_failed_refunds_once_even_if_webhook_repeats(client, partner):
    await _seller(client)
    admin_headers = await _admin(client)
    headers, buyer_id = await _buyer(client)
    code = await _quoted(client, partner, headers, admin_headers)
    await client.post(f"/takedown/requests/{code}/accept", headers=headers)
    await _webhook(client, partner.admin(1, "processing", action="confirm-payment"))
    fail = partner.admin(1, "failed", action="fail")
    assert (await _webhook(client, fail)).status_code == 200
    assert (await _webhook(client, fail)).json() == {"ok": True, "duplicate": True}
    await sync_due_requests()
    mine = (await client.get(f"/takedown/requests/{code}", headers=headers)).json()
    assert mine["status"] == "failed" and mine["refunded"] is True
    assert await _balance(buyer_id) == 1_000_000
    async with SessionLocal() as db:
        row = await db.scalar(select(TakedownRequest).where(TakedownRequest.code == code))
        order = await db.get(Order, row.order_id)
        assert order.status == OrderStatus.cancelled and order.refunded_amount == 400_000
    # The partner then returns its cost to GMMO: recorded for admin, the buyer is not paid twice.
    await _webhook(client, partner.admin(1, "failed", action="refund"))
    assert (await client.get(f"/admin/takedown/requests/{code}", headers=admin_headers)).json()["partner_refunded_at"]
    assert await _balance(buyer_id) == 1_000_000


@pytest.mark.asyncio
async def test_cancel_after_accept_refunds(client, partner):
    await _seller(client)
    admin_headers = await _admin(client)
    headers, buyer_id = await _buyer(client)
    code = await _quoted(client, partner, headers, admin_headers)
    await client.post(f"/takedown/requests/{code}/accept", headers=headers)
    resp = await client.post(f"/takedown/requests/{code}/cancel", headers=headers)
    assert resp.status_code == 200 and resp.json()["status"] == "cancelled"
    assert await _balance(buyer_id) == 1_000_000


@pytest.mark.asyncio
async def test_decline_costs_nothing(client, partner):
    await _seller(client)
    admin_headers = await _admin(client)
    headers, buyer_id = await _buyer(client)
    code = await _quoted(client, partner, headers, admin_headers)
    resp = await client.post(f"/takedown/requests/{code}/decline", headers=headers)
    assert resp.json()["status"] == "rejected"
    assert partner.orders[1]["status"] == "quote_rejected"
    assert await _balance(buyer_id) == 1_000_000


@pytest.mark.asyncio
async def test_warranty_claim_goes_to_partner(client, partner):
    await _seller(client)
    admin_headers = await _admin(client)
    headers, _ = await _buyer(client)
    code = await _quoted(client, partner, headers, admin_headers)
    await client.post(f"/takedown/requests/{code}/accept", headers=headers)
    await _webhook(client, partner.admin(1, "processing", action="confirm-payment"))
    await _webhook(client, partner.admin(1, "in_warranty", warranty_until="2099-01-01 00:00:00", action="complete"))
    resp = await client.post(f"/takedown/requests/{code}/warranty", headers=headers, json={"note": "Sống lại rồi"})
    assert resp.status_code == 200 and resp.json()["status"] == "warranty_claim"
    assert partner.orders[1]["status"] == "warranty_pending"
    missing_note = await client.post(f"/takedown/requests/{code}/warranty", headers=headers, json={"note": ""})
    assert missing_note.status_code == 422


@pytest.mark.asyncio
async def test_webhook_rejects_bad_signature_and_stale_time(client, partner):
    headers, _ = await _buyer(client)
    await _create(client, headers)
    payload = partner.admin(1, "quoted", price=1, action="quote")
    assert (await _webhook(client, payload, secret="wrong")).status_code == 401
    assert (await _webhook(client, payload, ts=int(time.time()) - 3600)).status_code == 401


@pytest.mark.asyncio
async def test_out_of_order_webhook_is_resynced_not_applied(client, partner):
    headers, _ = await _buyer(client)
    req = await _create(client, headers)
    partner.orders[1]["status"] = "quoted"
    partner.orders[1]["price"] = 250_000
    # A later step arrives first: from_status does not match what we hold.
    stray = {"id": 99, "type": "order.status_changed", "created_at": "2026-10-09 10:05:00",
             "data": {"order_id": 1, "action": "accept", "from_status": "quoted", "to_status": "awaiting_payment",
                      "price": 250_000, "warranty_until": None}}
    assert (await _webhook(client, stray)).json()["applied"] is False
    async with SessionLocal() as db:
        row = await db.scalar(select(TakedownRequest).where(TakedownRequest.code == req["code"]))
        event = await db.scalar(select(TakedownEvent).where(TakedownEvent.partner_event_id == 99))
        # The follow-up read mirrored the partner's real state instead.
        assert row.partner_status == "quoted" and row.partner_price == 250_000
        assert event.applied is False


@pytest.mark.asyncio
async def test_late_create_webhook_is_already_applied(client, partner):
    headers, _ = await _buyer(client)
    req = await _create(client, headers)
    late = {"id": 98, "type": "order.status_changed", "created_at": "2026-10-09 10:00:00",
            "data": {"order_id": 1, "action": "create", "from_status": None, "to_status": "pending_review",
                     "price": None, "warranty_until": None}}
    assert (await _webhook(client, late)).json()["applied"] is True
    async with SessionLocal() as db:
        row = await db.scalar(select(TakedownRequest).where(TakedownRequest.code == req["code"]))
        assert row.partner_status == "pending_review" and row.needs_sync is False


@pytest.mark.asyncio
async def test_lost_create_response_is_recovered_without_duplicate(client, partner):
    headers, _ = await _buyer(client)
    partner.fail_next_create = True
    req = await _create(client, headers)
    async with SessionLocal() as db:
        row = await db.scalar(select(TakedownRequest).where(TakedownRequest.code == req["code"]))
        assert row.partner_order_id is None and row.needs_sync
    await sync_due_requests()
    async with SessionLocal() as db:
        row = await db.scalar(select(TakedownRequest).where(TakedownRequest.code == req["code"]))
        assert row.partner_order_id == 1
    assert len(partner.orders) == 1


@pytest.mark.asyncio
async def test_access_control(client, partner):
    await _seller(client)
    owner_headers, _ = await _buyer(client)
    other_headers, _ = await _buyer(client, "td-other@test.example")
    req = await _create(client, owner_headers)
    assert (await client.get(f"/takedown/requests/{req['code']}", headers=other_headers)).status_code == 404
    assert (await client.post(f"/takedown/requests/{req['code']}/cancel", headers=other_headers)).status_code == 404
    assert (await client.get("/admin/takedown/requests", headers=owner_headers)).status_code == 403
    assert (await client.post(f"/admin/takedown/requests/{req['code']}/price", headers=owner_headers,
                              json={"price": 1})).status_code == 403
    assert (await client.get("/takedown/requests")).status_code == 401
    # Screenshots: only the owner, only once the link is down.
    await _webhook(client, partner.admin(1, "in_warranty", warranty_until="2026-10-10 10:00:00", action="complete"))
    evidence = f"/takedown/requests/{req['code']}/evidence/live"
    assert (await client.get(evidence, headers=owner_headers)).status_code == 200
    assert (await client.get(evidence, headers=other_headers)).status_code == 404
    assert (await client.get(f"/admin/takedown/requests/{req['code']}/evidence/live", headers=owner_headers)).status_code == 403


@pytest.mark.asyncio
async def test_evidence_set_after_complete_arrives_on_next_sync(client, partner):
    headers, _ = await _buyer(client)
    req = await _create(client, headers)
    partner.evidence_ready = False
    await _webhook(client, partner.admin(1, "in_warranty", warranty_until="2026-10-10 10:00:00", action="complete"))
    assert (await client.get(f"/takedown/requests/{req['code']}", headers=headers)).json()["evidence"] == []
    # The partner uploads screenshots later (no webhook); the very next sync run picks them up.
    partner.evidence_ready = True
    await sync_due_requests()
    assert (await client.get(f"/takedown/requests/{req['code']}", headers=headers)).json()["evidence"] == ["live", "dead"]


@pytest.mark.asyncio
async def test_evidence_that_is_not_a_raster_image_is_refused(client, partner):
    headers, _ = await _buyer(client)
    req = await _create(client, headers)
    await _webhook(client, partner.admin(1, "in_warranty", warranty_until="2026-10-10 10:00:00", action="complete"))
    async with SessionLocal() as db:
        await db.execute(update(TakedownRequest).where(TakedownRequest.code == req["code"])
                         .values(evidence_live_url="https://img.test/live.svg"))
        await db.commit()
    resp = await client.get(f"/takedown/requests/{req['code']}/evidence/live", headers=headers)
    assert resp.status_code == 502 and "svg" not in resp.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_admin_cannot_price_before_partner_quote(client, partner):
    admin_headers = await _admin(client)
    headers, _ = await _buyer(client)
    req = await _create(client, headers)
    resp = await client.post(f"/admin/takedown/requests/{req['code']}/price", headers=admin_headers, json={"price": 1000})
    assert resp.status_code == 409
    assert (await client.post(f"/admin/takedown/requests/{req['code']}/price", headers=admin_headers,
                              json={"price": 0})).status_code == 422
