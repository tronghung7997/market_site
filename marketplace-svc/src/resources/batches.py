"""Stock batches ("lô"): the format line and login notes each upload carries.

A seller uploads stock as batches. The first line of a paste or file is the
batch's format (column names, `|`-separated like the lines) and an optional
`#` line under it says how to sign in; the console sends both with the lines
(`format`, `login_note`) or appends to a batch it already created (`batch_id`).
Buyers see a batch's format and notes above the lines of it they received,
one block per batch when an order holds lines of several.

A batch whose lines were already sold is never edited in place: the unsold
lines move to an edited copy, so an order keeps the format it was sold with.
Stock uploaded before batches existed has no batch; its seller can give it a
format later (`assign_format`), which makes a new batch of those lines.
"""
from collections.abc import AsyncIterator

from fastapi import status
from sqlalchemy import Text, and_, func, select, type_coerce, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.database import SessionLocal, id_in
from src.exceptions import ErrorCode, NotOwner, api_error
from src.logging import current_request_id
from src.models.product import Product, ProductVariant
from src.models.resource import Resource, ResourceStatus, read_stored_text
from src.models.stock_batch import STOCK_FORMAT_MAX_LENGTH, STOCK_NOTE_MAX_LENGTH, StockBatch

# Lines per decrypt round when a batch is downloaded.
BATCH_EXPORT_ROWS = 100


def clean_format(value: str) -> tuple[str, int]:
    """(format, field count) of a format line. One line of column names."""
    text = (value or "").strip()
    if not text or "\n" in text or "\r" in text or len(text) > STOCK_FORMAT_MAX_LENGTH:
        raise api_error(ErrorCode.STOCK_FORMAT_INVALID, status.HTTP_422_UNPROCESSABLE_CONTENT)
    return text, text.count("|") + 1


def clean_note(value: str | None) -> str | None:
    """Login notes on one line (they follow the format as a `#` line in files)."""
    if value is None:
        return None
    text = " ".join(value.strip().lstrip("#").split())
    return text[:STOCK_NOTE_MAX_LENGTH] or None


def batch_view(batch: StockBatch) -> dict:
    return {
        "id": batch.id, "format": batch.format, "field_count": batch.field_count,
        "login_note": batch.login_note, "source": batch.source, "created_at": batch.created_at,
    }


def header_lines(format_line: str | None, login_note: str | None) -> str:
    """The lines a batch's block starts with in files: its format, then `# notes`."""
    if not format_line:
        return ""
    return f"{format_line}\n" + (f"# {login_note}\n" if login_note else "")


