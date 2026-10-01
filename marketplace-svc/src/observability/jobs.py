"""Log context and one `job_run` event per scheduled job execution.

Every log line a job writes — its own, its `upstream_call`s, its
`provider_call`s — carries `job` and `job_run_id`, so one filter shows a whole
run the way `request_id` shows a whole HTTP request.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable
from functools import wraps

import structlog
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

logger = structlog.get_logger("scheduler")
tracer = trace.get_tracer("marketplace.scheduler")

# Runs every few seconds; their successful runs are debug-level noise.
_CHATTY_JOBS = frozenset({"mail_outbox", "telegram_dispatch"})
_SLOW_MS = 60_000


def traced_job(job_id: str, func: Callable[[], Awaitable[None]]) -> Callable[[], Awaitable[None]]:
    @wraps(func)
    async def runner() -> None:
        # One root span per run: the job's SQL and outbound calls nest under
        # it instead of each becoming a one-span trace (no-op without OTel).
        with tracer.start_as_current_span(f"job {job_id}", attributes={"job": job_id}) as span:
            await _run(span)

    async def _run(span) -> None:
        structlog.contextvars.clear_contextvars()
        run_id = str(uuid.uuid4())
        structlog.contextvars.bind_contextvars(job=job_id, job_run_id=run_id, channel="job")
        span.set_attribute("job_run_id", run_id)
        start = time.monotonic()
        try:
            await func()
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, type(exc).__name__))
            logger.error(
                "job_run",
                outcome="failed",
                duration_ms=int((time.monotonic() - start) * 1000),
                exc_info=True,
            )
            # Re-raise so APScheduler's own error handling is unchanged.
            raise
        else:
            duration_ms = int((time.monotonic() - start) * 1000)
            if duration_ms >= _SLOW_MS:
                logger.warning("job_run", outcome="ok", duration_ms=duration_ms, slow=True)
            elif job_id in _CHATTY_JOBS:
                logger.debug("job_run", outcome="ok", duration_ms=duration_ms)
            else:
                logger.info("job_run", outcome="ok", duration_ms=duration_ms)
        finally:
            structlog.contextvars.clear_contextvars()

    return runner


def trace_scheduled_jobs(scheduler) -> None:
    """Wrap every job registered so far. Call once, before the scheduler starts."""
    for job in scheduler.get_jobs():
        job.modify(func=traced_job(job.id, job.func))
