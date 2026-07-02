from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.models.account import Account

from . import schemas, service
from .dependencies import get_current_account, require_role

router = APIRouter(tags=["auth"])


@router.post("/auth/register", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED)
async def register(body: schemas.RegisterRequest, db: AsyncSession = Depends(get_session)):
    account = await service.register_account(body.email, body.password, db, referral_code=body.referral_code)
    return account


@router.post("/auth/login", response_model=schemas.TokenResponse)
async def login(body: schemas.LoginRequest, db: AsyncSession = Depends(get_session)):
    account = await service.authenticate(body.email, body.password, db)
    token = service.create_access_token(account.id, account.roles)
    return schemas.TokenResponse(access_token=token)


@router.post("/auth/refresh", response_model=schemas.TokenResponse)
async def refresh(account=Depends(get_current_account)):
    token = service.create_access_token(account.id, account.roles)
    return schemas.TokenResponse(access_token=token)


@router.get("/me", response_model=schemas.AccountResponse)
async def me(account=Depends(get_current_account)):
    return account


@router.get("/admin/accounts", response_model=schemas.PaginatedAccounts)
async def admin_list_accounts(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    return await service.list_accounts(db, search=search, page=page, per_page=per_page)


@router.patch("/admin/accounts/{account_id}/roles", response_model=schemas.AccountAdminRow)
async def admin_update_roles(
    account_id: int,
    body: schemas.UpdateRolesRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_roles(account_id, body.roles, admin.id, db)
