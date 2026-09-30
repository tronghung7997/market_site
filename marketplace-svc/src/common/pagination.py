"""Shared list pagination: offset pages and keyset cursors.

Offset pages (``paginate``) suit admin tables with a total and page numbers.
Keyset cursors (``encode_cursor`` / ``decode_cursor`` / ``keyset_after``) suit
infinite lists whose rows move while the reader scrolls (a support inbox):
the cursor carries the last row's sort value and id, so a new row at the top
never shifts or repeats the next page.
"""
from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

MAX_PER_PAGE = 100


@dataclass(frozen=True)
class PageParams:
    page: int = 1
    per_page: int = 20

    @property
    def offset(self) -> int:
        return (max(1, self.page) - 1) * self.per_page


def page_params(page: int | None, per_page: int | None, *, default: int = 20, maximum: int = MAX_PER_PAGE) -> PageParams:
    """Clamp raw query values into a valid page."""
    size = default if not per_page else max(1, min(int(per_page), maximum))
    return PageParams(page=max(1, int(page or 1)), per_page=size)


async def paginate(
    db: AsyncSession, stmt: Select, params: PageParams, *, scalars: bool = True,
    transform: Callable[[list], list] | None = None,
) -> dict:
    """Run ``stmt`` (already filtered and ordered) as one page.

    Returns ``{items, total, page, per_page}``. ``scalars=False`` keeps row
    tuples for multi-entity selects; ``transform`` maps the page's rows to
    response items (it may batch-load related data for just this page).
    """
    total = int(await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)
    result = await db.execute(stmt.limit(params.per_page).offset(params.offset))
    rows = list(result.scalars()) if scalars else list(result.all())
    items = transform(rows) if transform else rows
    return {"items": items, "total": total, "page": params.page, "per_page": params.per_page}


# ── Keyset cursors ───────────────────────────────────────────────────────────

def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return {"t": value.isoformat()}
    return value


def _restore(value: Any) -> Any:
    if isinstance(value, dict) and "t" in value:
        return datetime.fromisoformat(value["t"])
    return value


def encode_cursor(sort_value: Any, row_id: Any) -> str:
    raw = json.dumps([_jsonable(sort_value), str(row_id)], separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> tuple[Any, str] | None:
    """(sort value, id as text) or None for a missing/garbled cursor (first page)."""
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        sort_value, row_id = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
        return _restore(sort_value), str(row_id)
    except (ValueError, TypeError):
        return None


def keyset_after(sort_col, id_col, cursor: tuple[Any, Any] | None, *, descending: bool, nulls_last: bool = True):
    """WHERE clause for rows strictly after ``cursor`` in the order
    ``sort_col {ASC|DESC} NULLS LAST, id_col {same}``. None when no cursor."""
    if cursor is None:
        return None
    value, row_id = cursor
    if value is None:
        # Already in the NULL tail: only the id tie-break remains.
        return and_(sort_col.is_(None), id_col < row_id if descending else id_col > row_id)
    beyond = sort_col < value if descending else sort_col > value
    clause = or_(beyond, and_(sort_col == value, id_col < row_id if descending else id_col > row_id))
    if nulls_last:
        clause = or_(clause, sort_col.is_(None))
    return clause
