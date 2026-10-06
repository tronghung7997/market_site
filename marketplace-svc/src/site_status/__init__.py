"""Operational switches: maintenance mode, money kill-switches, announcement bar.

Public interface:
- ``get_site_status(db)`` — every switch through a process cache (5 s TTL,
  single flight, invalidated in-process by admin writes). Read paths only.
- ``require_orders_open / require_deposits_open / require_withdrawals_open`` —
  raise the coded 503 when the matching kill-switch is on. They read the
  column fresh on the caller's session, never through the cache.
- ``maintenance_gate`` — app-wide FastAPI dependency: 503 MAINTENANCE for
  non-admin callers while maintenance is on (health, webhooks and the admin
  sign-in path stay reachable).
- ``pausable(job)`` — scheduler wrapper that skips money-moving jobs during
  maintenance.
"""
from .service import (
    get_site_status,
    maintenance_active,
    pausable,
    require_deposits_open,
    require_orders_open,
    require_withdrawals_open,
    update_site_status,
)

__all__ = [
    "get_site_status", "maintenance_active", "pausable",
    "require_deposits_open", "require_orders_open", "require_withdrawals_open",
    "update_site_status",
]
