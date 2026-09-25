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
        ("DB_POOL_RECYCLE_SECONDS", "0"),
        ("DB_MAX_OVERFLOW", "-1"),
        ("DB_IDLE_IN_TRANSACTION_TIMEOUT_SECONDS", "-1"),
    ],
)
def test_invalid_pool_settings_are_rejected(monkeypatch, env_name, value):
    monkeypatch.setenv(env_name, value)
    with pytest.raises(ValueError, match=env_name):
        Settings()
