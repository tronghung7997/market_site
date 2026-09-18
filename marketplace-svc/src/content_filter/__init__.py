"""Off-platform contact filter for buyer/seller text (chat, disputes).

Public interface:

- ``screen_text(db, text, *, actor_id, context) -> str`` — returns the text
  to store (masked when the admin chose "mask"), or raises
  ``ContentBlocked`` when it must be rejected. Also writes one audit row per
  violation so repeat offenders can be found in ``/admin/logs``.
- ``get_config`` / ``update_config`` — admin-tunable singleton, process-cached.
"""
from .service import ContentBlocked, get_config, screen_text, update_config

__all__ = ["ContentBlocked", "get_config", "screen_text", "update_config"]
