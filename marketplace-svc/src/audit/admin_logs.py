"""Admin log explorer: who did what to which record.

log_entries keep everything in a free-form metadata dict with bare ids
("actor_id": 7, "order_id": 42, "subject_type": "withdraw"…). This module
turns those ids into named, linkable records and finds the other events of
the same request, job, order or dispute, so expanding a row explains it.
"""
from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import HTTPException

from src.models.log_entry import LogEntry

from .entities import EntityIndex, Ref, unique

# metadata key → (entity kind, role shown next to it)
_ID_KEYS: dict[str, tuple[str, str | None]] = {
    "order_id": ("order", None),
    "dispute_id": ("dispute", None),
    "account_id": ("account", None),
    "seller_id": ("account", "người bán"),
    "buyer_id": ("account", "người mua"),
    "affiliate_id": ("account", "affiliate"),
    "referrer_id": ("account", "người giới thiệu"),
    "target_account_id": ("account", None),
    "provider_id": ("provider", None),
    "product_id": ("product", None),
    "variant_id": ("variant", None),
    "resource_id": ("resource", None),
    "replacement_resource_id": ("resource", "tài nguyên thay thế"),
    "withdraw_id": ("withdrawal", None),
    "withdraw_request_id": ("withdrawal", None),
    "intent_id": ("deposit", None),
    "deposit_id": ("deposit", None),
    "wallet_id": ("wallet", None),
}
_SUBJECT_KINDS = {
    "account": "account", "seller": "account", "buyer": "account", "user": "account",
    "order": "order", "dispute": "dispute", "provider": "provider", "product": "product",
    "variant": "variant", "resource": "resource", "withdraw": "withdrawal", "withdrawal": "withdrawal",
    "withdraw_request": "withdrawal", "deposit": "deposit", "deposit_intent": "deposit", "wallet": "wallet",
}
_SYSTEM_ACTORS = {"system", "job", "scheduler", "webhook", "gateway"}
# Account filter: any of these metadata keys naming the account.
_ACCOUNT_KEYS = ("actor_id", "account_id", "seller_id", "buyer_id", "target_account_id")


def _int(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _actor(meta: dict) -> tuple[str, int] | None:
    aid = _int(meta.get("actor_id"))
    if aid is None or str(meta.get("actor_type") or "").lower() in _SYSTEM_ACTORS:
        return None
    return ("account", aid)


def _pairs(meta: dict) -> list[tuple[str, int, str | None]]:
    out: list[tuple[str, int, str | None]] = []
    subject_kind = _SUBJECT_KINDS.get(str(meta.get("subject_type") or "").lower())
    subject_id = _int(meta.get("subject_id"))
    if subject_kind and subject_id:
        out.append((subject_kind, subject_id, "đối tượng"))
    for key, (kind, role) in _ID_KEYS.items():
        ident = _int(meta.get(key))
        if ident:
            out.append((kind, ident, role))
    return out


async def enrich(db: AsyncSession, rows: list[LogEntry]) -> list[dict]:
    metas = {r.id: (r.metadata_ or {}) for r in rows}
    wanted = []
    for meta in metas.values():
        wanted += [(k, i) for k, i, _ in _pairs(meta)]
        actor = _actor(meta)
        if actor:
            wanted.append(actor)
    index = await EntityIndex().load(db, wanted)

    out = []
    for row in rows:
        meta = metas[row.id]
        actor = _actor(meta)
        actor_ref = index.account(actor[1], "người thực hiện") if actor else None
        refs: list[Ref | None] = [index.ref(k, i, role) for k, i, role in _pairs(meta)]
        # An order event also names its open dispute case, when there is one.
        oid = _int(meta.get("order_id"))
        if oid and str(meta.get("event", "")).startswith("dispute"):
            refs.append(index.dispute_of_order(oid))
        refs = [r for r in unique(refs) if not (actor_ref and r.kind == "account" and r.id == actor_ref.id)]
        out.append({
            "id": row.id,
            "service": row.service,
            "level": row.level,
            "request_id": row.request_id,
            "job_id": row.job_id,
            "message": row.message,
            "metadata": row.metadata_,
            "created_at": row.created_at,
            "actor": actor_ref.as_dict() if actor_ref else None,
            "refs": [r.as_dict() for r in refs],
        })
    return out


def account_clause(account_id: int):
    value = str(account_id)
    return or_(*(LogEntry.metadata_[k].as_string() == value for k in _ACCOUNT_KEYS),
               (LogEntry.metadata_["subject_id"].as_string() == value)
               & LogEntry.metadata_["subject_type"].as_string().in_(("account", "seller", "buyer", "user")))


def json_equals(key: str, value) -> object:
    return LogEntry.metadata_[key].as_string() == str(value)


async def related(db: AsyncSession, log_id: int, *, limit: int = 40) -> list[dict]:
    """Events that belong to the same story as one log row: the same request
    or job, or the same order/dispute/withdrawal."""
    row = await db.get(LogEntry, log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy sự kiện")
    meta = row.metadata_ or {}
    clauses = []
    if row.request_id:
        clauses.append(LogEntry.request_id == row.request_id)
    if row.job_id:
        clauses.append(LogEntry.job_id == row.job_id)
    for key in ("order_id", "dispute_id", "withdraw_id", "intent_id"):
        ident = _int(meta.get(key))
        if ident:
            clauses.append(json_equals(key, ident))
    if not clauses:
        return []
    rows = list((await db.execute(
        select(LogEntry).where(or_(*clauses), LogEntry.id != log_id)
        .order_by(LogEntry.created_at.desc(), LogEntry.id.desc()).limit(limit)
    )).scalars())
    rows.reverse()
    return await enrich(db, rows)

