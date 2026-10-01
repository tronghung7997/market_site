"""State snapshot job + admin alerts mirrored onto the log stream."""

import structlog
from structlog.testing import capture_logs

from src.alerts.service import add_alert, upsert_incident
from src.database import SessionLocal
from src.observability import business
from src.observability.state import collect_state, state_snapshot_job

_GAUGES = {
    "orders_pending", "orders_processing", "orders_delivered", "orders_disputed", "escrow_held_vnd",
    "orders_stuck", "wallet_available_vnd", "wallet_locked_vnd", "withdraw_pending_count",
    "withdraw_pending_vnd", "withdraw_approved_unpaid_count", "withdraw_approved_unpaid_vnd",
    "disputes_open", "disputes_seller_overdue", "disputes_resolution_overdue", "deposits_pending",
    "alerts_active",
}


async def test_collect_state_reports_every_gauge():
    async with SessionLocal() as db:
        state = await collect_state(db)
    assert set(state) == _GAUGES
    assert all(isinstance(value, int) for value in state.values())


async def test_state_snapshot_job_logs_one_line():
    with capture_logs() as logs:
        await state_snapshot_job()
    [snapshot] = [entry for entry in logs if entry["event"] == "state_snapshot"]
    assert _GAUGES <= snapshot.keys()


async def test_admin_alerts_reach_the_log_only_after_commit():
    business.install()
    with capture_logs() as logs:
        async with SessionLocal() as db:
            await add_alert(
                db, type_="escrow_release_failed", severity="critical",
                target_type="order", target_id=42, message="Escrow release failed for order 42",
            )
            await db.rollback()
        assert [entry for entry in logs if entry["event"] == "system_alert"] == []

        async with SessionLocal() as db:
            await upsert_incident(
                db, fingerprint="test:provider:1:credit", type_="provider_credit_low",
                severity="warning", target_type="provider", target_id=1, message="Provider credit low",
            )
            await db.commit()
    [line] = [entry for entry in logs if entry["event"] == "system_alert"]
    assert line["alert_type"] == "provider_credit_low"
    assert line["severity"] == "warning"
    assert line["log_level"] == "warning"
    assert line["occurrence_count"] == 1
    assert "business" not in line
