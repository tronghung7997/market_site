"""CSV export helpers shared by admin/seller download endpoints.

Every cell goes through ``csv_safe`` so a value typed by a user (an email, a
note) cannot become a spreadsheet formula. ``csv_response`` streams rows with
a UTF-8 BOM so Excel opens Vietnamese text correctly.
"""
from __future__ import annotations

import csv
import io
from collections.abc import AsyncIterable, Iterable
from datetime import datetime

from fastapi.responses import StreamingResponse

_FORMULA_PREFIXES = "=+-@\t\r"
BOM = "﻿"


def csv_safe(value) -> str | int | float:
    """Neutralise formula injection; numbers pass through unchanged."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value)
    return f"'{text}" if text and text[0] in _FORMULA_PREFIXES else text


def csv_lines(rows: Iterable[Iterable]) -> str:
    buffer = io.StringIO()
    csv.writer(buffer, lineterminator="\r\n").writerows([[csv_safe(cell) for cell in row] for row in rows])
    return buffer.getvalue()


def csv_document(header: list[str], rows: Iterable[Iterable], *, bom: bool = False) -> str:
    return (BOM if bom else "") + csv_lines([header]) + csv_lines(rows)


def csv_response(header: list[str], rows: Iterable[Iterable] | AsyncIterable[Iterable], filename: str) -> StreamingResponse:
    """Stream ``rows`` (sync or async iterable) as an attachment."""

    async def body():
        yield BOM + csv_lines([header])
        if hasattr(rows, "__aiter__"):
            async for row in rows:  # type: ignore[union-attr]
                yield csv_lines([row])
        else:
            chunk: list = []
            for row in rows:  # type: ignore[union-attr]
                chunk.append(row)
                if len(chunk) >= 500:
                    yield csv_lines(chunk)
                    chunk = []
            if chunk:
                yield csv_lines(chunk)

    return StreamingResponse(
        body(), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )
