"""Supplier/payment request+response bodies: encrypted in upstream_exchanges,
shipped whole on `upstream_call` — src/observability/exchanges.py.

Real sockets on 127.0.0.1 so calls go through the patched AsyncHTTPTransport.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from src.audit.service import purge_operational_logs
from src.config import settings
from src.database import SessionLocal
from src.models.log_entry import LogEntry
from src.models.upstream_exchange import UpstreamExchange
from src.observability import outbound
from src.observability.exchanges import exchange_scope
from src.security.crypto import decrypt_str
from tests.conftest import make_admin, register_and_login
from tests.test_structured_logging import json_logs  # noqa: F401 — fixture

DELIVERED = {"success": True, "data": {"proxies": [{"host": "1.2.3.4", "port": 20160, "username": "u_23", "password": "p@ss-w0rd"}]}}


async def _serve(body: bytes, *, status: bytes = b"200 OK", ctype: bytes = b"application/json"):
    async def handle(reader, writer):
        await reader.readuntil(b"\r\n\r\n")
        writer.write(b"HTTP/1.1 " + status + b"\r\ncontent-type: " + ctype
                     + b"\r\ncontent-length: " + str(len(body)).encode() + b"\r\nconnection: close\r\n\r\n" + body)
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1]


def _calls(lines):
    return [entry for entry in lines if entry["event"] == "upstream_call"]


@pytest.mark.asyncio
async def test_adapter_call_keeps_both_bodies_without_our_credentials(json_logs):  # noqa: F811
    outbound.install()
    server, port = await _serve(json.dumps(DELIVERED).encode())
    async with server, httpx.AsyncClient() as client:
        with outbound.integration("dproxy"), exchange_scope(provider_id=13, order_id=346, operation="purchase_assignment"):
            resp = await client.post(
                f"http://127.0.0.1:{port}/api/v1/customer/marketplace/partner-purchase?key=OUR-KEY&channel=gmmo",
                json={"partner_order_id": "prod-346", "plan_id": "e9e7", "api_key": "OUR-KEY"},
            )
    # The caller still reads the body the transport already consumed.
    assert resp.json() == DELIVERED

    [line] = _calls(json_logs())
    assert line["integration"] == "dproxy" and line["order_id"] == 346 and line["provider_id"] == 13
    assert line["operation"] == "purchase_assignment"
    assert json.loads(line["response_body"]) == DELIVERED  # third-party data kept as received
    assert json.loads(line["request_body"]) == {"partner_order_id": "prod-346", "plan_id": "e9e7"}
    assert line["request_query"] == "channel=gmmo"
    assert "OUR-KEY" not in json.dumps(line)

    async with SessionLocal() as db:
        row = await db.get(UpstreamExchange, line["exchange_id"])
    assert row.order_id == 346 and row.status_code == 200 and row.outcome == "ok"
    assert row.path == "/api/v1/customer/marketplace/partner-purchase"
    assert "p@ss-w0rd" not in row.response_body  # encrypted at rest
    assert json.loads(decrypt_str(row.response_body)) == DELIVERED
    assert decrypt_str(row.url_path) == "/api/v1/customer/marketplace/partner-purchase?channel=gmmo"
    assert "OUR-KEY" not in decrypt_str(row.request_body)


@pytest.mark.asyncio
async def test_rejected_purchase_keeps_the_suppliers_error_text(json_logs):  # noqa: F811
    outbound.install()
    error = {"detail": "Hạn mức tín dụng không đủ để thanh toán. Cần $15000.00, khả dụng $1000.00 USD."}
    server, port = await _serve(json.dumps(error, ensure_ascii=False).encode(), status=b"402 Payment Required")
    async with server, httpx.AsyncClient() as client:
        with outbound.integration("dproxy"):
            resp = await client.post(f"http://127.0.0.1:{port}/api/v1/customer/marketplace/partner-purchase", json={})
    assert resp.status_code == 402
    [line] = _calls(json_logs())
    assert line["level"] == "warning" and line["outcome"] == "client_error"
    assert json.loads(line["response_body"]) == error


@pytest.mark.asyncio
async def test_form_body_drops_our_api_key(json_logs):  # noqa: F811
    outbound.install()
    server, port = await _serve(b'{"ok":1}')
    async with server, httpx.AsyncClient() as client:
        with outbound.integration("igbm"):
            await client.post(f"http://127.0.0.1:{port}/api/buy", data={"product_id": "7", "api_key": "OUR-KEY"})
    [line] = _calls(json_logs())
    assert line["request_body"] == "product_id=7"


@pytest.mark.asyncio
async def test_other_integrations_log_metadata_only(json_logs):  # noqa: F811
    outbound.install()
    server, port = await _serve(b'{"reply":"what the user asked the AI"}')
    async with server, httpx.AsyncClient() as client:
        with outbound.integration("openrouter"):
            await client.post(f"http://127.0.0.1:{port}/v1/chat", json={"prompt": "private"})
    [line] = _calls(json_logs())
    assert "response_body" not in line and "request_body" not in line and "exchange_id" not in line
    async with SessionLocal() as db:
        assert (await db.execute(select(UpstreamExchange))).scalars().all() == []


@pytest.mark.asyncio
async def test_bodies_are_capped_and_binary_is_a_placeholder(json_logs, monkeypatch):  # noqa: F811
    outbound.install()
    monkeypatch.setattr(settings, "upstream_exchange_log_max_chars", 5000)
    monkeypatch.setattr(settings, "upstream_exchange_max_bytes", 6000)
    big = json.dumps({"rows": "x" * 9000}).encode()
    server, port = await _serve(big)
    async with server, httpx.AsyncClient() as client:
        with outbound.integration("payos"):
            await client.get(f"http://127.0.0.1:{port}/v2/payment-requests/1")
    [line] = _calls(json_logs())
    # Longer than the 2000-char log cap every other field gets, shorter than the body cap.
    assert len(line["response_body"]) == 5000 and line["response_body_truncated"] is True
    async with SessionLocal() as db:
        row = await db.get(UpstreamExchange, line["exchange_id"])
    assert row.truncated is True and row.response_bytes == len(big)
    assert len(decrypt_str(row.response_body)) == 6000

    server, port = await _serve(b"\x89PNG....", ctype=b"image/png")
    async with server, httpx.AsyncClient() as client:
        with outbound.integration("payos"):
            await client.get(f"http://127.0.0.1:{port}/qr.png")
    [line] = _calls(json_logs())
    assert line["response_body"] == "<image/png 8 bytes>"


@pytest.mark.asyncio
async def test_connection_failure_is_stored_with_the_error(json_logs):  # noqa: F811
    outbound.install()
    server, port = await _serve(b"")
    server.close()
    await server.wait_closed()
    async with httpx.AsyncClient() as client:
        with outbound.integration("sepay"), pytest.raises(httpx.ConnectError):
            await client.post(f"http://127.0.0.1:{port}/userapi/transactions", json={"q": 1})
    [line] = _calls(json_logs())
    assert line["outcome"] == "connect_error" and json.loads(line["request_body"]) == {"q": 1}
    async with SessionLocal() as db:
        row = await db.get(UpstreamExchange, line["exchange_id"])
    assert row.status_code is None and row.error and row.response_body is None


async def _exchange(**overrides) -> int:
    from src.security.crypto import encrypt_str

    async with SessionLocal() as db:
        row = UpstreamExchange(**{
            "integration": "dproxy", "method": "POST", "host": "api.dproxy.info", "path": "/api/v1/x",
            "status_code": 402, "outcome": "client_error", "duration_ms": 500, "order_id": 346, "provider_id": 13,
            "url_path": encrypt_str("/api/v1/x"), "request_body": encrypt_str('{"plan_id":"e9e7"}'),
            "response_body": encrypt_str('{"detail":"Cần $15000.00"}'), "request_bytes": 18, "response_bytes": 24,
            **overrides,
        })
        db.add(row)
        await db.commit()
        return row.id


@pytest.mark.asyncio
async def test_admin_lists_metadata_and_reveals_one_row_with_an_audit(client):
    exchange_id = await _exchange()
    await _exchange(order_id=999, outcome="ok", status_code=200)
    buyer = await register_and_login(client, "ux_buyer@example.com")
    assert (await client.get("/admin/upstream-exchanges", headers={"Authorization": f"Bearer {buyer}"})).status_code == 403
    assert (await client.get(f"/admin/upstream-exchanges/{exchange_id}",
                             headers={"Authorization": f"Bearer {buyer}"})).status_code == 403

    await register_and_login(client, "ux_admin@example.com")
    await make_admin("ux_admin@example.com")
    admin = {"Authorization": f"Bearer {await register_and_login(client, 'ux_admin@example.com')}"}

    rows = (await client.get("/admin/upstream-exchanges?order_id=346", headers=admin)).json()
    assert [r["id"] for r in rows] == [exchange_id]
    assert "response_body" not in rows[0]
    failed = (await client.get("/admin/upstream-exchanges?failed_only=true", headers=admin)).json()
    assert [r["id"] for r in failed] == [exchange_id]

    detail = (await client.get(f"/admin/upstream-exchanges/{exchange_id}", headers=admin)).json()
    assert detail["response_body"] == '{"detail":"Cần $15000.00"}' and detail["request_body"] == '{"plan_id":"e9e7"}'
    assert (await client.get("/admin/upstream-exchanges/987654", headers=admin)).status_code == 404
    async with SessionLocal() as db:
        audit = (await db.execute(select(LogEntry).where(LogEntry.message == f"Admin viewed upstream exchange #{exchange_id}"))).scalars().all()
    assert len(audit) == 1 and audit[0].metadata_["event"] == "upstream_exchange_viewed"


@pytest.mark.asyncio
async def test_purge_drops_exchanges_past_retention():
    old = datetime.now(timezone.utc) - timedelta(days=settings.upstream_exchange_retention_days + 1)
    await _exchange(created_at=old)
    keep = await _exchange()
    counts = await purge_operational_logs()
    assert counts["upstream_exchanges"] == 1
    async with SessionLocal() as db:
        assert (await db.scalars(select(UpstreamExchange.id))).all() == [keep]
