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
