"""Audit history of one entity: every `log_entries` row whose metadata names
it as ``subject_type`` / ``subject_id``, newest first.

Feature services write those rows with `audit.service.log_event`; this module
is the single read path (product activity, promotion history, desk tickets…).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account
from src.models.log_entry import LogEntry

# Envelope keys every business event carries; the rest is the event's detail.
AUDIT_ENVELOPE_KEYS = frozenset({"event", "actor_id", "actor_type", "subject_type", "subject_id", "outcome", "source"})
# Subjects an admin may read through the generic endpoint.
HISTORY_SUBJECTS = frozenset({"promotion", "product", "conversation", "account", "seller_application", "canned_reply"})
MAX_HISTORY = 200


async def entity_history(db: AsyncSession, subject_type: str, subject_id: int | str, *, limit: int = 50) -> list[dict]:
    """[{id, event, actor_email, created_at, details}] — the IP is never returned."""
    entries = list((await db.execute(
        select(LogEntry)
        .where(
            LogEntry.metadata_["subject_type"].astext == subject_type,
            LogEntry.metadata_["subject_id"].astext == str(subject_id),
        )
        .order_by(LogEntry.created_at.desc(), LogEntry.id.desc())
        .limit(max(1, min(limit, MAX_HISTORY)))
    )).scalars())
    actor_ids = {
        int(e.metadata_["actor_id"]) for e in entries
        if isinstance((e.metadata_ or {}).get("actor_id"), int)
    }
    emails = dict((await db.execute(
        select(Account.id, Account.email).where(Account.id.in_(actor_ids))
    )).all()) if actor_ids else {}
    out = []
    for entry in entries:
        meta = dict(entry.metadata_ or {})
        meta.pop("ip", None)
        out.append({
            "id": entry.id,
            "event": meta.get("event"),
            "actor_email": emails.get(meta.get("actor_id")),
            "created_at": entry.created_at,
            "details": {k: v for k, v in meta.items() if k not in AUDIT_ENVELOPE_KEYS},
        })
    return out
