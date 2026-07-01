from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session

from . import schemas, service
from .dependencies import get_current_account

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
