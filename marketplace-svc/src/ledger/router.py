from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["ledger"])


@router.get("/admin/ledger/reconcile-runs", response_model=list[schemas.LedgerRunResponse])
async def list_runs(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_runs(db)


@router.post("/admin/ledger/reconcile-runs", response_model=schemas.LedgerRunResponse, status_code=201)
async def run_now(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.run_and_record(db, trigger="manual")
