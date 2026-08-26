import socket
from unittest.mock import AsyncMock

import httpcore
import pytest
from pydantic import ValidationError
from sqlalchemy import update

from src.config import Settings, settings
from src.database import SessionLocal
from src.models.account import Account
from src.rate_limit import _fallback_windows, check_rate_limit

from .conftest import register_and_login


def _settings_kwargs(**overrides):
    values = {
        "deployment_environment": "test",
        "jwt_secret": "j" * 40,
        "internal_api_key": "i" * 40,
        "bff_request_signing_secret": "b" * 40,
        "encryption_key": "e" * 40,
        "enable_demo_topup": False,
        "auth_rate_limit_enabled": True,
    }
    values.update(overrides)
    return values


@pytest.mark.no_db
def test_known_default_secrets_are_rejected():
    with pytest.raises(ValidationError, match="known insecure default"):
        Settings(
            _env_file=None,
            **_settings_kwargs(jwt_secret="dev-secret-change-in-production"),
        )


@pytest.mark.no_db
def test_short_secrets_are_rejected():
    with pytest.raises(ValidationError, match="at least 32 bytes"):
        Settings(_env_file=None, **_settings_kwargs(internal_api_key="too-short"))


@pytest.mark.no_db
def test_production_cannot_enable_demo_topup_or_disable_auth_limiter():
    with pytest.raises(ValidationError, match="ENABLE_DEMO_TOPUP"):
        Settings(
            _env_file=None,
            **_settings_kwargs(deployment_environment="production", enable_demo_topup=True),
        )


@pytest.mark.no_db
def test_production_rejects_debug_docs_and_local_origins():
    production = {
        "deployment_environment": "production",
        "frontend_base_url": "https://market.example",
        "cors_allowed_origins": "https://market.example",
        "backend_base_url": "https://api.example",
    }
    with pytest.raises(ValidationError, match="docs and debug"):
        Settings(_env_file=None, **_settings_kwargs(**production, api_docs_enabled=True))
    with pytest.raises(ValidationError, match="public HTTPS"):
        Settings(
            _env_file=None,
            **_settings_kwargs(**{**production, "cors_allowed_origins": "http://localhost:3000"}),
        )
    with pytest.raises(ValidationError, match="AUTH_RATE_LIMIT_ENABLED"):
        Settings(
            _env_file=None,
            **_settings_kwargs(
                deployment_environment="production",
                auth_rate_limit_enabled=False,
            ),
        )


@pytest.mark.no_db
def test_wildcard_cors_origin_is_rejected():
    with pytest.raises(ValidationError, match="must not contain"):
        Settings(_env_file=None, **_settings_kwargs(cors_allowed_origins="*"))


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_security_sensitive_rate_limit_uses_local_fallback(monkeypatch):
    def redis_unavailable():
        raise ConnectionError("redis unavailable")

    monkeypatch.setattr("src.rate_limit._get_client", redis_unavailable)
    _fallback_windows.clear()
    assert await check_rate_limit("auth:test", limit=2, window_seconds=60, fail_open=False)
    assert await check_rate_limit("auth:test", limit=2, window_seconds=60, fail_open=False)
    assert not await check_rate_limit("auth:test", limit=2, window_seconds=60, fail_open=False)


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_ssrf_resolution_rejects_any_private_answer_and_returns_public_pin(monkeypatch):
    from src.security.ssrf_guard import validate_seller_base_url

    class FakeLoop:
        async def getaddrinfo(self, hostname, port):
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 0)),
            ]

    monkeypatch.setattr("src.security.ssrf_guard.asyncio.get_running_loop", lambda: FakeLoop())
    with pytest.raises(Exception, match="địa chỉ nội bộ"):
        await validate_seller_base_url("https://seller.example/", require_resolution=True)

    async def public_only(self, hostname, port):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))]

    monkeypatch.setattr(FakeLoop, "getaddrinfo", public_only)
    target = await validate_seller_base_url("https://seller.example/", require_resolution=True)
    assert target is not None
    assert target.hostname == "seller.example"
    assert target.ip_address == "93.184.216.34"


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_pinned_transport_connects_to_validated_ip_only():
    from src.security.pinned_transport import _PinnedNetworkBackend

    backend = _PinnedNetworkBackend("seller.example", "93.184.216.34")
    backend._backend.connect_tcp = AsyncMock(return_value=object())
    await backend.connect_tcp("seller.example", 443)
    assert backend._backend.connect_tcp.await_args.args[:2] == ("93.184.216.34", 443)
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp("rebound.internal", 443)


