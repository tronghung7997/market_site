import os

# Tests run against a DEDICATED database so the suite's per-test TRUNCATE never
# wipes the dev/demo data in `marketplace`. Forced (not setdefault) for safety.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace_test",
)
os.environ.setdefault("JWT_SECRET", "test-secret-key-at-least-32-bytes-long-000")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")
os.environ.setdefault("DEFAULT_AFFILIATE_COMMISSION_PERCENT", "5.0")

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text, update

from src.database import SessionLocal, engine
from src.main import app
from src.models.account import Account


async def register_and_login(client, email, password="StrongPass123!"):
    await client.post("/auth/register", json={"email": email, "password": password})
    resp = await client.post("/auth/login", json={"email": email, "password": password})
    return resp.json()["access_token"]


async def make_admin(email):
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == email).values(roles=["buyer", "admin"]))
        await db.commit()


async def make_seller(email):
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == email).values(roles=["buyer", "seller"]))
        await db.commit()


@pytest.fixture(autouse=True)
async def clean_db():
    """Truncate all tables before each test so the suite is isolated and re-runnable."""
    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname='public' AND tablename != 'alembic_version'"
            )
        )
        tables = [row[0] for row in result.fetchall()]
        if tables:
            await conn.execute(
                text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE")
            )
    yield


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
