from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import admin_view, schemas, service

router = APIRouter(tags=["alerts"])


@router.get("/admin/alerts", response_model=list[schemas.AdminAlertResponse])
async def list_alerts(
    status: str = Query("open", pattern="^(open|resolved)$"),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await admin_view.admin_alerts(db, status=status)


@router.post("/admin/alerts/resolve", response_model=list[schemas.AdminAlertResponse])
async def resolve_many(
    body: schemas.AlertBulkResolveRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await admin_view.resolve_alerts(db, body.ids, admin=admin, note=body.note)


@router.post("/admin/alerts/{alert_id}/resolve", response_model=schemas.AdminAlertResponse)
async def resolve_one(
    alert_id: int,
    body: schemas.AlertResolveRequest | None = None,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return (await admin_view.resolve_alerts(db, [alert_id], admin=admin, note=body.note if body else None))[0]


# Kept for the notification bell and older clients: same as resolve without a note.
@router.post("/admin/alerts/{alert_id}/dismiss", response_model=schemas.AdminAlertResponse)
async def dismiss(alert_id: int, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return (await admin_view.resolve_alerts(db, [alert_id], admin=admin, note=None))[0]


@router.post("/admin/alerts/{alert_id}/reopen", response_model=schemas.AdminAlertResponse)
async def reopen(alert_id: int, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await admin_view.reopen_alert(db, alert_id, admin=admin)


@router.get("/seller/alerts", response_model=list[schemas.AlertResponse])
async def seller_alerts(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.list_seller_alerts(account.id, db)


@router.post("/seller/alerts/{alert_id}/dismiss", response_model=schemas.AlertResponse)
async def dismiss_seller_alert(alert_id: int, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.dismiss_seller_alert(alert_id, account.id, db)


@router.post("/me/alerts/{alert_id}/dismiss", response_model=schemas.AlertResponse)
async def dismiss_own_alert(alert_id: int, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.dismiss_own_alert(alert_id, account.id, db)