@pytest.mark.asyncio
async def test_auth_rate_limit_returns_429(client, monkeypatch):
    monkeypatch.setattr(settings, "auth_rate_limit_enabled", True)
    limiter = AsyncMock(side_effect=[True, False])
    monkeypatch.setattr("src.auth.router.check_rate_limit", limiter)

    response = await client.post(
        "/auth/login",
        json={"email": "limited@example.com", "password": "wrong"},
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == str(settings.auth_rate_limit_window_seconds)


@pytest.mark.asyncio
async def test_weak_registration_password_is_rejected(client):
    response = await client.post(
        "/auth/register",
        json={"email": "weak@example.com", "password": "short"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_eight_character_registration_password_is_accepted(client):
    response = await client.post(
        "/auth/register",
        json={"email": "eightchars@example.com", "password": "passw0rd"},
    )
    assert response.status_code == 201


@pytest.mark.asyncio
async def test_inactive_account_cannot_login_or_reuse_old_token(client):
    token = await register_and_login(client, "inactive@example.com")
    async with SessionLocal() as db:
        await db.execute(
            update(Account)
            .where(Account.email == "inactive@example.com")
            .values(is_active=False)
        )
        await db.commit()

    login = await client.post(
        "/auth/login",
        json={"email": "inactive@example.com", "password": "StrongPass123!"},
    )
    me = await client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert login.status_code == 401
    assert me.status_code == 401


@pytest.mark.asyncio
async def test_operations_requires_owner_or_admin(client):
    from tests.test_products import setup_seller_with_category

    seller_token, admin_token, category_id = await setup_seller_with_category(client)
    product = await client.post(
        "/seller/products",
        json={"category_id": category_id, "title": "Private operations"},
        headers={"Authorization": f"Bearer {seller_token}"},
    )
    path = f"/products/{product.json()['id']}/operations"

    other_token = await register_and_login(client, "ops-other@example.com")
    anonymous = await client.get(path)
    other = await client.get(path, headers={"Authorization": f"Bearer {other_token}"})
    owner = await client.get(path, headers={"Authorization": f"Bearer {seller_token}"})
    admin = await client.get(path, headers={"Authorization": f"Bearer {admin_token}"})

    assert anonymous.status_code == 401
    assert other.status_code == 404
    assert owner.status_code == 200
    assert admin.status_code == 200


@pytest.mark.asyncio
async def test_docs_debug_and_evil_cors_are_closed_by_default(client):
    for path in ("/docs", "/redoc", "/openapi.json", "/version"):
        assert (await client.get(path)).status_code == 404

    preflight = await client.options(
        "/me",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    assert preflight.status_code == 400
    assert "access-control-allow-origin" not in preflight.headers


@pytest.mark.asyncio
async def test_cors_preflight_allows_browser_auth_headers(client):
    """The browser only sends normal BFF/session headers, never BFF signing secrets."""
    origin = settings.cors_origins[0]
    preflight = await client.options(
        "/seller/orders",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Authorization, Content-Type, X-Request-ID",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers.get("access-control-allow-origin") == origin
    allow = preflight.headers.get("access-control-allow-headers", "").lower()
    assert "authorization" in allow
    assert "content-type" in allow
    assert "x-request-id" in allow


@pytest.mark.asyncio
async def test_api_security_headers_are_present(client):
    response = await client.get("/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


@pytest.mark.asyncio
async def test_public_products_are_always_paginated(client):
    from tests.test_products import setup_seller_with_category

    seller_token, _admin_token, category_id = await setup_seller_with_category(client)
    for index in range(2):
        response = await client.post(
            "/seller/products",
            json={
                "category_id": category_id,
                "title": f"Paginated {index}",
                "status": "active",
            },
            headers={"Authorization": f"Bearer {seller_token}"},
        )
        assert response.status_code == 201

    page = await client.get("/products?per_page=1")
    assert page.status_code == 200
    assert len(page.json()["items"]) == 1
    assert page.json()["total"] == 2


@pytest.mark.asyncio
async def test_provider_credentials_are_masked_in_api_response(client):
    from tests.conftest import make_admin

    email = "masked-provider-admin@example.com"
    token = await register_and_login(client, email)
    await make_admin(email)
    token = await register_and_login(client, email)
    created = await client.post(
        "/admin/providers",
        json={
            "name": "Masked provider",
            "type": "proxy",
            "config": {"base_url": "https://api.example.com", "api_key": "do-not-return"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert created.status_code == 201
    assert created.json()["config"]["api_key"] == "********"
    assert "gAAAA" not in created.text


@pytest.mark.asyncio
async def test_provider_webhook_does_not_reveal_provider_existence(client):
    unknown = await client.post(
        "/webhooks/providers/999999/tasks/unknown",
        content=b"{}",
        headers={"X-Signature": "invalid", "Content-Type": "application/json"},
    )
    assert unknown.status_code == 401
    assert unknown.json()["detail"] == "Chữ ký webhook không hợp lệ"
