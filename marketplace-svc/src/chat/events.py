"""Chat change hints for open `/chat/events` streams.

Every process keeps the streams it serves in memory. While the relay runs
(`run_chat_event_relay`, started by the app lifespan), `publish` sends each
event over Redis pub/sub and every process, the sender included, delivers what
it receives, so a stream held by another uvicorn worker or replica still hears
about the change. Without a running relay, or when Redis fails, delivery stays
in-process as before. Events are invalidation hints: Postgres remains the
source of truth and clients also poll, so a lost or duplicated event only
changes how soon a list refreshes.
"""
import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator, Iterable

import structlog
from redis import asyncio as aioredis

from src.config import settings

logger = structlog.get_logger()

_subscribers: dict[int, set[asyncio.Queue[dict]]] = defaultdict(set)
_relay_ready = False
_publisher: aioredis.Redis | None = None


def relay_channel() -> str:
    # Pub/sub channels are global to a Redis server, not per database number:
    # scope them per environment so test, dev and prod never cross.
    return f"{settings.service_name}:{settings.deployment_environment}:chat-events"


def _deliver_local(account_ids: Iterable[int], event: dict) -> None:
    for account_id in set(account_ids):
        for queue in tuple(_subscribers.get(account_id, ())):
            payload = event
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                # This stream fell behind: tell it to reload everything.
                payload = {"type": "resync"}
            queue.put_nowait(payload)


def _publisher_client() -> aioredis.Redis:
    global _publisher
    if _publisher is None:
        # Short timeouts: a slow Redis must never slow down the chat request.
        _publisher = aioredis.from_url(
            settings.redis_url, decode_responses=True, socket_connect_timeout=0.25, socket_timeout=0.25,
        )
    return _publisher


async def publish(account_ids: Iterable[int], event: dict) -> None:
    """Best-effort invalidation for these accounts' open streams, in every process."""
    ids = sorted(set(account_ids))
    try:
        await _publisher_client().publish(relay_channel(), json.dumps({"account_ids": ids, "event": event}))
        sent = True
    except Exception as e:  # noqa: BLE001 — Redis is best-effort here
        logger.warning("chat_event_relay_publish_failed", error=str(e))
        sent = False
    if not (sent and _relay_ready):
        _deliver_local(ids, event)


async def run_chat_event_relay(*, max_backoff_seconds: float = 30.0) -> None:
    """Subscribe to the relay channel and deliver to this process's streams,
    reconnecting with backoff. Runs until cancelled."""
    global _relay_ready
    backoff = 1.0
    while True:
        # No read timeout on the subscription (redis-py defaults to 5 s, which
        # drops an idle channel); health checks still detect a dead connection.
        client = aioredis.from_url(
            settings.redis_url, decode_responses=True, socket_timeout=None, health_check_interval=30,
        )
        try:
            async with client.pubsub(ignore_subscribe_messages=True) as pubsub:
                await pubsub.subscribe(relay_channel())
                _relay_ready = True
                backoff = 1.0
                while True:
                    message = await pubsub.get_message(timeout=5.0)
                    if message is None or message.get("type") != "message":
                        continue
                    try:
                        payload = json.loads(message["data"])
                        _deliver_local(payload["account_ids"], payload["event"])
                    except (ValueError, KeyError, TypeError):
                        logger.warning("chat_event_relay_bad_message")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — keep retrying; local delivery covers the gap
            logger.warning("chat_event_relay_disconnected", error=str(e))
        finally:
            _relay_ready = False
            await client.aclose()
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, max_backoff_seconds)


async def stream(account_id: int) -> AsyncIterator[str]:
    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=50)
    _subscribers[account_id].add(queue)
    try:
        yield "retry: 3000\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=20)
                yield f"data: {json.dumps(event, separators=(',', ':'))}\n\n"
            except TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        _subscribers[account_id].discard(queue)
        if not _subscribers[account_id]:
            _subscribers.pop(account_id, None)
