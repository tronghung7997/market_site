"""One-shot HTTP purge demo accounts — một curl internal rồi 410."""
import pytest
from sqlalchemy import select

from src.config import settings
from src.database import SessionLocal
from src.models.account import Account
from src.models.alert import Alert
from src.ops.purge_demo import DONE_FINGERPRINT

INTERNAL = {"X-Internal-Key": settings.internal_api_key}


async def _seed_demo_accounts():
    async with SessionLocal() as db:
        for email, roles in [
            ("admin@dxtrade.example.com", ["buyer", "admin"]),
            ("seller@dxtrade.example.com", ["buyer", "seller"]),
            ("buyer@dxtrade.example.com", ["buyer"]),
        ]:
            db.add(Account(email=email, password_hash="x", roles=roles))
        # Admin thật — để purge không abort.
        db.add(Account(
            email="real-admin@example.org", password_hash="x",
            roles=["buyer", "admin"],
        ))
        await db.commit()


@pytest.mark.asyncio
async def test_rejects_invalid_internal_key(client):
    resp = await client.post(
        "/internal/ops/purge-demo-accounts?apply=true",
        headers={"X-Internal-Key": "not-the-internal-key"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_dry_run_does_not_burn(client):
    await _seed_demo_accounts()
    r1 = await client.post("/internal/ops/purge-demo-accounts?apply=false", headers=INTERNAL)
    assert r1.status_code == 200
    body = r1.json()
    assert body["status"] == "dry_run"
    assert len(body["accounts"]) == 3

    # Vẫn gọi được (chưa đốt).
    r2 = await client.post("/internal/ops/purge-demo-accounts?apply=false", headers=INTERNAL)
    assert r2.status_code == 200
    assert r2.json()["status"] == "dry_run"


@pytest.mark.asyncio
async def test_apply_once_then_gone(client):
    await _seed_demo_accounts()

    applied = await client.post(
        "/internal/ops/purge-demo-accounts",
        headers=INTERNAL,
    )
    assert applied.status_code == 200
    assert applied.json()["status"] == "applied"

    async with SessionLocal() as db:
        demos = (await db.execute(
            select(Account).where(Account.email.ilike("%dxtrade%"))
        )).scalars().all()
        assert demos == []
        purged = (await db.execute(
            select(Account).where(Account.email.like("purged+%@invalid.local"))
        )).scalars().all()
        assert len(purged) == 3
        assert all(not a.is_active for a in purged)
        marker = await db.scalar(
            select(Alert).where(Alert.fingerprint == DONE_FINGERPRINT)
        )
        assert marker is not None

    second = await client.post(
        "/internal/ops/purge-demo-accounts",
        headers=INTERNAL,
    )
    assert second.status_code == 410


@pytest.mark.asyncio
async def test_abort_without_remaining_admin(client):
    async with SessionLocal() as db:
        db.add(Account(
            email="admin@dxtrade.example.com", password_hash="x",
            roles=["buyer", "admin"],
        ))
        await db.commit()

    resp = await client.post(
        "/internal/ops/purge-demo-accounts",
        headers=INTERNAL,
    )
    assert resp.status_code == 409
    # Không đốt one-shot khi abort — có thể tạo admin rồi chạy lại.
    again = await client.post(
        "/internal/ops/purge-demo-accounts?apply=false",
        headers=INTERNAL,
    )
    assert again.status_code == 200
    assert again.json()["status"] == "dry_run"
