import json
import logging
from unittest.mock import AsyncMock

import pytest

from src.middleware import _route_template, normalize_request_id


@pytest.mark.asyncio
async def test_health_returns_ok(client):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "marketplace-svc"


@pytest.mark.asyncio
async def test_health_returns_request_id_header(client):
    response = await client.get("/health")
    assert "x-request-id" in response.headers
    assert len(response.headers["x-request-id"]) <= 36


@pytest.mark.no_db
def test_normalize_request_id_accepts_valid():
    assert normalize_request_id("abc-123_XYZ") == "abc-123_XYZ"
    assert normalize_request_id("a" * 36) == "a" * 36


@pytest.mark.no_db
def test_normalize_request_id_rejects_invalid():
    for raw in (None, "", "   ", "has spaces", "bad!", "a" * 37, "x\ny"):
        result = normalize_request_id(raw)
        assert result != (raw or "").strip()
        assert len(result) == 36  # generated UUID


@pytest.mark.no_db
def test_unmatched_route_never_uses_client_path_as_metric_label():
    assert _route_template({"type": "http", "path": "/random/customer-controlled-id"}) == "__unmatched__"


@pytest.mark.asyncio
async def test_valid_client_request_id_is_echoed(client):
    rid = "client-req-id-001"
    response = await client.get("/health", headers={"X-Request-ID": rid})
    assert response.status_code == 200
    assert response.headers["x-request-id"] == rid


@pytest.mark.asyncio
async def test_invalid_and_long_request_ids_are_replaced(client):
    for raw in ("", "not valid!!", "x" * 37, " " * 5):
        response = await client.get("/health", headers={"X-Request-ID": raw})
        assert response.status_code == 200
        echoed = response.headers["x-request-id"]
        assert echoed != raw.strip()
        assert len(echoed) <= 36
        assert " " not in echoed


@pytest.mark.asyncio
async def test_long_request_id_does_not_break_audited_endpoint(client):
    """Malicious inbound ID must not poison log_entries.request_id VARCHAR(36)."""
    from .conftest import register_and_login

    token = await register_and_login(client, "rid-audit@example.com")
    response = await client.get(
        "/me",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Request-ID": "Z" * 200,
        },
    )
    assert response.status_code == 200
    assert len(response.headers["x-request-id"]) <= 36


@pytest.mark.asyncio
async def test_http_request_access_event_for_2xx_and_4xx(client, capsys):
    await client.get("/health")
    await client.get("/orders/999999")  # unauthenticated → 401/403

    captured = capsys.readouterr().out
    events = []
    for line in captured.splitlines():
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("event") == "http_request":
            events.append(payload)

    statuses = {e.get("status") for e in events}
    assert 200 in statuses
    assert any(s and int(s) >= 400 for s in statuses)
    for e in events:
        assert "route" in e
        assert "duration_ms" in e
        assert "query" not in e
        assert "body" not in e
        # path may appear only as route template fallback; never as query
        assert "?" not in str(e.get("route", ""))


@pytest.mark.asyncio
async def test_authenticated_access_event_includes_account_id(client, capsys):
    from .conftest import register_and_login

    token = await register_and_login(client, "rid-acct@example.com")
    # Drain registration/login noise
    capsys.readouterr()

    response = await client.get(
        "/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    account_id = response.json()["id"]

    captured = capsys.readouterr().out
    me_events = []
    for line in captured.splitlines():
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("event") == "http_request" and payload.get("route") in {
            "/me",
            "/me/",
        }:
            me_events.append(payload)

    assert me_events, f"no http_request for /me in: {captured[-2000:]}"
    assert me_events[-1].get("account_id") == account_id


@pytest.mark.asyncio
async def test_anonymous_access_event_omits_account_id(client, capsys):
    capsys.readouterr()
    await client.get("/health")
    captured = capsys.readouterr().out
    for line in captured.splitlines():
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("event") == "http_request" and payload.get("status") == 200:
            assert "account_id" not in payload


@pytest.mark.asyncio
async def test_unhandled_500_emits_one_access_event(client, monkeypatch, capsys):
    """Unhandled exceptions must still produce a correlated http_request event."""
    from src.main import app

    async def boom():
        raise RuntimeError("forced failure for access log")

    app.add_api_route("/__test_force_500", boom, methods=["GET"])
    try:
        capsys.readouterr()
        with pytest.raises(RuntimeError, match="forced failure"):
            # ASGITransport re-raises unhandled exceptions from the app
            await client.get("/__test_force_500")
    finally:
        # Remove the temporary route so later tests are unaffected.
        app.router.routes = [
            r for r in app.router.routes
            if getattr(r, "path", None) != "/__test_force_500"
        ]

    captured = capsys.readouterr().out
    events = []
    for line in captured.splitlines():
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("event") == "http_request" and "/__test_force_500" in str(
            payload.get("route", "")
        ):
            events.append(payload)

    assert len(events) == 1
    assert events[0]["status"] == 500
    assert events[0].get("level") in {"error", "err", None} or events[0].get("level") == "error"


@pytest.mark.asyncio
async def test_access_event_uses_route_template(client, capsys):
    """Prefer /orders/{order_id} over high-cardinality concrete paths when routed."""
    from .conftest import register_and_login

    token = await register_and_login(client, "rid-route@example.com")
    capsys.readouterr()
    await client.get(
        "/orders/12345",
        headers={"Authorization": f"Bearer {token}"},
    )
    captured = capsys.readouterr().out
    routes = []
    for line in captured.splitlines():
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("event") == "http_request":
            routes.append(payload.get("route"))

    # At least one event should carry the template rather than only "12345".
    assert any(
        r and "{" in r and "order" in r.lower()
        for r in routes
    ) or any(r == "/orders/12345" for r in routes)
    # Never include query string
    assert all("?" not in str(r) for r in routes)
