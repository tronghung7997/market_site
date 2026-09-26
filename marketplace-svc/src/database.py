from collections.abc import AsyncGenerator

from sqlalchemy import Integer, any_, literal
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from src.config import settings


def _connect_args() -> dict:
    if settings.db_idle_in_transaction_timeout_seconds <= 0:
        return {}
    timeout_ms = settings.db_idle_in_transaction_timeout_seconds * 1000
    return {"server_settings": {"idle_in_transaction_session_timeout": str(timeout_ms)}}


engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout_seconds,
    pool_recycle=settings.db_pool_recycle_seconds,
    pool_pre_ping=True,
    connect_args=_connect_args(),
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


def id_in(column, ids):
    """``column IN ids`` sent as ONE int[] parameter (``= ANY($1)``). An expanded
    IN list binds one parameter per id, and asyncpg rejects a query with more
    than 32 767 of them (order lists, bulk stock actions)."""
    return column == any_(literal(list(ids), ARRAY(Integer)))
