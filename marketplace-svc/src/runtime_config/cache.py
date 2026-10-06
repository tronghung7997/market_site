"""Process-local TTL cache for singleton runtime configs.

Designed for admin-tunable rows (display money, deposit rails, future feature
flags): read-heavy, write-rare, PK=1.

Properties
----------
- Soft TTL: stale values expire even without a write (multi-worker safety net).
- Hard invalidate: writers call ``invalidate()`` so this worker sees the next
  read immediately.
- Single flight: ``get_or_load()`` lets one caller per event loop run the
  loader on a miss while concurrent callers await its result, so a TTL expiry
  under load costs one query, not one per in-flight request. A load that
  straddles an ``invalidate()`` is handed to the callers already waiting but is
  not cached, so every read that starts after a write sees the write.
- Registry: ``clear_all_process_config_caches()`` wipes every instance — used
  by test fixtures after TRUNCATE so truncated DB rows cannot leak via cache.
- Values must be plain serializable dicts / scalars, never ORM instances.

Multi-worker note
-----------------
Each worker has its own cache. Soft TTL bounds cross-worker lag. If stronger
consistency is required later, add Redis pub/sub invalidation on top of the
same ``invalidate()`` API without changing call sites. A decision that must
never act on a stale value (the money kill-switches in ``site_status``) reads
the row itself inside its own transaction instead of going through a cache.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Any, Awaitable, Callable, Generic, Hashable, Protocol, TypeVar

T = TypeVar("T")
K = TypeVar("K", bound=Hashable)

# Soft default — enough to cut PK reads on hot public paths; short enough that
# multi-worker lag after admin edits stays under a few seconds.
DEFAULT_TTL_SECONDS = 5.0


@dataclass(slots=True)
class _Entry(Generic[T]):
    value: T
    loaded_at: float


@dataclass(slots=True)
class _Flight:
    loop: asyncio.AbstractEventLoop
    future: asyncio.Future[Any]
    generation: int


# Handed to waiters when the leading load failed: each retries on its own.
_LOAD_FAILED = object()


class ProcessConfigCache(Generic[T]):
    """Thread-safe process-local cache with soft TTL + hard invalidate."""

    def __init__(self, name: str, *, ttl_seconds: float = DEFAULT_TTL_SECONDS) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self.name = name
        self.ttl_seconds = float(ttl_seconds)
        self._lock = Lock()
        self._entry: _Entry[T] | None = None
        self._generation = 0
        self._flight: _Flight | None = None
        _register(self)

    def get(self) -> T | None:
        """Return a deep copy of the cached value, or None if missing/expired."""
        with self._lock:
            entry = self._entry
            if entry is None:
                return None
            if monotonic() - entry.loaded_at >= self.ttl_seconds:
                self._entry = None
                return None
            return deepcopy(entry.value)

    def set(self, value: T) -> None:
        """Store a deep copy so callers cannot mutate the cache via references."""
        with self._lock:
            self._entry = _Entry(value=deepcopy(value), loaded_at=monotonic())

    def invalidate(self) -> None:
        """Drop the entry so the next get() misses (call after successful writes)."""
        with self._lock:
            self._entry = None
            self._generation += 1
            # Readers arriving from now on must not join a load that may have
            # read the row before the write committed.
            self._flight = None

    async def get_or_load(self, loader: Callable[[], Awaitable[T]]) -> T:
        """Cached value, else ``await loader()`` once for all concurrent callers.

        ``loader`` runs in the leading caller's context (its session); it must
        return a plain value. Waiters get their own deep copy. If the leader's
        load fails, the leader sees the error and each waiter retries.
        """
        while True:
            loop = asyncio.get_running_loop()
            with self._lock:
                entry = self._entry
                if entry is not None and monotonic() - entry.loaded_at < self.ttl_seconds:
                    return deepcopy(entry.value)
                flight = self._flight
                leading = flight is None or flight.loop is not loop
                if leading:
                    flight = _Flight(loop=loop, future=loop.create_future(), generation=self._generation)
                    self._flight = flight
            assert flight is not None
            if leading:
                return await self._lead(flight, loader)
            result = await asyncio.shield(flight.future)
            if result is not _LOAD_FAILED:
                return deepcopy(result)

    async def _lead(self, flight: _Flight, loader: Callable[[], Awaitable[T]]) -> T:
        try:
            value = await loader()
        except BaseException:
            self._land(flight, _LOAD_FAILED)
            raise
        snapshot = deepcopy(value)
        with self._lock:
            if self._generation == flight.generation:
                self._entry = _Entry(value=snapshot, loaded_at=monotonic())
        self._land(flight, snapshot)
        return value

    def _land(self, flight: _Flight, result: Any) -> None:
        with self._lock:
            if self._flight is flight:
                self._flight = None
        if not flight.future.done():
            flight.future.set_result(result)

    def peek_age_seconds(self) -> float | None:
        """Test/debug helper: age of current entry, or None if empty."""
        with self._lock:
            if self._entry is None:
                return None
            return monotonic() - self._entry.loaded_at


class KeyedProcessCache(Generic[K, T]):
    """Process-local LRU + soft-TTL cache for read-heavy, key-shaped lookups
    (storefront search suggestions, …).

    Same contract as :class:`ProcessConfigCache` — deep-copied values, soft
    TTL, ``invalidate()`` wipes everything, registered for test isolation —
    but keyed and bounded: the least recently used entry is evicted once
    ``max_entries`` is reached, so an attacker typing random queries cannot
    grow worker memory without limit.
    """

    def __init__(self, name: str, *, ttl_seconds: float = DEFAULT_TTL_SECONDS, max_entries: int = 1024) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        if max_entries <= 0:
            raise ValueError("max_entries must be positive")
        self.name = name
        self.ttl_seconds = float(ttl_seconds)
        self.max_entries = int(max_entries)
        self._lock = Lock()
        self._entries: OrderedDict[K, _Entry[T]] = OrderedDict()
        _register(self)

    def get(self, key: K) -> T | None:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if monotonic() - entry.loaded_at >= self.ttl_seconds:
                del self._entries[key]
                return None
            self._entries.move_to_end(key)
            return deepcopy(entry.value)

    def set(self, key: K, value: T) -> None:
        with self._lock:
            self._entries[key] = _Entry(value=deepcopy(value), loaded_at=monotonic())
            self._entries.move_to_end(key)
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)

    def invalidate(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


class _Invalidatable(Protocol):
    def invalidate(self) -> None: ...


_registry_lock = Lock()
_registry: list[_Invalidatable] = []


def _register(cache: _Invalidatable) -> None:
    with _registry_lock:
        _registry.append(cache)


def clear_all_process_config_caches() -> None:
    """Invalidate every registered cache (test isolation after DB TRUNCATE)."""
    with _registry_lock:
        caches = list(_registry)
    for cache in caches:
        cache.invalidate()
