import pytest

from tests.conftest import make_admin, register_and_login


@pytest.mark.asyncio
async def test_analytics_config_admin_sets_clarity_id_and_public_reads_it(client):
    """Fresh DB → no tag. Admin sets an id → the public payload the storefront
    layout reads exposes it; blank clears it again; garbage is rejected."""
    assert (await client.get("/public/analytics-config")).json() == {"clarity_project_id": None}

    await register_and_login(client, "admin-analytics@example.com")
    await make_admin("admin-analytics@example.com")
    token = await register_and_login(client, "admin-analytics@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    cfg = (await client.get("/admin/analytics-config", headers=headers)).json()
    assert cfg["clarity_project_id"] is None

    res = await client.patch("/admin/analytics-config", json={"clarity_project_id": " AbCd1EfGh2 "}, headers=headers)
    assert res.status_code == 200
    assert res.json()["clarity_project_id"] == "abcd1efgh2"
    assert res.json()["updated_by_id"] is not None
    assert (await client.get("/public/analytics-config")).json() == {"clarity_project_id": "abcd1efgh2"}

    for bad in ("abc", "x" * 21, "has-dash1", "<script>"):
        assert (await client.patch("/admin/analytics-config", json={"clarity_project_id": bad}, headers=headers)).status_code == 422

    res = await client.patch("/admin/analytics-config", json={"clarity_project_id": ""}, headers=headers)
    assert res.status_code == 200 and res.json()["clarity_project_id"] is None
    assert (await client.get("/public/analytics-config")).json() == {"clarity_project_id": None}


@pytest.mark.asyncio
async def test_analytics_config_requires_admin(client):
    token = await register_and_login(client, "buyer-analytics@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/admin/analytics-config", headers=headers)).status_code == 403
    assert (await client.patch("/admin/analytics-config", json={"clarity_project_id": "abcdef"}, headers=headers)).status_code == 403
