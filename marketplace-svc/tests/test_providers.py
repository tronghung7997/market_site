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
