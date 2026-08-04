import asyncio
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, text

from src.alerts.service import (
    add_alert,
    dismiss_alert,
    emit_incident,
    fp_order,
    fp_variant,
    upsert_incident,
)
from src.database import SessionLocal
from src.models.alert import Alert
from src.models.account import Account
from tests.conftest import make_admin, register_and_login


@pytest.mark.asyncio
async def test_list_alerts_admin(client):
    token = await register_and_login(client, "alert_admin@example.com")
    await make_admin("alert_admin@example.com")
    token = await register_and_login(client, "alert_admin@example.com")
    resp = await client.get("/admin/alerts", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_add_alert_does_not_commit_unrelated_state():
    """add_alert must not commit the caller's session."""
    async with SessionLocal() as db:
        account = Account(
            email="alert_txn@example.com",
            password_hash="x",
            roles=["buyer"],
        )
        db.add(account)
        await db.flush()

        await add_alert(
            db,
            type_="dispute_opened",
            severity="warning",
            target_type="order",
            target_id=1,
            message="test",
        )
        # Roll back everything — including the alert.
        await db.rollback()

    async with SessionLocal() as db:
        accounts = (await db.execute(
            select(Account).where(Account.email == "alert_txn@example.com")
        )).scalars().all()
        alerts = (await db.execute(select(Alert))).scalars().all()
        assert accounts == []
        assert alerts == []


@pytest.mark.asyncio
async def test_add_alert_rolls_back_with_caller():
    async with SessionLocal() as db:
        await add_alert(
            db,
            type_="dispute_opened",
            severity="warning",
            target_type="order",
            target_id=99,
            message="will roll back",
        )
        await db.rollback()

    async with SessionLocal() as db:
        assert (await db.scalar(select(Alert.id).where(Alert.target_id == 99))) is None


@pytest.mark.asyncio
async def test_emit_incident_survives_caller_rollback():
    async with SessionLocal() as db:
        await emit_incident(
            fingerprint="order:42:escrow_release_failed",
            type_="escrow_release_failed",
            severity="error",
            target_type="order",
            target_id=42,
            message="independent",
        )
        # Unrelated pending state rolled back — incident already committed.
        db.add(Account(email="never_saved@example.com", password_hash="x", roles=["buyer"]))
        await db.rollback()

    async with SessionLocal() as db:
        alert = await db.scalar(
            select(Alert).where(Alert.fingerprint == "order:42:escrow_release_failed")
        )
        assert alert is not None
        assert alert.is_active is True
        assert (await db.scalar(
            select(Account.id).where(Account.email == "never_saved@example.com")
        )) is None


@pytest.mark.asyncio
async def test_concurrent_identical_incidents_dedupe():
    fingerprint = "provider:7:dproxy_unavailable"

    async def once():
        await emit_incident(
            fingerprint=fingerprint,
            type_="dproxy_unavailable",
            severity="warning",
            target_type="provider",
            target_id=7,
            message="down",
        )

    await asyncio.gather(*[once() for _ in range(8)])

    async with SessionLocal() as db:
        rows = (await db.execute(
            select(Alert).where(Alert.fingerprint == fingerprint, Alert.is_active.is_(True))
        )).scalars().all()
        assert len(rows) == 1
        assert rows[0].occurrence_count == 8


@pytest.mark.asyncio
async def test_different_sla_orders_are_separate_incidents():
    async with SessionLocal() as db:
        await upsert_incident(
            db, fingerprint=fp_order(1, "sla_breach"), type_="sla_breach",
            severity="warning", target_type="seller", target_id=10, message="o1",
        )
        await upsert_incident(
            db, fingerprint=fp_order(2, "sla_breach"), type_="sla_breach",
            severity="warning", target_type="seller", target_id=10, message="o2",
        )
        await db.commit()

        rows = (await db.execute(
            select(Alert).where(Alert.type == "sla_breach", Alert.is_active.is_(True))
        )).scalars().all()
        assert len(rows) == 2
        assert {r.fingerprint for r in rows} == {
            "order:1:sla_breach",
            "order:2:sla_breach",
        }


@pytest.mark.asyncio
async def test_different_low_stock_variants_are_separate_incidents():
    async with SessionLocal() as db:
        await upsert_incident(
            db, fingerprint=fp_variant(11, "resource_low"), type_="resource_low",
            severity="warning", target_type="seller", target_id=5, message="v11",
        )
        await upsert_incident(
            db, fingerprint=fp_variant(12, "resource_low"), type_="resource_low",
            severity="warning", target_type="seller", target_id=5, message="v12",
        )
        await db.commit()

        rows = (await db.execute(
            select(Alert).where(Alert.type == "resource_low", Alert.is_active.is_(True))
        )).scalars().all()
        assert len(rows) == 2


@pytest.mark.asyncio
async def test_dismissed_incident_can_recur():
    fingerprint = "provider:3:provider_down"
    async with SessionLocal() as db:
        first = await upsert_incident(
            db, fingerprint=fingerprint, type_="provider_down",
            severity="critical", target_type="provider", target_id=3, message="down",
        )
        await db.commit()
        first_id = first.id

        await dismiss_alert(first_id, db)

        second = await upsert_incident(
            db, fingerprint=fingerprint, type_="provider_down",
            severity="critical", target_type="provider", target_id=3, message="down again",
        )
        await db.commit()

        assert second.id != first_id
        assert second.is_active is True
        assert second.occurrence_count == 1

        dismissed = await db.get(Alert, first_id)
        assert dismissed is not None
        assert dismissed.is_active is False
        assert dismissed.resolved_at is not None


@pytest.mark.asyncio
async def test_dproxy_outage_updates_count_not_rows():
    fingerprint = "provider:9:dproxy_unavailable"
    async with SessionLocal() as db:
        for i in range(5):
            await upsert_incident(
                db, fingerprint=fingerprint, type_="dproxy_unavailable",
                severity="warning", target_type="provider", target_id=9,
                message=f"cycle {i}",
            )
        await db.commit()

        rows = (await db.execute(
            select(Alert).where(Alert.fingerprint == fingerprint)
        )).scalars().all()
        assert len(rows) == 1
        assert rows[0].occurrence_count == 5
        assert rows[0].last_seen_at >= rows[0].first_seen_at


@pytest.mark.asyncio
async def test_alert_response_includes_lifecycle_fields(client):
    token = await register_and_login(client, "alert_fields@example.com")
    await make_admin("alert_fields@example.com")
    token = await register_and_login(client, "alert_fields@example.com")

    async with SessionLocal() as db:
        await upsert_incident(
            db, fingerprint="provider:1:provider_down", type_="provider_down",
            severity="critical", target_type="provider", target_id=1, message="down",
        )
        await db.commit()

    resp = await client.get("/admin/alerts", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body
    row = body[0]
    assert "first_seen_at" in row
    assert "last_seen_at" in row
    assert "occurrence_count" in row
    assert row["occurrence_count"] >= 1
