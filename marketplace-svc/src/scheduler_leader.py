"""Run the scheduled jobs on exactly one process.

Every process that may run jobs (each uvicorn worker, each replica, the
dedicated `python -m src.worker`) starts the scheduler paused and competes for
one session-level Postgres advisory lock; only the holder resumes the jobs.
The lock lives on a dedicated connection. When the holder dies or its
connection drops, Postgres releases the lock and another process takes over
within `retry_seconds`; the old holder pauses its jobs as soon as its
heartbeat fails. For that short overlap the jobs stay safe on their own: each
settlement re-locks its order row with SKIP LOCKED.
"""
import asyncio

import structlog
from apscheduler.schedulers.base import BaseScheduler
from sqlalchemy import text

from src.database import engine

logger = structlog.get_logger()

SCHEDULER_LOCK_KEY = 0x4D4B5453  # "MKTS": the process that runs scheduled jobs
HEARTBEAT_SECONDS = 30.0


async def run_scheduler_leader(
    scheduler: BaseScheduler,
    *,
    retry_seconds: float = HEARTBEAT_SECONDS,
    heartbeat_seconds: float = HEARTBEAT_SECONDS,
) -> None:
    """Keep `scheduler` paused unless this process holds the advisory lock.
    Runs until cancelled; shuts the scheduler down on the way out."""
    scheduler.start(paused=True)
    try:
        while True:
            await _lead_while_holding_lock(scheduler, heartbeat_seconds)
            await asyncio.sleep(retry_seconds)
    finally:
        scheduler.shutdown(wait=False)


async def _lead_while_holding_lock(scheduler: BaseScheduler, heartbeat_seconds: float) -> None:
    conn = None
    leading = False
    try:
        conn = await engine.connect()
        leading = bool(await conn.scalar(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": SCHEDULER_LOCK_KEY},
        ))
        # A session lock outlives the transaction; commit so the connection is
        # not left idle in a transaction (idle_in_transaction_session_timeout).
        await conn.commit()
        if not leading:
            return
        logger.info("scheduler_leader_acquired")
        scheduler.resume()
        while True:
            await asyncio.sleep(heartbeat_seconds)
            await conn.execute(text("SELECT 1"))
            await conn.commit()
    except asyncio.CancelledError:
        raise
    except Exception as e:  # noqa: BLE001 — a lost database must not kill the process
        logger.warning("scheduler_leader_lost" if leading else "scheduler_leader_check_failed", error=str(e))
    finally:
        if leading:
            scheduler.pause()
        if conn is not None:
            try:
                if leading:
                    # Never hand a lock-holding connection back to the pool:
                    # closing it for good is what releases the lock.
                    await conn.invalidate()
                await conn.close()
            except Exception:  # noqa: BLE001
                pass
