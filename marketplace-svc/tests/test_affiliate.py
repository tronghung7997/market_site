import pytest
from datetime import date, datetime, timedelta
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account
from src.models.affiliate import AffiliateClick
from tests.conftest import make_admin, register_and_login


@pytest.mark.asyncio
async def test_click_valid_code_creates_row(client):
    reg = await client.post("/auth/register", json={
        "email": "aff_click@example.com",
        "password": "StrongPass123!",
    })
    affiliate_id = reg.json()["id"]
    async with SessionLocal() as db:
        affiliate = await db.scalar(select(Account).where(Account.id == affiliate_id))
        code = affiliate.affiliate_code

    resp = await client.post("/affiliate/click", json={"code": code, "path": "/p/1", "referrer": "https://t.co"})
    assert resp.status_code == 204

    async with SessionLocal() as db:
        click = await db.scalar(select(AffiliateClick).where(AffiliateClick.affiliate_account_id == affiliate_id))
    assert click is not None
    assert click.path == "/p/1"
    assert click.referrer == "https://t.co"


@pytest.mark.asyncio
async def test_click_unknown_code_no_row_no_error(client):
    resp = await client.post("/affiliate/click", json={"code": "NOPE0000"})
    assert resp.status_code == 204

    async with SessionLocal() as db:
        result = await db.execute(select(AffiliateClick))
        assert result.scalars().first() is None


@pytest.mark.asyncio
async def test_click_requires_no_auth(client):
    resp = await client.post("/affiliate/click", json={"code": "ANYCODE1"})
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_affiliate_me_requires_auth(client):
    resp = await client.get("/affiliate/me")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_affiliate_me_returns_code_and_zero_totals_for_new_account(client):
    reg = await client.post("/auth/register", json={
        "email": "aff_me@example.com",
        "password": "StrongPass123!",
    })
    login = await client.post("/auth/login", json={
        "email": "aff_me@example.com",
        "password": "StrongPass123!",
    })
    token = login.json()["access_token"]
    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == "aff_me@example.com"))
        code = account.affiliate_code

    resp = await client.get("/affiliate/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["code"] == code
    assert data["link"].endswith(f"/?ref={code}")
    totals = data["totals"]
    assert totals["clicks"] == 0
    assert totals["signups"] == 0
    assert totals["orders"] == 0
    assert totals["revenue"] == 0
    assert totals["commission"] == 0
    assert data["commissions"] == []


@pytest.mark.asyncio
async def test_affiliate_me_totals_match_db(client):
    reg = await client.post("/auth/register", json={
        "email": "aff_stat@example.com",
        "password": "StrongPass123!",
    })
    affiliate_id = reg.json()["id"]
    login = await client.post("/auth/login", json={
        "email": "aff_stat@example.com",
        "password": "StrongPass123!",
    })
    token = login.json()["access_token"]

    async with SessionLocal() as db:
        affiliate = await db.scalar(select(Account).where(Account.id == affiliate_id))
        code = affiliate.affiliate_code

    await client.post("/affiliate/click", json={"code": code})
    await client.post("/affiliate/click", json={"code": code})

    await client.post("/auth/register", json={
        "email": "referred1@example.com",
        "password": "StrongPass123!",
        "referral_code": code,
    })

    resp = await client.get("/affiliate/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["totals"]["clicks"] == 2
    assert data["totals"]["signups"] == 1
    assert data["totals"]["orders"] == 0
    assert data["totals"]["commission"] == 0


@pytest.mark.asyncio
async def test_affiliate_me_timeseries_has_no_gaps(client):
    reg = await client.post("/auth/register", json={
        "email": "aff_ts@example.com",
        "password": "StrongPass123!",
    })
    login = await client.post("/auth/login", json={
        "email": "aff_ts@example.com",
        "password": "StrongPass123!",
    })
    token = login.json()["access_token"]

    start = (date.today() - timedelta(days=9)).isoformat()
    end = date.today().isoformat()
    resp = await client.get(
        "/affiliate/me",
        params={"date_from": start, "date_to": end},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    ts = resp.json()["timeseries"]
    assert len(ts) == 10
    dates = [datetime.fromisoformat(p["date"]).date() for p in ts]
    assert dates == sorted(dates)
    cur = datetime.fromisoformat(start).date()
    for p in ts:
        assert p["date"] == cur.isoformat()
        cur += timedelta(days=1)


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admin_affiliates_requires_admin(client):
    token = await register_and_login(client, "aff_nonadmin@example.com")
    resp = await client.get("/admin/affiliates", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_affiliate_detail_requires_admin(client):
    token = await register_and_login(client, "aff_nonadmin2@example.com")
    resp = await client.get("/admin/affiliates/1", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_affiliates_list_paginates_and_searches(client):
    admin_token = await register_and_login(client, "aff_list_admin@example.com")
    await make_admin("aff_list_admin@example.com")
    admin_token = await register_and_login(client, "aff_list_admin@example.com")

    await client.post("/auth/register", json={"email": "searchable@example.com", "password": "StrongPass123!"})
    await client.post("/auth/register", json={"email": "other@example.com", "password": "StrongPass123!"})

    resp = await client.get("/admin/affiliates", headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 3
    assert len(data["items"]) <= data["per_page"]
    assert all("affiliate_code" in item for item in data["items"])

    resp = await client.get("/admin/affiliates", params={"search": "searchable"},
                            headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 200
    results = resp.json()["items"]
    assert all("searchable" in item["email"] for item in results)
    assert len(results) >= 1


@pytest.mark.asyncio
async def test_admin_affiliate_detail_404_for_nonexistent(client):
    admin_token = await register_and_login(client, "aff_detail_admin@example.com")
    await make_admin("aff_detail_admin@example.com")
    admin_token = await register_and_login(client, "aff_detail_admin@example.com")

    resp = await client.get("/admin/affiliates/999999", headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_admin_affiliate_detail_matches_me(client):
    """Detail response for a given account matches what /affiliate/me would return."""
    admin_token = await register_and_login(client, "aff_match_admin@example.com")
    await make_admin("aff_match_admin@example.com")
    admin_token = await register_and_login(client, "aff_match_admin@example.com")

    reg = await client.post("/auth/register", json={
        "email": "aff_match_user@example.com",
        "password": "StrongPass123!",
    })
    user_id = reg.json()["id"]
    login = await client.post("/auth/login", json={
        "email": "aff_match_user@example.com",
        "password": "StrongPass123!",
    })
    user_token = login.json()["access_token"]

    me_resp = await client.get("/affiliate/me", headers={"Authorization": f"Bearer {user_token}"})
    detail_resp = await client.get(f"/admin/affiliates/{user_id}",
                                   headers={"Authorization": f"Bearer {admin_token}"})
    assert me_resp.status_code == 200
    assert detail_resp.status_code == 200
    me_data = me_resp.json()
    detail_data = detail_resp.json()
    assert me_data["code"] == detail_data["code"]
    assert me_data["link"] == detail_data["link"]
    assert me_data["totals"] == detail_data["totals"]

