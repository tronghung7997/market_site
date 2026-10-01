"""Mirror committed business events (log_entries) onto the log stream.

`audit.service.log_event` adds a LogEntry to the caller's transaction. The
same fact is queued here and written to stdout only after that transaction
commits, so money/order dashboards never count an order or deposit that was
rolled back. A rollback drops the queue.

Each line: event=<metadata.event or "audit">, business=true, audit_message,
plus the scalar metadata (order_id, amount, seller_id, intent_id, source…).
Lists and nested objects stay in Postgres only.
"""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import event
from sqlalchemy.orm import Session

logger = structlog.get_logger("business")

_QUEUE_KEY = "pending_business_logs"
# Already on every line from context, or not worth a column.
_DROP_KEYS = frozenset({"ip", "event"})
_LEVELS = {"debug", "info", "warning", "error", "critical"}

_installed = False


def _scalar_fields(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if not metadata:
        return {}
    return {
        key: value
        for key, value in metadata.items()
        if key not in _DROP_KEYS and (value is None or isinstance(value, (str, int, float, bool)))
    }


def queue_business_log(
    session: Session,
    level: str,
    message: str,
    metadata: dict[str, Any] | None,
    *,
    job_id: str | None = None,
) -> None:
    """Hold one business event until `session` commits."""
    entry = {
        "level": level if level in _LEVELS else "info",
        "event": (metadata or {}).get("event") or "audit",
        "audit_message": message,
        "fields": _scalar_fields(metadata),
        "job_id": job_id,
    }
    session.info.setdefault(_QUEUE_KEY, []).append(entry)


def _flush(session: Session) -> None:
    for entry in session.info.pop(_QUEUE_KEY, []):
        fields = dict(entry["fields"])
        if entry["job_id"]:
            fields.setdefault("audit_job_id", entry["job_id"])
        try:
            getattr(logger, entry["level"])(
                entry["event"], business=True, audit_message=entry["audit_message"], **fields
            )
        except Exception:
            # Logging must never break a committed business operation.
            pass


def _discard(session: Session, *_args: Any) -> None:
    session.info.pop(_QUEUE_KEY, None)


def install() -> None:
    global _installed
    if _installed:
        return
    event.listen(Session, "after_commit", _flush)
    event.listen(Session, "after_rollback", _discard)
    _installed = True
