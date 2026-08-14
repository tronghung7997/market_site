"""Shared helpers for admin-tunable singleton runtime configs.

Use :class:`ProcessConfigCache` for read-heavy, write-rare process-local
caching. Each config domain (money, deposit rails, …) owns its own cache
instance and hard-invalidates on write.
"""

from .cache import ProcessConfigCache, clear_all_process_config_caches

__all__ = [
    "ProcessConfigCache",
    "clear_all_process_config_caches",
]
