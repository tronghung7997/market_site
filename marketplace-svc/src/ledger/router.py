from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account
from src.models.wallet import TransactionType

from . import journal, report, schemas, service

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


# ── Period finance report & close (Tài chính › Báo cáo) — admin only ───────

def _period(
    start: datetime = Query(..., description="Đầu kỳ (ISO, có múi giờ), bao gồm"),
    end: datetime = Query(..., description="Cuối kỳ (ISO, có múi giờ), không bao gồm"),
) -> tuple[datetime, datetime]:
    try:
        report.validate_range(start, end)
    except report.PeriodError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return start, end


@router.get("/admin/finance/report", response_model=schemas.FinanceReport)
async def finance_report(
    period: tuple[datetime, datetime] = Depends(_period),
    compare_start: datetime | None = Query(None),
    compare_end: datetime | None = Query(None),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    if (compare_start is None) != (compare_end is None):
        raise HTTPException(status_code=422, detail="compare_start và compare_end phải đi cùng nhau")
    if compare_start is not None:
        try:
            report.validate_range(compare_start, compare_end)
        except report.PeriodError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    return await report.period_report(db, *period, compare_start=compare_start, compare_end=compare_end)


@router.get("/admin/finance/close-checklist", response_model=schemas.CloseChecklist)
async def finance_close_checklist(
    period: tuple[datetime, datetime] = Depends(_period),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await report.close_checklist(db, *period)


@router.get("/admin/finance/closes", response_model=list[schemas.PeriodCloseRow])
async def finance_closes(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await report.list_closes(db)


@router.post("/admin/finance/closes", response_model=schemas.PeriodCloseRow, status_code=201)
async def finance_close_period(
    body: schemas.ClosePeriodRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        report.validate_range(body.start, body.end)
    except report.PeriodError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        row = await report.close_period(db, body.start, body.end, actor_id=admin.id, note=body.note)
    except report.PeriodError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return report.close_row(row, admin.email)


@router.get("/admin/finance/export.zip")
async def finance_export(
    period: tuple[datetime, datetime] = Depends(_period),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        filename, data = await report.export_package(db, *period)
    except report.PeriodError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    return Response(
        content=data, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )
