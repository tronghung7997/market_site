"""Dedicated process for the scheduled jobs: `python -m src.worker`.

Runs the same jobs as the web app's scheduler (registered in `src.main`) under
the same advisory-lock leadership (`src.scheduler_leader`), so web processes can
run with SCHEDULER_ENABLED=false and scale out without carrying the jobs.
Stops on SIGTERM/SIGINT.
"""
import asyncio
import signal

import structlog

logger = structlog.get_logger()


async def main() -> None:
    from src.main import scheduler  # importing the app registers every job
    from src.scheduler_leader import run_scheduler_leader

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    leader = asyncio.create_task(run_scheduler_leader(scheduler))
    logger.info("worker_started")
    await stop.wait()
    leader.cancel()
    await asyncio.gather(leader, return_exceptions=True)
    logger.info("worker_stopped")


if __name__ == "__main__":
    asyncio.run(main())
