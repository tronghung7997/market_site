"""ProcessConfigCache unit tests — no DB required."""
import asyncio
from time import sleep

import pytest

from src.runtime_config import ProcessConfigCache, clear_all_process_config_caches
from src.runtime_config.cache import DEFAULT_TTL_SECONDS


@pytest.mark.no_db
def test_get_set_returns_copy():
    cache = ProcessConfigCache[dict]("unit_copy", ttl_seconds=30)
    cache.set({"a": 1, "nested": {"b": 2}})
    got = cache.get()
    assert got == {"a": 1, "nested": {"b": 2}}
    got["a"] = 99
    got["nested"]["b"] = 99
    # Mutating the returned dict must not poison the cache.
    assert cache.get() == {"a": 1, "nested": {"b": 2}}


@pytest.mark.no_db
def test_invalidate_clears_entry():
    cache = ProcessConfigCache[dict]("unit_invalidate", ttl_seconds=30)
    cache.set({"x": 1})
    assert cache.get() is not None
    cache.invalidate()
    assert cache.get() is None


@pytest.mark.no_db
def test_soft_ttl_expires():
    cache = ProcessConfigCache[dict]("unit_ttl", ttl_seconds=0.05)
    cache.set({"x": 1})
    assert cache.get() == {"x": 1}
    sleep(0.06)
    assert cache.get() is None


@pytest.mark.no_db
def test_clear_all_registry():
    a = ProcessConfigCache[dict]("unit_all_a", ttl_seconds=30)
    b = ProcessConfigCache[dict]("unit_all_b", ttl_seconds=30)
    a.set({"a": 1})
    b.set({"b": 2})
    clear_all_process_config_caches()
    assert a.get() is None
    assert b.get() is None


@pytest.mark.no_db
def test_default_ttl_is_short():
    assert DEFAULT_TTL_SECONDS == 5.0


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_get_or_load_single_flight_for_concurrent_misses():
    cache = ProcessConfigCache[dict]("unit_flight", ttl_seconds=30)
    calls = 0
    release = asyncio.Event()

    async def load() -> dict:
        nonlocal calls
        calls += 1
        await release.wait()
        return {"v": calls, "nested": {"n": 1}}

    tasks = [asyncio.create_task(cache.get_or_load(load)) for _ in range(10)]
    await asyncio.sleep(0)
    release.set()
    results = await asyncio.gather(*tasks)
    assert calls == 1
    assert all(r == {"v": 1, "nested": {"n": 1}} for r in results)
    results[1]["nested"]["n"] = 99  # every caller owns its copy
    assert results[2]["nested"]["n"] == 1
    assert await cache.get_or_load(load) == {"v": 1, "nested": {"n": 1}}
    assert calls == 1  # served from the cache


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_get_or_load_failed_leader_lets_waiters_retry():
    cache = ProcessConfigCache[dict]("unit_flight_fail", ttl_seconds=30)
    calls = 0
    release = asyncio.Event()

    async def load() -> dict:
        nonlocal calls
        calls += 1
        if calls == 1:
            await release.wait()
            raise RuntimeError("db down")
        return {"ok": True}

    leader = asyncio.create_task(cache.get_or_load(load))
    await asyncio.sleep(0)
    waiters = [asyncio.create_task(cache.get_or_load(load)) for _ in range(3)]
    await asyncio.sleep(0)
    release.set()
    with pytest.raises(RuntimeError):
        await leader
    assert await asyncio.gather(*waiters) == [{"ok": True}] * 3
    assert calls == 2  # one waiter reloaded, the others shared it


@pytest.mark.no_db
@pytest.mark.asyncio
async def test_invalidate_during_load_is_not_cached_and_new_readers_reload():
    cache = ProcessConfigCache[dict]("unit_flight_inval", ttl_seconds=30)
    values = iter([{"v": "old"}, {"v": "new"}])
    release = asyncio.Event()

    async def slow_load() -> dict:
        value = next(values)
        await release.wait()
        return value

    stale = asyncio.create_task(cache.get_or_load(slow_load))
    await asyncio.sleep(0)
    cache.invalidate()  # an admin write committed while "old" was being read
    fresh = asyncio.create_task(cache.get_or_load(slow_load))  # must not join the old load
    await asyncio.sleep(0)
    release.set()
    assert await stale == {"v": "old"}
    assert await fresh == {"v": "new"}
    assert cache.get() == {"v": "new"}
