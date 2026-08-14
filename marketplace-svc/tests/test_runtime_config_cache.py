"""ProcessConfigCache unit tests — no DB required."""
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
