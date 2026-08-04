"""Admin log query bounds and retention cleanup (WP6)."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.audit.service import log_event, purge_operational_logs, query_logs
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.log_entry import LogEntry
from tests.conftest import make_admin, register_and_login


@pytest.mark.asyncio
async def test_admin_logs_limit_bounds(client):
    token = await register_and_login(client, "audit_limit@example.com")
    await make_admin("audit_limit@example.com")
    token = await register_and_login(client, "audit_limit@example.com")
    headers = {"Authorization": f"Bearer {token}"}

    assert (await client.get("/admin/logs?limit=0", headers=headers)).status_code == 422
    assert (await client.get("/admin/logs?limit=-1", headers=headers)).status_code == 422
    assert (await client.get("/admin/logs?limit=201", headers=headers)).status_code == 422
    assert (await client.get("/admin/logs?limit=50", headers=headers)).status_code == 200
    assert (await client.get("/admin/logs?before_id=0", headers=headers)).status_code == 422


@pytest.mark.asyncio
async def test_cursor_pagination_no_duplicates():
    async with SessionLocal() as db:
        for i in range(5):
            await log_event(db, "info", f"row {i}", metadata={"event": "test_cursor", "n": i})
        await db.commit()

        page1 = await query_logs(db, limit=2)
        assert len(page1) == 2
        before = page1[-1].id
        page2 = await query_logs(db, limit=2, before_id=before)
        ids = [r.id for r in page1] + [r.id for r in page2]
        assert len(ids) == len(set(ids))
        assert all(i < before for i in [r.id for r in page2])


@pytest.mark.asyncio
async def test_cleanup_spares_active_alerts_and_ledgers():
    async with SessionLocal() as db:
        old = datetime.now(timezone.utc) - timedelta(days=400)
        # Old log entry
        db.add(LogEntry(
            service="marketplace-svc", level="info", message="old",
            created_at=old, metadata_={"event": "stale"},
        ))
        # Active alert must survive even if old
        active = Alert(
            type="provider_down", severity="critical", target_type="provider",
            target_id=1, message="active", is_active=True,
            fingerprint="provider:1:provider_down",
            first_seen_at=old, last_seen_at=old, occurrence_count=1,
        )
        db.add(active)
        # Resolved alert past retention
        resolved = Alert(
            type="provider_down", severity="critical", target_type="provider",
            target_id=2, message="resolved", is_active=False,
            fingerprint=None,
            first_seen_at=old, last_seen_at=old, occurrence_count=1,
            resolved_at=old,
        )
        db.add(resolved)
        await db.commit()
        active_id = active.id

    counts = await purge_operational_logs()
    assert counts["log_entries"] >= 1
    assert counts["resolved_alerts"] >= 1

    async with SessionLocal() as db:
        still_active = await db.get(Alert, active_id)
        assert still_active is not None
        assert still_active.is_active is True
        # No resolved row left with old resolved_at
        leftover = (await db.execute(
            select(Alert).where(Alert.is_active.is_(False), Alert.message == "resolved")
        )).scalars().all()
        assert leftover == []
