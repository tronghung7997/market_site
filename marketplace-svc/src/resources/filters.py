"""One filter vocabulary for a seller's stock lines.

The package stock table, its "select all matching" bulk actions, the
per-package export and the multi-package export all narrow stock lines the
same way, so they share `ResourceFilter`: build it once (from query params via
`resource_filter_params`, or from a request body) and apply `clauses()`.
A new surface that lists or exports stock lines takes the same filter instead
of growing its own parameter set.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from fastapi import Query
from sqlalchemy import or_, select

from src.i18n.search_text import as_row_id
from src.models.order import Order
from src.models.stock_batch import StockBatch
from src.models.resource import (
    SELLER_RESOURCE_STATUSES, Resource, resource_data_hash, resource_search_key, seller_status_clause,
)
from src.orders.codes import parse_order_ref

ArchivedMode = Literal["exclude", "include", "only"]
# "none", a batch public key, or (legacy links) an all-digit batch row id.
BATCH_PATTERN = r"^(none|\d+|[0-9a-z]{4,12})$"


def _content_match(term: str):
    """Content is encrypted, so search is exact: the first `|` field (username /
    UID / licence key, case-insensitive) or a whole pasted line, both through
    keyed digests."""
    key = resource_search_key(term)
    if not key:
        return None
    return or_(Resource.data_lookup == key, Resource.data_hash == resource_data_hash(term))


def resource_search_clause(search: str | None):
    """Search box semantics: an order code (`ORD-…`, `#ORD-…`), `#<order row id>`,
    a short number (line or order row id), else exact content."""
    if not search or not search.strip():
        return None
    q = search.strip()
    if q.startswith("#") and q[1:].isdigit():
        order_id = as_row_id(q[1:])
        return Resource.order_id == order_id if order_id is not None else Resource.id == -1
    if q.isdigit():
        # A long number (a Facebook UID…) is account data, not a row id.
        n = as_row_id(q)
        if n is None:
            return _content_match(q)
        return or_(Resource.id == n, Resource.order_id == n, _content_match(q))
    parsed = parse_order_ref(q.lstrip("#"))
    if parsed is not None and parsed[0] == "code":
        # Sellers see order codes, so "#ORD-…" / "ord-…" finds the sold rows.
        return Resource.order_id.in_(select(Order.id).where(Order.order_code == parsed[1]))
    return _content_match(q)


def parse_batch(raw: str | None) -> int | str | None:
    """`none` (stock uploaded without a batch), a batch public key, a legacy
    all-digit batch id, or no filter. An id beyond int32 can match nothing, so
    it becomes an impossible id, not a 500."""
    if not raw:
        return None
    if raw == "none":
        return "none"
    if raw.isdigit():
        batch_id = as_row_id(raw)
        return batch_id if batch_id is not None else -1
    return raw


@dataclass(frozen=True)
class ResourceFilter:
    """Which stock lines: seller statuses (any of), archived handling, the search
    box, restock / delivery windows (`[from, to)`), sold-or-not and batch."""

    statuses: tuple[str, ...] = ()
    archived: ArchivedMode = "exclude"
    search: str | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    assigned_from: datetime | None = None
    assigned_to: datetime | None = None
    has_order: bool | None = None
    # "none", a batch public key, or a legacy batch row id.
    batch: int | str | None = None

    def clauses(self) -> list:
        out: list = []
        if self.archived == "only":
            out.append(Resource.is_archived == True)  # noqa: E712
        elif self.archived == "exclude":
            out.append(Resource.is_archived == False)  # noqa: E712
        if self.statuses:
            out.append(or_(*(seller_status_clause(s) for s in self.statuses)))
        search = resource_search_clause(self.search)
        if search is not None:
            out.append(search)
        if self.created_from is not None:
            out.append(Resource.created_at >= self.created_from)
        if self.created_to is not None:
            out.append(Resource.created_at < self.created_to)
        if self.assigned_from is not None:
            out.append(Resource.assigned_at >= self.assigned_from)
        if self.assigned_to is not None:
            out.append(Resource.assigned_at < self.assigned_to)
        if self.has_order is True:
            out.append(Resource.order_id.is_not(None))
        elif self.has_order is False:
            out.append(Resource.order_id.is_(None))
        if self.batch == "none":
            out.append(Resource.batch_id.is_(None))
        elif isinstance(self.batch, int):
            out.append(Resource.batch_id == self.batch)
        elif isinstance(self.batch, str):
            out.append(Resource.batch_id.in_(select(StockBatch.id).where(StockBatch.public_key == self.batch)))
        return out

    def applied(self) -> list[str]:
        """Names of the filters in use — for audit metadata, which must never
        carry the search text (it can be account data)."""
        names = []
        if self.statuses:
            names.append("statuses")
        if self.archived != "exclude":
            names.append(f"archived:{self.archived}")
        for name in ("search", "created_from", "created_to", "assigned_from", "assigned_to", "batch"):
            if getattr(self, name):
                names.append(name)
        if self.has_order is not None:
            names.append("has_order")
        return names

    @classmethod
    def build(
        cls,
        *,
        status: str | None = None,
        statuses: list[str] | tuple[str, ...] | None = None,
        include_archived: bool = False,
        archived_only: bool = False,
        search: str | None = None,
        created_from: datetime | None = None,
        created_to: datetime | None = None,
        assigned_from: datetime | None = None,
        assigned_to: datetime | None = None,
        has_order: bool | None = None,
        batch: str | int | None = None,
    ) -> ResourceFilter:
        picked = [s for s in (statuses or ()) if s in SELLER_RESOURCE_STATUSES]
        if status and status in SELLER_RESOURCE_STATUSES and status not in picked:
            picked.append(status)
        return cls(
            statuses=tuple(picked),
            archived="only" if archived_only else "include" if include_archived else "exclude",
            search=search.strip() if search and search.strip() else None,
            created_from=created_from, created_to=created_to,
            assigned_from=assigned_from, assigned_to=assigned_to,
            has_order=has_order,
            batch=batch if isinstance(batch, int) else parse_batch(batch),
        )


def resource_filter_params(
    status: Literal["available", "assigned", "error", "returned", "expired"] | None = Query(None),
    statuses: str | None = Query(None, description="Comma-separated seller statuses (any of)"),
    search: str | None = None,
    include_archived: bool = False,
    archived_only: bool = False,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    assigned_from: datetime | None = None,
    assigned_to: datetime | None = None,
    has_order: bool | None = None,
    batch: str | None = Query(None, pattern=BATCH_PATTERN, description="Batch public key, or none for stock without a batch"),
) -> ResourceFilter:
    """FastAPI dependency: the same query parameters on every stock-line endpoint."""
    return ResourceFilter.build(
        status=status,
        statuses=[p.strip() for p in statuses.split(",")] if statuses else None,
        include_archived=include_archived, archived_only=archived_only, search=search,
        created_from=created_from, created_to=created_to,
        assigned_from=assigned_from, assigned_to=assigned_to,
        has_order=has_order, batch=batch,
    )
