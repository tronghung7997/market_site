import asyncio
import json

import pytest

from src.chat.events import publish, stream


@pytest.mark.asyncio
async def test_publish_reaches_an_open_subscriber():
    gen = stream(42)
    first = await gen.__anext__()
    assert "retry:" in first

    async def next_data() -> str:
        while True:
            chunk = await gen.__anext__()
            if chunk.startswith("data:"):
                return chunk

    waiter = asyncio.create_task(next_data())
    await asyncio.sleep(0)
    await publish([42], {"type": "message.created", "conversation_id": "room-1"})
    chunk = await asyncio.wait_for(waiter, timeout=2)
    await gen.aclose()
    payload = json.loads(chunk.removeprefix("data:").strip())
    assert payload["type"] == "message.created"
    assert payload["conversation_id"] == "room-1"
