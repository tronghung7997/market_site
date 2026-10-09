"""Config sections that go through two-step approval.

A section is one admin settings form backed by its owning module's update
function (``update_fee_settings``, ``update_site_status``, …). The approval
service never re-implements a section's rules: it calls that same function
with ``dry_run=True`` inside a savepoint to validate a proposal and read the
values it would produce, and calls it for real when a second admin approves.

Registering a new section (one call, usually in ``sections.py``)::

    register(ConfigSection(
        key="ops_bot",                       # stable id stored on requests
        label="Bot vận hành",                # shown in the approval inbox
        audit_event="ops_bot_config_changed",  # the section's own audit event
        href="/admin/display-settings?tab=opsBot",
        apply=_apply_ops_bot,                # (db, actor_id, changes, dry_run) -> result
        snapshot=_snapshot_ops_bot,          # (db) -> {field: value}, read from the row
        parse=parse_with(OpsBotConfigUpdate),  # JSON payload -> kwargs for apply
    ))

``apply`` must validate exactly like the HTTP path did before (raise
``ValueError`` or ``HTTPException``), stage the change on the row, and return
early when ``dry_run`` is true — before it writes audit rows or commits.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Awaitable, Callable

from pydantic import BaseModel
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession

ApplyFn = Callable[[AsyncSession, int, dict, bool], Awaitable[Any]]
SnapshotFn = Callable[[AsyncSession], Awaitable[dict]]
ParseFn = Callable[[dict], dict]
SplitFn = Callable[[dict], tuple[dict, dict]]
ContextFn = Callable[[AsyncSession, dict], Awaitable[dict]]

# Columns that change on every save and say nothing about the settings.
BOOKKEEPING_COLUMNS = frozenset({"id", "updated_at", "updated_by_id", "created_at"})


def parse_with(schema: type[BaseModel]) -> ParseFn:
    """Stored JSON payload → the keyword arguments the update function takes
    (datetimes and other types restored; "sent as null" kept apart from "not sent")."""

    def parse(payload: dict) -> dict:
        return schema.model_validate(payload).model_dump(exclude_unset=True)

    return parse


@dataclass(frozen=True)
class ConfigSection:
    key: str
    label: str
    audit_event: str
    href: str
    apply: ApplyFn
    snapshot: SnapshotFn
    parse: ParseFn = dict
    # Fields applied at once even while approval is on (and audit-flagged).
    immediate_fields: frozenset[str] = frozenset()
    # True: the immediate fields are an emergency path (maintenance, freezes).
    emergency: bool = False
    # Snapshot/diff is {row: {field: value}} (one row per tier) instead of flat.
    nested: bool = False
    # Custom payload split for nested payloads; default splits on immediate_fields.
    split: SplitFn | None = None
    # Extra display context frozen on the request (e.g. category names).
    context: ContextFn | None = None
    # Snapshot that includes the immediate fields, when `snapshot` leaves them
    # out; used to tell a real flip from a form resending current values.
    immediate_snapshot: SnapshotFn | None = None

    def split_payload(self, payload: dict) -> tuple[dict, dict]:
        """(applied now, needs approval)."""
        if self.split is not None:
            return self.split(payload)
        immediate = {k: v for k, v in payload.items() if k in self.immediate_fields}
        gated = {k: v for k, v in payload.items() if k not in self.immediate_fields}
        return immediate, gated

    def diff(self, before: dict, after: dict) -> dict:
        if not self.nested:
            return flat_diff(before, after)
        out: dict = {}
        for row in sorted(set(before) | set(after)):
            d = flat_diff(before.get(row) or {}, after.get(row) or {})
            if d:
                out[row] = d
        return out


_REGISTRY: dict[str, ConfigSection] = {}


def register(section: ConfigSection) -> ConfigSection:
    if section.key in _REGISTRY:
        raise ValueError(f"config section {section.key!r} registered twice")
    if len(section.key) > 48:
        raise ValueError("config section key is limited to 48 characters")
    _REGISTRY[section.key] = section
    return section


def get_section(key: str) -> ConfigSection | None:
    return _REGISTRY.get(key)


def all_sections() -> list[ConfigSection]:
    return list(_REGISTRY.values())


# ── snapshot helpers ────────────────────────────────────────────────────────

def jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


def _blank_to_none(value: Any) -> Any:
    # An empty text field reads the same whether the column holds NULL or "".
    return None if value == "" else value


def row_values(row: Any, *, skip: frozenset[str] | set[str] = frozenset()) -> dict:
    """Every mapped column of a config row as JSON-ready values."""
    if row is None:
        return {}
    excluded = BOOKKEEPING_COLUMNS | set(skip)
    return {
        attr.key: _blank_to_none(jsonable(getattr(row, attr.key)))
        for attr in inspect(type(row)).column_attrs
        if attr.key not in excluded
    }


async def fresh(db: AsyncSession, model: type, ident: Any = 1) -> Any:
    """The row as stored now (or as flushed in this transaction), never the
    identity-map copy and never a process cache."""
    return await db.get(model, ident, populate_existing=True)


def flatten(doc: dict, prefix: str = "") -> dict:
    """{"score": {"gmv": {"points": 30}}} → {"score.gmv.points": 30}."""
    out: dict = {}
    for key, value in (doc or {}).items():
        path = f"{prefix}{key}"
        if isinstance(value, dict) and value:
            out.update(flatten(value, f"{path}."))
        else:
            out[path] = jsonable(value)
    return out


def flat_diff(before: dict, after: dict) -> dict:
    return {
        k: [before.get(k), after.get(k)]
        for k in sorted(set(before) | set(after))
        if before.get(k) != after.get(k)
    }


def version_of(snapshot: dict) -> str:
    canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass
class SubmitOutcome:
    """What a settings save did: `result` is the update function's return
    value when something was applied now (approval off, or emergency fields),
    `request` the serialized pending request when one was created."""
    result: Any = None
    request: dict | None = None
    applied_fields: list[str] = field(default_factory=list)
