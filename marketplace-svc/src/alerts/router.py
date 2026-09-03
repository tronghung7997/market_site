from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["alerts"])


@router.get("/admin/alerts", response_model=list[schemas.AlertResponse])
async def list_alerts(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_active_alerts(db)


@router.post("/admin/alerts/{alert_id}/dismiss", response_model=schemas.AlertResponse)
async def dismiss(alert_id: int, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.dismiss_alert(alert_id, db)


@router.get("/seller/alerts", response_model=list[schemas.AlertResponse])
async def seller_alerts(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.list_seller_alerts(account.id, db)


@router.post("/seller/alerts/{alert_id}/dismiss", response_model=schemas.AlertResponse)
async def dismiss_seller_alert(alert_id: int, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.dismiss_seller_alert(alert_id, account.id, db)


@router.post("/me/alerts/{alert_id}/dismiss", response_model=schemas.AlertResponse)
async def dismiss_own_alert(alert_id: int, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.dismiss_own_alert(alert_id, account.id, db)
