import pytest

from src.config import settings
from src.security.admin_access import parse_admin_allowed_ips


def test_admin_allowed_ips_rejects_invalid_config():
    with pytest.raises(ValueError, match="ADMIN_ALLOWED_IPS"):
        parse_admin_allowed_ips("not-an-ip")


@pytest.mark.asyncio
async def test_admin_network_paths_are_hidden_outside_allowlist(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_allowed_ips", "203.0.113.10")

    admin_login = await client.post(
        "/auth/admin/login",
        json={"email": "admin@example.com", "password": "StrongPass123!"},
    )
    admin_api = await client.get("/admin/accounts")
    health = await client.get("/health")

    assert admin_login.status_code == 404
    assert admin_login.headers["cache-control"] == "private, no-store"
    assert admin_api.status_code == 404
    assert health.status_code == 200


@pytest.mark.asyncio
async def test_admin_network_paths_allow_configured_peer(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_allowed_ips", "127.0.0.1")

    # Reaching auth validation (422) proves the network middleware allowed it.
    response = await client.post("/auth/admin/login", json={})
    assert response.status_code == 422
