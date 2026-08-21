import pytest
from sqlalchemy import select

from src.database import SessionLocal
from src.models.account import Account
from tests.conftest import make_admin


@pytest.mark.asyncio
async def test_register_success(client):
    response = await client.post("/auth/register", json={
        "email": "test@example.com",
        "password": "StrongPass123!",
    })
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "test@example.com"
    assert "id" in data
    assert "buyer" in data["roles"]
    assert "password" not in data


@pytest.mark.asyncio
async def test_register_sets_unique_affiliate_code(client):
    """Every account created via register() has a non-null, unique affiliate_code."""
    await client.post("/auth/register", json={
        "email": "aff1@example.com",
        "password": "StrongPass123!",
    })
    await client.post("/auth/register", json={
        "email": "aff2@example.com",
        "password": "StrongPass123!",
    })
    async with SessionLocal() as db:
        a1 = await db.scalar(select(Account).where(Account.email == "aff1@example.com"))
        a2 = await db.scalar(select(Account).where(Account.email == "aff2@example.com"))
    assert a1.affiliate_code is not None
    assert a2.affiliate_code is not None
    assert len(a1.affiliate_code) == 8
    assert len(a2.affiliate_code) == 8
    assert a1.affiliate_code != a2.affiliate_code


@pytest.mark.asyncio
async def test_register_affiliate_code_collision_retry(client, monkeypatch):
    """On a unique-constraint collision, generation retries and produces a working code."""
    from src.auth import utils

    real_gen = utils.generate_affiliate_code
    pre_existing = real_gen()
    calls = {"n": 0}

    def colliding_then_real():
        calls["n"] += 1
        if calls["n"] == 1:
            return pre_existing
        return real_gen()

    monkeypatch.setattr(utils, "generate_affiliate_code", colliding_then_real)

    await client.post("/auth/register", json={
        "email": "seed@example.com",
        "password": "StrongPass123!",
    })
    async with SessionLocal() as db:
        seed = await db.scalar(select(Account).where(Account.email == "seed@example.com"))
    monkeypatch.setattr(utils, "generate_affiliate_code", colliding_then_real)
    calls["n"] = 0

    response = await client.post("/auth/register", json={
        "email": "retry@example.com",
        "password": "StrongPass123!",
    })
    assert response.status_code == 201
    async with SessionLocal() as db:
        retry = await db.scalar(select(Account).where(Account.email == "retry@example.com"))
    assert retry.affiliate_code is not None
    assert retry.affiliate_code != seed.affiliate_code
    assert calls["n"] >= 2


@pytest.mark.asyncio
async def test_register_duplicate_email(client):
    payload = {"email": "dup@example.com", "password": "StrongPass123!"}
    await client.post("/auth/register", json=payload)
    response = await client.post("/auth/register", json=payload)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_register_rejects_short_password_with_clear_limit(client):
    response = await client.post(
        "/auth/register",
        json={"email": "short@example.com", "password": "too-short"},
    )
    assert response.status_code == 422
    issue = response.json()["detail"][0]
    assert issue["loc"][-1] == "password"
    assert issue["ctx"]["min_length"] == 12


@pytest.mark.asyncio
async def test_register_with_valid_referral_code_sets_referred_by(client):
    seed = await client.post("/auth/register", json={
        "email": "referrer@example.com",
        "password": "StrongPass123!",
    })
    seed_id = seed.json()["id"]
    async with SessionLocal() as db:
        referrer = await db.scalar(select(Account).where(Account.email == "referrer@example.com"))
    response = await client.post("/auth/register", json={
        "email": "referred@example.com",
        "password": "StrongPass123!",
        "referral_code": referrer.affiliate_code,
    })
    assert response.status_code == 201
    async with SessionLocal() as db:
        referred = await db.scalar(select(Account).where(Account.email == "referred@example.com"))
    assert referred.referred_by_id == seed_id


@pytest.mark.asyncio
async def test_register_with_unknown_referral_code_leaves_referred_by_null(client):
    response = await client.post("/auth/register", json={
        "email": "norefer@example.com",
        "password": "StrongPass123!",
        "referral_code": "NOPECODE",
    })
    assert response.status_code == 201
    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == "norefer@example.com"))
    assert account.referred_by_id is None


@pytest.mark.asyncio
async def test_register_without_referral_code_leaves_referred_by_null(client):
    response = await client.post("/auth/register", json={
        "email": "plain@example.com",
        "password": "StrongPass123!",
    })
    assert response.status_code == 201
    async with SessionLocal() as db:
        account = await db.scalar(select(Account).where(Account.email == "plain@example.com"))
    assert account.referred_by_id is None


@pytest.mark.asyncio
async def test_login_success(client):
    await client.post("/auth/register", json={"email": "login@example.com", "password": "StrongPass123!"})
    response = await client.post("/auth/login", json={"email": "login@example.com", "password": "StrongPass123!"})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    await client.post("/auth/register", json={"email": "wp@example.com", "password": "StrongPass123!"})
    response = await client.post("/auth/login", json={"email": "wp@example.com", "password": "wrong"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_admin_must_use_dedicated_login(client):
    email = "private-admin@example.com"
    password = "StrongPass123!"
    await client.post("/auth/register", json={"email": email, "password": password})
    await make_admin(email)

    public_login = await client.post("/auth/login", json={"email": email, "password": password})
    assert public_login.status_code == 403
    assert public_login.json()["error_code"] == "ADMIN_LOGIN_REQUIRED"

    admin_login = await client.post(
        "/auth/admin/login",
        json={"email": email, "password": password},
    )
    assert admin_login.status_code == 200
    assert "access_token" in admin_login.json()


@pytest.mark.asyncio
async def test_non_admin_cannot_use_admin_login(client):
    email = "buyer-admin-gate@example.com"
    password = "StrongPass123!"
    await client.post("/auth/register", json={"email": email, "password": password})

    response = await client.post(
        "/auth/admin/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 403
    assert response.json()["error_code"] == "ADMIN_ONLY"


@pytest.mark.asyncio
async def test_me_requires_auth(client):
    response = await client.get("/me")
    # Missing credentials → 401 Unauthorized (FastAPI/Starlette current behavior).
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_account(client):
    await client.post("/auth/register", json={"email": "me@example.com", "password": "StrongPass123!"})
    login = await client.post("/auth/login", json={"email": "me@example.com", "password": "StrongPass123!"})
    token = login.json()["access_token"]
    response = await client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["email"] == "me@example.com"
