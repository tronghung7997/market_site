"""Process-local TTL cache for singleton runtime configs.

Designed for admin-tunable rows (display money, deposit rails, future feature
flags): read-heavy, write-rare, PK=1.

Properties
----------
- Soft TTL: stale values expire even without a write (multi-worker safety net).
- Hard invalidate: writers call ``invalidate()`` so this worker sees the next
  read immediately.
- Registry: ``clear_all_process_config_caches()`` wipes every instance — used
  by test fixtures after TRUNCATE so truncated DB rows cannot leak via cache.
- Values must be plain serializable dicts / scalars, never ORM instances.

Multi-worker note
-----------------
Each worker has its own cache. Soft TTL bounds cross-worker lag. If stronger
consistency is required later, add Redis pub/sub invalidation on top of the
same ``invalidate()`` API without changing call sites.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Generic, TypeVar

T = TypeVar("T")

# Soft default — enough to cut PK reads on hot public paths; short enough that
# multi-worker lag after admin edits stays under a few seconds.
DEFAULT_TTL_SECONDS = 5.0


@dataclass(slots=True)
class _Entry(Generic[T]):
    value: T
    loaded_at: float


class ProcessConfigCache(Generic[T]):
    """Thread-safe process-local cache with soft TTL + hard invalidate."""

    def __init__(self, name: str, *, ttl_seconds: float = DEFAULT_TTL_SECONDS) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self.name = name
        self.ttl_seconds = float(ttl_seconds)
        self._lock = Lock()
        self._entry: _Entry[T] | None = None
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

    def peek_age_seconds(self) -> float | None:
        """Test/debug helper: age of current entry, or None if empty."""
        with self._lock:
            if self._entry is None:
                return None
            return monotonic() - self._entry.loaded_at


_registry_lock = Lock()
_registry: list[ProcessConfigCache] = []


def _register(cache: ProcessConfigCache) -> None:
    with _registry_lock:
        _registry.append(cache)


def clear_all_process_config_caches() -> None:
    """Invalidate every registered cache (test isolation after DB TRUNCATE)."""
    with _registry_lock:
        caches = list(_registry)
    for cache in caches:
        cache.invalidate()
