"""Running more than one backend process: scheduled jobs on exactly one of them
(Postgres advisory lock) and chat events reaching every process (Redis relay)."""
import asyncio
import json

import pytest
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from redis import asyncio as aioredis

import src.chat.events as events
from src.config import settings
from src.scheduler_leader import run_scheduler_leader


def _ticking_scheduler(hits: dict, name: str) -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler()

    async def tick() -> None:
        hits[name] += 1

    scheduler.add_job(tick, "interval", seconds=0.05, id="tick")
    return scheduler


async def _stop(*tasks: asyncio.Task) -> None:
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def test_only_the_advisory_lock_holder_runs_scheduled_jobs():
    """Two processes (two connections) compete; one runs the jobs, and the other
    takes over once the leader goes away."""
    hits = {"a": 0, "b": 0}
    fast = {"retry_seconds": 0.1, "heartbeat_seconds": 0.1}
    leader_a = asyncio.create_task(run_scheduler_leader(_ticking_scheduler(hits, "a"), **fast))
    leader_b = None
    try:
        await asyncio.sleep(0.3)
        leader_b = asyncio.create_task(run_scheduler_leader(_ticking_scheduler(hits, "b"), **fast))
        await asyncio.sleep(0.5)
        assert hits["a"] > 0
        assert hits["b"] == 0

        await _stop(leader_a)
        b_before = hits["b"]
        await asyncio.sleep(0.6)
        assert hits["b"] > b_before
    finally:
        await _stop(*(t for t in (leader_a, leader_b) if t is not None))


async def _next_event(gen) -> dict:
    while True:
        chunk = await gen.__anext__()
        if chunk.startswith("data:"):
            return json.loads(chunk.removeprefix("data:").strip())


async def test_chat_events_reach_streams_held_by_another_process():
    relay = asyncio.create_task(events.run_chat_event_relay())
    gen = events.stream(7701)
    other_process = aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        for _ in range(100):
            if events._relay_ready:
                break
            await asyncio.sleep(0.02)
        assert events._relay_ready, "relay did not subscribe (is Redis running?)"
        await gen.__anext__()  # retry hint

        await other_process.publish(events.relay_channel(), json.dumps({
            "account_ids": [7701], "event": {"type": "message.created", "conversation_id": "room-9"},
        }))
        assert await asyncio.wait_for(_next_event(gen), 2) == {"type": "message.created", "conversation_id": "room-9"}

        # Published here: delivered once, through the relay, not also locally.
        await events.publish([7701], {"type": "conversation.created", "conversation_id": "room-10"})
        assert (await asyncio.wait_for(_next_event(gen), 2))["conversation_id"] == "room-10"
        await asyncio.sleep(0.2)
        assert all(queue.empty() for queue in events._subscribers[7701])
    finally:
        await gen.aclose()
        await other_process.aclose()
        await _stop(relay)


async def test_chat_event_relay_survives_a_quiet_channel(monkeypatch):
    """An idle channel is normal; the subscription must not drop and reconnect
    when nothing is published for longer than a socket read timeout."""
    disconnects: list[str] = []
    real_warning = events.logger.warning

    def record(event, **kwargs):
        if event == "chat_event_relay_disconnected":
            disconnects.append(kwargs.get("error", ""))
        return real_warning(event, **kwargs)

    monkeypatch.setattr(events.logger, "warning", record)
    monkeypatch.setattr(settings, "redis_url", settings.redis_url.split("?")[0] + "?socket_timeout=1")
    relay = asyncio.create_task(events.run_chat_event_relay())
    gen = events.stream(7704)
    other_process = aioredis.from_url(settings.redis_url.split("?")[0], decode_responses=True)
    try:
        for _ in range(100):
            if events._relay_ready:
                break
            await asyncio.sleep(0.02)
        await gen.__anext__()
        await asyncio.sleep(2.5)  # longer than the configured read timeout, nothing published
        await other_process.publish(events.relay_channel(), json.dumps({
            "account_ids": [7704], "event": {"type": "message.created", "conversation_id": "room-13"},
        }))
        assert (await asyncio.wait_for(_next_event(gen), 2))["conversation_id"] == "room-13"
        assert disconnects == []
    finally:
        await gen.aclose()
        await other_process.aclose()
        await _stop(relay)


async def test_chat_events_fall_back_to_local_delivery_when_redis_fails(monkeypatch):
    class BrokenRedis:
        async def publish(self, *_args, **_kwargs):
            raise ConnectionError("redis down")

    monkeypatch.setattr(events, "_publisher_client", lambda: BrokenRedis())
    monkeypatch.setattr(events, "_relay_ready", True)  # even with a relay, a failed send delivers here
    gen = events.stream(7702)
    try:
        await gen.__anext__()
        await events.publish([7702], {"type": "message.created", "conversation_id": "room-11"})
        assert (await asyncio.wait_for(_next_event(gen), 2))["conversation_id"] == "room-11"
    finally:
        await gen.aclose()


@pytest.mark.no_db
async def test_a_stream_that_fell_behind_gets_resync_without_affecting_others():
    behind: asyncio.Queue[dict] = asyncio.Queue(maxsize=1)
    behind.put_nowait({"type": "old"})
    live: asyncio.Queue[dict] = asyncio.Queue(maxsize=50)
    events._subscribers[7703].update({behind, live})
    try:
        events._deliver_local([7703], {"type": "message.created", "conversation_id": "room-12"})
        assert behind.get_nowait() == {"type": "resync"}
        assert live.get_nowait() == {"type": "message.created", "conversation_id": "room-12"}
    finally:
        events._subscribers.pop(7703, None)