async def _owned_variant(variant_id: int, seller_id: int, db: AsyncSession) -> ProductVariant:
    variant = await db.get(ProductVariant, variant_id)
    if not variant:
        raise api_error(ErrorCode.VARIANT_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    product = await db.get(Product, variant.product_id)
    if not product or product.seller_id != seller_id:
        raise NotOwner()
    return variant


async def owned_batch(batch_id: int, seller_id: int, db: AsyncSession, *, variant_id: int | None = None) -> StockBatch:
    batch = await db.get(StockBatch, batch_id)
    if batch is None or batch.seller_id != seller_id or (variant_id is not None and batch.variant_id != variant_id):
        raise api_error(ErrorCode.STOCK_BATCH_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return batch


async def new_batch(
    db: AsyncSession, *, variant_id: int, seller_id: int, actor_id: int | None,
    format_line: str, login_note: str | None, source: str = "upload",
) -> StockBatch:
    """Flushes (the caller commits), so the id is known."""
    text, fields = clean_format(format_line)
    batch = StockBatch(
        variant_id=variant_id, seller_id=seller_id, format=text, field_count=fields,
        login_note=clean_note(login_note), source=source, created_by_id=actor_id,
    )
    db.add(batch)
    await db.flush()
    return batch


def _in_stock(*clauses):
    """Unsold, listed lines: what a batch edit moves and a download contains."""
    return and_(Resource.order_id.is_(None), Resource.is_archived == False, *clauses)  # noqa: E712


async def list_batches(variant_id: int, seller_id: int, db: AsyncSession) -> dict:
    """The package's batches with their stock counts (newest first, empty ones
    left out), and the stock that has no batch yet grouped by field count."""
    await _owned_variant(variant_id, seller_id, db)
    available = and_(Resource.status == ResourceStatus.available, _in_stock())
    rows = (await db.execute(
        select(
            StockBatch,
            func.count(Resource.id).filter(available),
            func.count(Resource.id).filter(Resource.order_id.is_not(None)),
            func.count(Resource.id).filter(available, Resource.field_count != StockBatch.field_count),
            func.count(Resource.id),
        )
        .join(Resource, Resource.batch_id == StockBatch.id)
        .where(StockBatch.variant_id == variant_id, StockBatch.seller_id == seller_id)
        .group_by(StockBatch.id)
        .order_by(StockBatch.created_at.desc(), StockBatch.id.desc())
    )).all()
    legacy = (await db.execute(
        select(Resource.field_count, func.count(Resource.id))
        .where(Resource.variant_id == variant_id, Resource.batch_id.is_(None), _in_stock())
        .group_by(Resource.field_count)
        .order_by(func.count(Resource.id).desc())
    )).all()
    return {
        "batches": [
            {**batch_view(batch), "available": avail, "sold": sold, "mismatched": mismatched, "total": total}
            for batch, avail, sold, mismatched, total in rows
        ],
        "unformatted": {
            "in_stock": sum(count for _, count in legacy),
            "by_field_count": [{"field_count": fields or 1, "count": count} for fields, count in legacy],
        },
    }


async def update_batch(
    batch_id: int, seller_id: int, actor_id: int, db: AsyncSession, *,
    format_line: str | None = None, login_note: str | None = None, clear_note: bool = False,
) -> dict:
    """Change a batch's format or notes. A batch with sold lines is split: its
    unsold lines move to an edited copy and the sold ones keep what their
    buyers were shown."""
    batch = await owned_batch(batch_id, seller_id, db)
    text, fields = clean_format(format_line) if format_line is not None else (batch.format, batch.field_count)
    note = None if clear_note else (clean_note(login_note) if login_note is not None else batch.login_note)
    if (text, note) == (batch.format, batch.login_note):
        return batch_view(batch)
    sold = await db.scalar(select(func.count(Resource.id)).where(Resource.batch_id == batch.id, Resource.order_id.is_not(None)))
    target = batch
    if sold:
        target = await new_batch(
            db, variant_id=batch.variant_id, seller_id=seller_id, actor_id=actor_id,
            format_line=text, login_note=note, source="split",
        )
        await db.execute(
            update(Resource).where(Resource.batch_id == batch.id, _in_stock()).values(batch_id=target.id)
            .execution_options(synchronize_session=False)
        )
    else:
        batch.format, batch.field_count, batch.login_note = text, fields, note
    await log_event(
        db, "info", f"Seller edited stock batch #{batch.id}", request_id=current_request_id(),
        metadata={"event": "stock_batch_updated", "actor_id": actor_id, "subject_type": "stock_batch",
                  "subject_id": batch.id, "split_to": target.id if target is not batch else None},
    )
    await db.commit()
    await db.refresh(target)
    return batch_view(target)


async def assign_format(
    variant_id: int, seller_id: int, actor_id: int, db: AsyncSession, *,
    format_line: str, login_note: str | None,
    resource_ids: list[int] | None = None, field_count: int | None = None,
) -> dict:
    """Give unbatched, unsold stock of the package a format: the chosen lines
    (`resource_ids`, or every such line with `field_count` fields) become one
    new batch. Lines already sold keep being shown as they are."""
    await _owned_variant(variant_id, seller_id, db)
    clean_format(format_line)
    scope = [Resource.variant_id == variant_id, Resource.seller_id == seller_id, Resource.batch_id.is_(None), _in_stock()]
    if resource_ids is not None:
        scope.append(id_in(Resource.id, resource_ids))
    elif field_count is not None:
        scope.append(Resource.field_count == field_count)
    count = int(await db.scalar(select(func.count(Resource.id)).where(*scope)) or 0)
    if count == 0:
        return {"batch": None, "count": 0}
    batch = await new_batch(
        db, variant_id=variant_id, seller_id=seller_id, actor_id=actor_id,
        format_line=format_line, login_note=login_note, source="assign",
    )
    await db.execute(update(Resource).where(*scope).values(batch_id=batch.id).execution_options(synchronize_session=False))
    await log_event(
        db, "info", f"Seller gave {count} stock line(s) a format", request_id=current_request_id(),
        metadata={"event": "stock_batch_assigned", "actor_id": actor_id, "subject_type": "stock_batch",
                  "subject_id": batch.id, "variant_id": variant_id, "count": count},
    )
    await db.commit()
    return {"batch": batch_view(batch), "count": count}


async def batches_by_id(batch_ids: set[int], db: AsyncSession) -> list[dict]:
    if not batch_ids:
        return []
    rows = (await db.execute(select(StockBatch).where(id_in(StockBatch.id, list(batch_ids))))).scalars()
    return [
        {"id": b.id, "format": b.format, "field_count": b.field_count, "login_note": b.login_note}
        for b in rows
    ]


async def order_batches(order_id: int, db: AsyncSession) -> list[dict]:
    """Format and notes of every batch the order's lines came from."""
    ids = set((await db.scalars(
        select(Resource.batch_id).where(Resource.order_id == order_id, Resource.batch_id.is_not(None)).distinct()
    )).all())
    return await batches_by_id(ids, db)


async def export_batch(batch_id: int, seller_id: int, db: AsyncSession) -> tuple[StockBatch, AsyncIterator[bytes]]:
    """The batch's unsold lines as a file that uploads again as it is: the
    format line, its `#` notes, then one line per account."""
    batch = await owned_batch(batch_id, seller_id, db)
    head = header_lines(batch.format, batch.login_note)
    scope = [Resource.batch_id == batch.id, Resource.status == ResourceStatus.available, _in_stock()]

    async def generate() -> AsyncIterator[bytes]:
        yield head.encode()
        after = 0
        while True:
            async with SessionLocal() as session:
                rows = (await session.execute(
                    select(Resource.id, type_coerce(Resource.data, Text))
                    .where(*scope, Resource.id > after).order_by(Resource.id).limit(BATCH_EXPORT_ROWS)
                )).all()
            if not rows:
                return
            yield "".join(f"{read_stored_text(stored)}\n" for _, stored in rows).encode()
            after = rows[-1][0]

    return batch, generate()

