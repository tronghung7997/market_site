from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.database import get_session
from src.models.account import Account

from . import dashboard, schemas, service

router = APIRouter(tags=["seller"])


@router.post("/seller/apply", response_model=schemas.SellerApplicationResponse, status_code=status.HTTP_201_CREATED)
async def apply(body: schemas.SellerApplyRequest, account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.apply_for_seller(account, body.business_name, body.description, body.contact, db)


@router.get("/seller/applications/me", response_model=schemas.SellerApplicationResponse | None)
async def my_application(account: Account = Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    return await service.get_latest_application(account.id, db)


@router.get("/admin/seller-applications", response_model=list[schemas.SellerApplicationResponse])
async def list_apps(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.list_applications(db)


@router.post("/admin/seller-applications/{app_id}/approve", response_model=schemas.SellerApplicationResponse)
async def approve(
    app_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.approve_application(app_id, db, actor_id=admin.id)


@router.post("/admin/seller-applications/{app_id}/reject", response_model=schemas.SellerApplicationResponse)
async def reject(
    app_id: int,
    body: schemas.RejectRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.reject_application(app_id, body.reason, db, actor_id=admin.id)


@router.get("/seller/dashboard", response_model=schemas.SellerDashboardResponse)
async def seller_dashboard(
    range: str = Query("30d", pattern="^(7d|30d|90d|custom)$"),
    tz: str = Query("UTC", max_length=64),
    from_date: date | None = Query(None, alias="from"),
    to_date: date | None = Query(None, alias="to"),
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    rng = dashboard.resolve_range(range, tz, from_date, to_date)
    return await dashboard.get_seller_dashboard(account.id, rng, db)
