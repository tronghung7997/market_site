from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select, update

from src.database import SessionLocal
from src.models.account import Account
from src.models.mail import MailOutbox
from tests.conftest import register_and_login


async def _outbox(template: str) -> list[MailOutbox]:
    async with SessionLocal() as db:
        result = await db.execute(select(MailOutbox).where(MailOutbox.template == template))
        return list(result.scalars().all())


def _token_from_url(url: str) -> str:
    return parse_qs(urlparse(url).query)["token"][0]


@pytest.mark.asyncio
async def test_forgot_unknown_email_is_generic_and_silent(client):
    resp = await client.post(
        "/auth/forgot-password",
        json={"email": "nobody@example.com", "locale": "vi"},
    )
    assert resp.status_code == 200
    assert "hướng dẫn" in resp.json()["message"].lower()
    assert await _outbox("password_reset") == []


@pytest.mark.asyncio
async def test_forgot_inactive_account_is_silent(client):
    await register_and_login(client, "gone@example.com")
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == "gone@example.com").values(is_active=False))
        await db.commit()

    resp = await client.post(
        "/auth/forgot-password",
        json={"email": "gone@example.com", "locale": "vi"},
    )
    assert resp.status_code == 200
    assert await _outbox("password_reset") == []


@pytest.mark.asyncio
async def test_reset_password_success_and_cannot_reuse_token(client):
    await register_and_login(client, "resetme@example.com", "OldPassword123!")
    forgot = await client.post(
        "/auth/forgot-password",
        json={"email": "resetme@example.com", "locale": "en"},
    )
    assert forgot.status_code == 200
    rows = await _outbox("password_reset")
    assert len(rows) == 1
    token = _token_from_url(rows[0].payload["action_url"])
    assert "/en/reset-password" in rows[0].payload["action_url"]

    reset = await client.post(
        "/auth/reset-password",
        json={"token": token, "password": "NewPassword123!"},
    )
    assert reset.status_code == 200

    old = await client.post(
        "/auth/login",
        json={"email": "resetme@example.com", "password": "OldPassword123!"},
    )
    assert old.status_code == 401
    new = await client.post(
        "/auth/login",
        json={"email": "resetme@example.com", "password": "NewPassword123!"},
    )
    assert new.status_code == 200
    assert await _outbox("password_changed")

    reuse = await client.post(
        "/auth/reset-password",
        json={"token": token, "password": "AnotherPass123!"},
    )
    assert reuse.status_code == 400


@pytest.mark.asyncio
async def test_second_forgot_invalidates_first_token(client):
    await register_and_login(client, "twice@example.com", "FirstPassword123!")
    await client.post("/auth/forgot-password", json={"email": "twice@example.com"})
    first = (await _outbox("password_reset"))[0]
    token1 = _token_from_url(first.payload["action_url"])

    await client.post("/auth/forgot-password", json={"email": "twice@example.com"})
    rows = await _outbox("password_reset")
    assert len(rows) == 2
    token2 = _token_from_url(max(rows, key=lambda r: r.id).payload["action_url"])

    stale = await client.post(
        "/auth/reset-password",
        json={"token": token1, "password": "SecondPassword123!"},
    )
    assert stale.status_code == 400
    ok = await client.post(
        "/auth/reset-password",
        json={"token": token2, "password": "SecondPassword123!"},
    )
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_reset_with_garbage_token(client):
    resp = await client.post(
        "/auth/reset-password",
        json={"token": "x" * 40, "password": "ValidPassword123!"},
    )
    assert resp.status_code == 400
    assert "hết hạn" in resp.json()["detail"] or "không hợp lệ" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_forgot_password_rate_limit(client, monkeypatch):
    from src.config import settings

    monkeypatch.setattr(settings, "auth_rate_limit_enabled", True)
    from unittest.mock import AsyncMock
    limiter = AsyncMock(side_effect=[True, False])
    monkeypatch.setattr("src.auth.router.check_rate_limit", limiter)

    response = await client.post(
        "/auth/forgot-password",
        json={"email": "limited-reset@example.com"},
    )
    assert response.status_code == 429
