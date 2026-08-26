from __future__ import annotations

import hashlib
import hmac
import time

import pytest
from httpx import ASGITransport, AsyncClient

from src.config import settings
from src.main import app


def _signed_headers(method: str, target: str, body: bytes, timestamp: int | None = None) -> dict[str, str]:
    ts = timestamp if timestamp is not None else int(time.time())
    canonical = b"\n".join((
        method.upper().encode("ascii"),
        target.encode("ascii"),
        str(ts).encode("ascii"),
        hashlib.sha256(body).hexdigest().encode("ascii"),
    ))
    signature = hmac.new(settings.bff_request_signing_secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
    return {
        "X-API-Key": settings.bff_request_signing_key_id,
        "X-Timestamp": str(ts),
        "X-Signature": f"v1={signature}",
        "Content-Type": "application/json",
    }


@pytest.mark.asyncio
async def test_site_api_rejects_unsigned_request():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/public/money-config")
    assert response.status_code == 401
    assert response.json() == {"detail": "Yêu cầu không hợp lệ"}


@pytest.mark.asyncio
async def test_site_api_rejects_signature_for_a_different_body():
    signed_body = b'{"email":"signed@example.com","password":"StrongPass123!"}'
    forwarded_body = b'{"email":"tampered@example.com","password":"StrongPass123!"}'
    headers = _signed_headers("POST", "/auth/register", signed_body)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/auth/register", content=forwarded_body, headers=headers)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_site_api_rejects_stale_signature():
    body = b'{"email":"stale@example.com","password":"StrongPass123!"}'
    headers = _signed_headers("POST", "/auth/register", body, timestamp=int(time.time()) - 301)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/auth/register", content=body, headers=headers)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_site_api_accepts_valid_bff_signature():
    body = b'{"email":"signed@example.com","password":"StrongPass123!"}'
    headers = _signed_headers("POST", "/auth/register", body)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/auth/register", content=body, headers=headers)
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_provider_webhook_remains_outside_bff_signature_gate():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/webhooks/payos", json={})
    assert response.status_code == 200
