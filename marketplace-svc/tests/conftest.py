import hashlib
import hmac
import os
import time
from types import SimpleNamespace

# Tests run against a DEDICATED database so the suite's per-test TRUNCATE never
# wipes the dev/demo data in `marketplace`. Forced (not setdefault) for safety.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace_test",
)
# Redis DB 15 keeps test rate-limit counters and token denylists away from a
# developer's working Redis; a REDIS_URL already in the environment (CI) wins.
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ["DEPLOYMENT_ENVIRONMENT"] = "test"
os.environ["AUTH_RATE_LIMIT_ENABLED"] = "false"
# Account ids restart at 1 after every TRUNCATE while Redis counters live for an
# hour, so the per-account upload limit would leak between tests; its wiring is
# covered in test_media.py by forcing the limiter to refuse.
os.environ["MEDIA_UPLOAD_RATE_LIMIT_PER_HOUR"] = "1000000"
# Sign-up email verification is exercised explicitly in test_auth_verification.py;
# every other test creates throwaway accounts that never open a mailbox.
os.environ["EMAIL_VERIFICATION_REQUIRED"] = "false"
os.environ["MFA_FEATURE_ENABLED"] = "true"  # test_auth_security covers the off state explicitly
os.environ["REQUIRE_ADMIN_2FA"] = "false"
os.environ["REQUIRE_2FA_FOR_WITHDRAWAL"] = "false"
os.environ["TURNSTILE_SECRET_KEY"] = ""
os.environ.setdefault("JWT_SECRET", "test-secret-key-at-least-32-bytes-long-000")
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key-at-least-32-bytes-long")
os.environ.setdefault("BFF_REQUEST_SIGNING_SECRET", "test-bff-signing-secret-at-least-32-bytes")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-at-least-32-bytes-long")
os.environ.setdefault("DEFAULT_AFFILIATE_COMMISSION_PERCENT", "5.0")
# Nhiều test cũ nạp tiền qua demo-topup; flag này mặc định TẮT (prod-safe) nên
# bật riêng cho suite. SePay values are isolated fake sandbox credentials.
os.environ["ENABLE_DEMO_TOPUP"] = "true"
os.environ["MAIL_PROVIDER"] = "log"
os.environ["MAIL_WORKER_ENABLED"] = "false"
# A developer .env may carry real mail credentials; the mail-config tests assert
# the unconfigured state, so blank them for the suite.
os.environ["RESEND_API_KEY"] = ""
os.environ["SMTP_HOST"] = ""
os.environ["SMTP_PASSWORD"] = ""
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

import bcrypt
import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text, update

import src.auth.service as auth_service
from src.database import SessionLocal, engine
from src.main import app
from src.models.account import Account
from src.security.bff_request_signing import requires_bff_signature


def _fast_hash_password(password: str) -> str:
    """Test-only bcrypt cost 4 (~1 ms) instead of the production default 12
    (~250 ms). The suite hashes and checks passwords thousands of times;
    `checkpw` reads the cost from the stored hash, so sign-ins speed up too."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


auth_service.hash_password = _fast_hash_password


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


class BffRequestSigningAuth(httpx.Auth):
    requires_request_body = True

    def auth_flow(self, request):
        # Webhooks and gateway calls carry their own signatures. Overwriting
        # X-Signature here would make every provider callback look forged.
        if not requires_bff_signature(SimpleNamespace(url=SimpleNamespace(path=request.url.path))):
            yield request
            return
        timestamp = str(int(time.time()))
        canonical = b"\n".join((
            request.method.upper().encode("ascii"),
            request.url.raw_path,
            timestamp.encode("ascii"),
            hashlib.sha256(request.content).hexdigest().encode("ascii"),
        ))
        signature = hmac.new(
            os.environ["BFF_REQUEST_SIGNING_SECRET"].encode("utf-8"), canonical, hashlib.sha256,
        ).hexdigest()
        request.headers["X-API-Key"] = "market-bff-v1"
        request.headers["X-Timestamp"] = timestamp
        request.headers["X-Signature"] = f"v1={signature}"
        yield request


@pytest.fixture(autouse=True)
async def clean_db(request):
    """Truncate all tables before each test so the suite is isolated and re-runnable."""
    if request.node.get_closest_marker("no_db"):
        yield
        return
    # Process-local config caches survive TRUNCATE; wipe them so tests never
    # observe a previous case's display_money / deposit_rail public payload.
    from src.runtime_config import clear_all_process_config_caches
    from src.search.service import discard_query_log_buffer, reset_synonyms_snapshot

    clear_all_process_config_caches()
    reset_synonyms_snapshot()
    discard_query_log_buffer()
    async with engine.begin() as conn:
        dirty = await _dirty_tables(conn)
        if dirty:
            await conn.execute(
                text(f"TRUNCATE {', '.join(sorted(dirty))} RESTART IDENTITY CASCADE")
            )
    yield


_table_names: list[str] | None = None

# Tables whose owned id sequence has been used since the last reset. A table can
# be empty again (rolled-back insert, deleted rows) while its ids no longer
# start at 1, and some tests rely on fresh ids.
_USED_SEQUENCE_TABLES = text("""
    SELECT DISTINCT t.relname
    FROM pg_sequences s
    JOIN pg_namespace n ON n.nspname = s.schemaname
    JOIN pg_class sc ON sc.relname = s.sequencename AND sc.relnamespace = n.oid
    JOIN pg_depend d ON d.objid = sc.oid AND d.deptype IN ('a', 'i')
    JOIN pg_class t ON t.oid = d.refobjid
    WHERE s.schemaname = 'public' AND s.last_value IS NOT NULL
""")


async def _dirty_tables(conn) -> set[str]:
    """Only the tables a previous test touched: TRUNCATE costs a few ms per
    table even when it is empty, and truncating all ~70 tables before every test
    dominated the suite's runtime."""
    global _table_names
    if _table_names is None:
        result = await conn.execute(text(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname='public' AND tablename != 'alembic_version'"
        ))
        _table_names = [row[0] for row in result.fetchall()]
    if not _table_names:
        return set()
    probe = " UNION ALL ".join(
        f"SELECT '{name}' WHERE EXISTS (SELECT 1 FROM {name})" for name in _table_names
    )
    dirty = {row[0] for row in (await conn.execute(text(probe))).fetchall()}
    dirty |= {row[0] for row in (await conn.execute(_USED_SEQUENCE_TABLES)).fetchall()}
    return dirty & set(_table_names)


@pytest.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", auth=BffRequestSigningAuth(),
    ) as c:
        yield c
