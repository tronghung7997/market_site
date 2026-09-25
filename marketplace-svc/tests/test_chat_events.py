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


async def test_event_stream_releases_its_db_connections_before_streaming(client, monkeypatch):
    """A tab holds /chat/events open for as long as it lives; the auth lookup (and
    the app-wide maintenance gate) must hand their pooled connection back before
    the first byte is streamed, or ~15 open tabs exhaust the pool."""
    from src.chat import router as chat_router
    from src.database import engine
    from src.runtime_config import clear_all_process_config_caches
    from tests.conftest import register_and_login

    token = await register_and_login(client, "sse-pool@example.com")
    checked_out_while_streaming: list[int] = []

    async def one_chunk(account_id: int):
        checked_out_while_streaming.append(engine.pool.checkedout())
        yield "retry: 3000\n\n"

    monkeypatch.setattr(chat_router, "stream", one_chunk)
    clear_all_process_config_caches()  # make the maintenance gate read the database too

    resp = await client.get("/chat/events", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert checked_out_while_streaming == [0]


async def test_event_stream_requires_a_valid_token(client):
    missing = await client.get("/chat/events")
    invalid = await client.get("/chat/events", headers={"Authorization": "Bearer not-a-token"})

    assert missing.status_code in (401, 403)
    assert invalid.status_code == 401
