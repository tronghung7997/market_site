import pytest
from sqlalchemy import text

from src.config import Settings, settings
from src.database import SessionLocal, engine


async def test_engine_applies_configured_pool_and_idle_transaction_timeout():
    assert engine.pool.size() == settings.db_pool_size
    async with SessionLocal() as db:
        timeout_ms = await db.scalar(
            text("SELECT setting FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout'")
        )
    assert timeout_ms == str(settings.db_idle_in_transaction_timeout_seconds * 1000)


@pytest.mark.no_db
@pytest.mark.parametrize(
    ("env_name", "value"),
    [
        ("DB_POOL_SIZE", "0"),
        ("DB_POOL_TIMEOUT_SECONDS", "0"),
        ("DB_POOL_RECYCLE_SECONDS", "-1"),
        ("DB_MAX_OVERFLOW", "-1"),
        ("DB_IDLE_IN_TRANSACTION_TIMEOUT_SECONDS", "-1"),
    ],
)
def test_invalid_pool_settings_are_rejected(monkeypatch, env_name, value):
    monkeypatch.setenv(env_name, value)
    with pytest.raises(ValueError, match=env_name):
        Settings()


@pytest.mark.no_db
def test_pool_recycle_zero_means_connections_are_kept(monkeypatch):
    """0 (the default) keeps pooled connections: reopening them every half hour
    made the next requests pay a fresh connect + asyncpg type introspection."""
    monkeypatch.delenv("DB_POOL_RECYCLE_SECONDS", raising=False)
    assert Settings().db_pool_recycle_seconds == 0
    if settings.db_pool_recycle_seconds == 0:
        assert engine.pool._recycle == -1
    monkeypatch.setenv("DB_POOL_RECYCLE_SECONDS", "3600")
    assert Settings().db_pool_recycle_seconds == 3600


@pytest.mark.no_db
def test_interval_jobs_are_jittered_so_they_do_not_fire_together():
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.triggers.interval import IntervalTrigger

    from src.main import JOB_JITTER_SECONDS, scheduler

    jobs = {job.id: job.trigger for job in scheduler.get_jobs()}
    minute_jobs = {
        job_id: trigger for job_id, trigger in jobs.items()
        if isinstance(trigger, IntervalTrigger) and trigger.interval.total_seconds() >= 60
    }
    assert len(minute_jobs) >= 15
    assert {job_id for job_id, trigger in minute_jobs.items() if trigger.jitter != JOB_JITTER_SECONDS} == set()
    # Sub-minute workers keep their exact cadence; the nightly cron is untouched.
    assert all(t.jitter is None for t in jobs.values()
               if isinstance(t, IntervalTrigger) and t.interval.total_seconds() < 60)
    assert isinstance(jobs["ledger_reconcile"], CronTrigger)
