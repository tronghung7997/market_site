import os

# Tests run against a DEDICATED database so the suite's per-test TRUNCATE never
# wipes the dev/demo data in `marketplace`. Forced (not setdefault) for safety.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace_test",
)
os.environ["DEPLOYMENT_ENVIRONMENT"] = "test"
os.environ["AUTH_RATE_LIMIT_ENABLED"] = "false"
os.environ.setdefault("JWT_SECRET", "test-secret-key-at-least-32-bytes-long-000")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key-at-least-32-bytes-long")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-at-least-32-bytes-long")
os.environ.setdefault("DEFAULT_AFFILIATE_COMMISSION_PERCENT", "5.0")
# Nhiều test cũ nạp tiền qua demo-topup; flag này mặc định TẮT (prod-safe) nên
# bật riêng cho suite. SePay values are isolated fake sandbox credentials.
os.environ["ENABLE_DEMO_TOPUP"] = "true"
os.environ["MAIL_PROVIDER"] = "log"
os.environ["MAIL_WORKER_ENABLED"] = "false"
os.environ["SEPAY_BANK_CODE"] = "MBBank"
os.environ["SEPAY_BANK_ACCOUNT_NUMBER"] = "0123456789"
os.environ["SEPAY_BANK_ACCOUNT_NAME"] = "CONG TY TNHH TEST"
os.environ["SEPAY_BANK_ACCOUNT_ID"] = "f9e8d7c6-b5a4-3210-fedc-ba0987654321"
os.environ["SEPAY_PAYMENT_CODE_PREFIX"] = "NAP"
os.environ["SEPAY_WEBHOOK_SECRET"] = "test-sepay-webhook-secret-at-least-32-bytes"
os.environ["SEPAY_API_TOKEN"] = "test-sepay-sandbox-token"
os.environ["SEPAY_API_BASE_URL"] = "https://userapi-sandbox.sepay.vn"
# Legacy credentials keep historical PayOS reconciliation tests/data loadable.
os.environ["PAYOS_CLIENT_ID"] = "test-client"
os.environ["PAYOS_API_KEY"] = "test-api-key"
os.environ["PAYOS_CHECKSUM_KEY"] = "test-checksum-key"
os.environ["PAYOS_BASE_URL"] = "http://payos.test"
# Ghim cứng hạn mức nạp: dev hay hạ DEPOSIT_MIN_AMOUNT trong .env để test tiền
# thật số nhỏ — pydantic-settings đọc .env theo CWD nên không ghim là suite
# đổi hành vi theo máy.
os.environ["DEPOSIT_MIN_AMOUNT"] = "10000"
os.environ["DEPOSIT_MAX_AMOUNT"] = "100000000"

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text, update

from src.database import SessionLocal, engine
from src.main import app
from src.models.account import Account


async def register_and_login(client, email, password="StrongPass123!"):
    await client.post("/auth/register", json={"email": email, "password": password})
    resp = await client.post("/auth/login", json={"email": email, "password": password})
    if resp.status_code == 403 and resp.json().get("error_code") == "ADMIN_LOGIN_REQUIRED":
        resp = await client.post("/auth/admin/login", json={"email": email, "password": password})
    return resp.json()["access_token"]


async def make_admin(email):
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == email).values(roles=["buyer", "admin"]))
        await db.commit()


async def make_seller(email):
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == email).values(roles=["buyer", "seller"]))
        await db.commit()


async def set_seller_tier(email, tier):
    async with SessionLocal() as db:
        await db.execute(update(Account).where(Account.email == email).values(seller_tier=tier))
        await db.commit()


@pytest.fixture(autouse=True)
async def clean_db(request):
    """Truncate all tables before each test so the suite is isolated and re-runnable."""
    if request.node.get_closest_marker("no_db"):
        yield
        return
    # Process-local config caches survive TRUNCATE; wipe them so tests never
    # observe a previous case's display_money / deposit_rail public payload.
    from src.runtime_config import clear_all_process_config_caches

    clear_all_process_config_caches()
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
