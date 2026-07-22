import pytest
from tests.conftest import make_admin, register_and_login


@pytest.mark.asyncio
async def test_create_provider(client):
    token = await register_and_login(client, "prov_admin@example.com")
    await make_admin("prov_admin@example.com")
    token = await register_and_login(client, "prov_admin@example.com")
    resp = await client.post("/admin/providers", json={
        "name": "TestProvider", "type": "proxy",
        "config": {"health_endpoint": "http://example.com/health"},
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    assert resp.json()["name"] == "TestProvider"


@pytest.mark.asyncio
async def test_list_providers(client):
    token = await register_and_login(client, "prov_admin2@example.com")
    await make_admin("prov_admin2@example.com")
    token = await register_and_login(client, "prov_admin2@example.com")
    resp = await client.get("/providers", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_create_provider_encrypts_api_key_at_rest(client):
    from src.database import SessionLocal
    from src.models.provider import Provider
    from src.security.crypto import decrypt_str

    token = await register_and_login(client, "prov_admin3@example.com")
    await make_admin("prov_admin3@example.com")
    token = await register_and_login(client, "prov_admin3@example.com")

    resp = await client.post("/admin/providers", json={
        "name": "RealApiProvider", "type": "proxy",
        "config": {"api_key": "sk_real_plaintext_123", "base_url": "https://api.example.com"},
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201
    provider_id = resp.json()["id"]

    # response echoes ciphertext, not plaintext
    assert resp.json()["config"]["api_key"] != "sk_real_plaintext_123"

    async with SessionLocal() as db:
        provider = await db.get(Provider, provider_id)
        stored = provider.config["api_key"]
        assert stored != "sk_real_plaintext_123"
        assert decrypt_str(stored) == "sk_real_plaintext_123"


@pytest.mark.asyncio
async def test_update_provider_config_encrypts_new_api_key(client):
    from src.database import SessionLocal
    from src.models.provider import Provider
    from src.security.crypto import decrypt_str

    token = await register_and_login(client, "prov_admin4@example.com")
    await make_admin("prov_admin4@example.com")
    token = await register_and_login(client, "prov_admin4@example.com")

    create_resp = await client.post("/admin/providers", json={
        "name": "ToUpdate", "type": "proxy", "config": {},
    }, headers={"Authorization": f"Bearer {token}"})
    provider_id = create_resp.json()["id"]

    resp = await client.put(f"/admin/providers/{provider_id}", json={
        "adapter_type": "topproxy",
        "config": {"api_key": "sk_new_secret", "base_url": "https://api.example.com"},
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["adapter_type"] == "topproxy"

    async with SessionLocal() as db:
        provider = await db.get(Provider, provider_id)
        assert decrypt_str(provider.config["api_key"]) == "sk_new_secret"


# ---------------------------------------------------------------------------
# dproxy config validation (Task 3, docs/superpowers/specs/2026-07-22-dproxy-integration.md)
# — the unit-level cases live in test_dproxy_adapter.py::TestValidateDproxyConfig;
# these confirm the validation is actually wired into the admin HTTP endpoints.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_dproxy_provider_allows_localhost_for_admin_dev_workflow(client):
    """Admin-authored config is trusted — same boundary as
    scripts/mock_seller.py — this must keep scripts/mock_dproxy.py's
    documented http://127.0.0.1:PORT setup working."""
    token = await register_and_login(client, "prov_dpx1@example.com")
    await make_admin("prov_dpx1@example.com")
    token = await register_and_login(client, "prov_dpx1@example.com")

    resp = await client.post("/admin/providers", json={
        "name": "DProxy", "type": "dproxy", "adapter_type": "dproxy",
        "config": {"base_url": "http://127.0.0.1:9200", "api_key": "k"},
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_create_dproxy_provider_rejects_credentials_in_url(client):
    token = await register_and_login(client, "prov_dpx1b@example.com")
    await make_admin("prov_dpx1b@example.com")
    token = await register_and_login(client, "prov_dpx1b@example.com")

    resp = await client.post("/admin/providers", json={
        "name": "DProxy", "type": "dproxy", "adapter_type": "dproxy",
        "config": {"base_url": "https://user:pass@dproxy.example.com", "api_key": "k"},
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_create_dproxy_provider_accepts_well_formed_config(client):
    token = await register_and_login(client, "prov_dpx2@example.com")
    await make_admin("prov_dpx2@example.com")
    token = await register_and_login(client, "prov_dpx2@example.com")

    resp = await client.post("/admin/providers", json={
        "name": "DProxy", "type": "dproxy", "adapter_type": "dproxy",
        "config": {"base_url": "https://dproxy.example.com", "api_key": "k"},
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_update_provider_to_dproxy_revalidates_config(client):
    token = await register_and_login(client, "prov_dpx3@example.com")
    await make_admin("prov_dpx3@example.com")
    token = await register_and_login(client, "prov_dpx3@example.com")

    create_resp = await client.post("/admin/providers", json={
        "name": "ToUpdate", "type": "proxy", "config": {},
    }, headers={"Authorization": f"Bearer {token}"})
    provider_id = create_resp.json()["id"]

    resp = await client.put(f"/admin/providers/{provider_id}", json={
        "adapter_type": "dproxy",
        "config": {"base_url": "https://user:pass@dproxy.example.com", "api_key": "k"},
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_admin_localhost_base_url_still_allowed_for_seller_gateway(client):
    """Regression guard: dproxy's stricter validation must not leak onto
    other adapter types — scripts/mock_seller.py's documented local-dev
    workflow (admin creates a seller_gateway provider pointed at
    http://localhost:PORT) must keep working."""
    token = await register_and_login(client, "prov_dpx4@example.com")
    await make_admin("prov_dpx4@example.com")
    token = await register_and_login(client, "prov_dpx4@example.com")

    resp = await client.post("/admin/providers", json={
        "name": "Local mock seller", "type": "seller_gateway", "adapter_type": "seller_gateway",
        "config": {"base_url": "http://localhost:9100", "api_key": "mock-seller-secret"},
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 201, resp.text


# ---------------------------------------------------------------------------
# review fixes Medium B — validate the EFFECTIVE dproxy config on any update
# that results in adapter_type=dproxy, not only when "config" is present.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_switching_adapter_type_to_dproxy_validates_pre_existing_incompatible_config(client):
    token = await register_and_login(client, "prov_dpx5@example.com")
    await make_admin("prov_dpx5@example.com")
    token = await register_and_login(client, "prov_dpx5@example.com")

    # A perfectly fine mock/topproxy-shaped config — no base_url at all.
    create_resp = await client.post("/admin/providers", json={
        "name": "SwitchMe", "type": "mock", "adapter_type": "mock", "config": {},
    }, headers={"Authorization": f"Bearer {token}"})
    provider_id = create_resp.json()["id"]

    # Switch adapter_type only — no "config" key in this request at all.
    resp = await client.put(f"/admin/providers/{provider_id}", json={
        "adapter_type": "dproxy",
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_updating_non_config_dproxy_fields_with_valid_existing_config_stays_valid(client):
    token = await register_and_login(client, "prov_dpx6@example.com")
    await make_admin("prov_dpx6@example.com")
    token = await register_and_login(client, "prov_dpx6@example.com")

    create_resp = await client.post("/admin/providers", json={
        "name": "DProxy", "type": "dproxy", "adapter_type": "dproxy",
        "config": {"base_url": "https://dproxy.example.com", "api_key": "k"},
    }, headers={"Authorization": f"Bearer {token}"})
    provider_id = create_resp.json()["id"]

    # Only toggling is_active — "config" absent, adapter_type unchanged but
    # still resolves to dproxy, existing config is valid so this must pass.
    resp = await client.put(f"/admin/providers/{provider_id}", json={
        "is_active": False,
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_active"] is False


@pytest.mark.asyncio
async def test_updating_dproxy_config_preserves_unchanged_api_key(client):
    from src.database import SessionLocal
    from src.models.provider import Provider
    from src.security.crypto import decrypt_str

    token = await register_and_login(client, "prov_dpx7@example.com")
    await make_admin("prov_dpx7@example.com")
    token = await register_and_login(client, "prov_dpx7@example.com")

    create_resp = await client.post("/admin/providers", json={
        "name": "DProxy", "type": "dproxy", "adapter_type": "dproxy",
        "config": {"base_url": "https://dproxy.example.com", "api_key": "sk_original"},
    }, headers={"Authorization": f"Bearer {token}"})
    provider_id = create_resp.json()["id"]
    # The admin UI round-trips whatever config it received (including the
    # already-encrypted api_key ciphertext) back on save when the field
    # isn't touched — simulate that here rather than a blank/omitted key.
    stored_config = create_resp.json()["config"]

    resp = await client.put(f"/admin/providers/{provider_id}", json={
        "config": {**stored_config, "base_url": "https://dproxy-new.example.com"},
    }, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text

    async with SessionLocal() as db:
        provider = await db.get(Provider, provider_id)
        assert provider.config["base_url"] == "https://dproxy-new.example.com"
        assert decrypt_str(provider.config["api_key"]) == "sk_original"


# ---------------------------------------------------------------------------
# review fixes Medium C — admin "Test kết nối" must never provision a real
# ProxyAllocation against a nonexistent order_id=0.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dproxy_test_connection_never_creates_an_allocation(client, monkeypatch):
    import httpx
    from sqlalchemy import func, select
    from src.database import SessionLocal
    from src.models.proxy_allocation import ProxyAllocation

    token = await register_and_login(client, "prov_dpx8@example.com")
    await make_admin("prov_dpx8@example.com")
    token = await register_and_login(client, "prov_dpx8@example.com")

    create_resp = await client.post("/admin/providers", json={
        "name": "DProxy", "type": "dproxy", "adapter_type": "dproxy",
        "config": {"base_url": "https://dproxy.example.com", "api_key": "k"},
    }, headers={"Authorization": f"Bearer {token}"})
    provider_id = create_resp.json()["id"]

    future = "2030-01-01T00:00:00+00:00"
    sample = {
        "id": "cab68c1a-707c-4148-a326-e69e99c870db", "assigned_at": None, "expired_at": future,
        "status": "active", "username": "u", "password": "p", "is_active": True,
        "proxies": {
            "host": "h", "port": 1, "status": {"msg": "online"}, "proxy_id": "p1", "ip_public": "1.2.3.4",
            "rotation": {"available": True, "mode": "m", "cooldown_seconds": None, "last_rotated_at": None,
                        "rotate_endpoint": "/api/v1/proxies/user/cab68c1a-707c-4148-a326-e69e99c870db/rotate"},
        },
    }
    calls = {"count": 0}
    original_request = httpx.AsyncClient.request

    async def fake_request(self, method, url, *args, **kwargs):
        if "dproxy.example.com" not in str(url):
            return await original_request(self, method, url, *args, **kwargs)
        calls["count"] += 1
        return httpx.Response(200, json=[sample], request=httpx.Request(method, str(url)))

    monkeypatch.setattr(httpx.AsyncClient, "request", fake_request)

    resp = await client.post(f"/admin/providers/{provider_id}/test", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["health"]["status"] == "healthy"
    assert body["provision_test"] is None  # never attempted for dproxy
    assert calls["count"] == 1  # exactly one list call (health check), no second provision-test call

    async with SessionLocal() as db:
        count = await db.scalar(select(func.count()).select_from(ProxyAllocation))
        assert count == 0
