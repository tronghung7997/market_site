from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account
from src.models.wallet import TransactionType

from . import journal, schemas, service

router = APIRouter(tags=["ledger"])


@router.get("/admin/ledger/reconcile-runs", response_model=list[schemas.LedgerRunResponse])
async def list_runs(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_runs(db)


@router.post("/admin/ledger/reconcile-runs", response_model=schemas.LedgerRunResponse, status_code=201)
async def run_now(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.run_and_record(db, trigger="manual")


# ── Money journal (Tài chính › Dòng tiền) — read-only, admin only ──────────

def _journal_filters(
    start: datetime | None = Query(None, description="Từ thời điểm (ISO, có múi giờ), bao gồm"),
    end: datetime | None = Query(None, description="Đến thời điểm (ISO, có múi giờ), không bao gồm"),
    direction: Literal["in", "out", "neutral"] | None = Query(None),
    types: list[TransactionType] = Query(default_factory=list, alias="type"),
    role: Literal["buyer", "seller", "platform"] | None = Query(None),
    account_id: int | None = Query(None, ge=1),
    group: str | None = Query(None, pattern=journal.GROUP_KEY.pattern),
    amount: int | None = Query(None, ge=1),
    entry_id: int | None = Query(None, ge=1),
) -> journal.EntryFilters:
    for value in (start, end):
        if value is not None and value.tzinfo is None:
            raise HTTPException(status_code=422, detail="start/end cần có múi giờ")
    if start is not None and end is not None and end <= start:
        raise HTTPException(status_code=422, detail="end phải sau start")
    return journal.EntryFilters(
        start=start, end=end, direction=direction, types=types, role=role,
        account_id=account_id, group=group, amount=amount, entry_id=entry_id,
    )


@router.get("/admin/ledger/entries", response_model=schemas.JournalPage)
async def journal_entries(
    filters: journal.EntryFilters = Depends(_journal_filters),
    cursor: str | None = Query(None, max_length=80),
    limit: int = Query(50, ge=1, le=journal.MAX_PAGE),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await journal.list_entries(db, filters, cursor=cursor, limit=limit)
    except journal.JournalError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/admin/ledger/summary", response_model=schemas.JournalSummary)
async def journal_summary(
    filters: journal.EntryFilters = Depends(_journal_filters),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await journal.summarize(db, filters)


@router.get("/admin/ledger/accounts/{account_id}/statement", response_model=schemas.JournalStatement)
async def journal_statement(
    account_id: int,
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    if (start is not None and start.tzinfo is None) or (end is not None and end.tzinfo is None):
        raise HTTPException(status_code=422, detail="start/end cần có múi giờ")
    result = await journal.account_statement(db, account_id, start=start, end=end)
    if result is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    return result


@router.get("/admin/ledger/groups/{key}", response_model=schemas.JournalGroup)
async def journal_group(
    key: str,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await journal.reference_group(db, key)
    except journal.JournalError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/admin/ledger/search", response_model=list[schemas.JournalSuggestion])
async def journal_search(
    q: str = Query(..., min_length=1, max_length=120),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await journal.resolve_search(db, q)
