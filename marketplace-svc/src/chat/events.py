import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator, Iterable


_subscribers: dict[int, set[asyncio.Queue[dict]]] = defaultdict(set)


async def publish(account_ids: Iterable[int], event: dict) -> None:
    """Best-effort same-process invalidation; Postgres remains source of truth."""
    for account_id in set(account_ids):
        for queue in tuple(_subscribers.get(account_id, ())):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                event = {"type": "resync"}
            queue.put_nowait(event)


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
