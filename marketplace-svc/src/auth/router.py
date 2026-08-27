import hashlib

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.models.account import Account
from src.config import settings
from src.rate_limit import check_rate_limit
from src.security.events import security_event

from . import schemas, service, sessions
from .dependencies import get_current_account, require_role

router = APIRouter(tags=["auth"])


def _peer_ip(request: Request) -> str:
    # Do not trust spoofable forwarding headers here. The edge limiter should
    # use the verified client IP; this application bucket uses the TCP peer.
    return request.client.host if request.client else "unknown"


def _email_bucket(email: str) -> str:
    normalized = email.strip().casefold().encode()
    return hashlib.sha256(normalized).hexdigest()


async def _enforce_auth_limit(key: str, limit: int) -> None:
    if not settings.auth_rate_limit_enabled:
        return
    allowed = await check_rate_limit(
        key,
        limit=limit,
        window_seconds=settings.auth_rate_limit_window_seconds,
        fail_open=False,
    )
    if not allowed:
        security_event(
            "auth_rate_limited",
            bucket_type=":".join(key.split(":")[1:3]),
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Quá nhiều yêu cầu, vui lòng thử lại sau",
            headers={"Retry-After": str(settings.auth_rate_limit_window_seconds)},
        )


async def _authenticate_with_limits(
    body: schemas.LoginRequest,
    request: Request,
    db: AsyncSession,
) -> Account:
    await _enforce_auth_limit(f"auth:login:ip:{_peer_ip(request)}", settings.auth_login_ip_limit)
    await _enforce_auth_limit(
        f"auth:login:account:{_email_bucket(body.email)}",
        settings.auth_login_account_limit,
    )
    return await service.authenticate(body.email, body.password, db)


@router.post("/auth/register", response_model=schemas.AccountResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: schemas.RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    await _enforce_auth_limit(
        f"auth:register:ip:{_peer_ip(request)}",
        settings.auth_register_ip_limit,
    )
    account = await service.register_account(
        body.email,
        body.password,
        db,
        referral_code=body.referral_code,
        registration_ip=_peer_ip(request),
    )
    return account


@router.post("/auth/login", response_model=schemas.TokenResponse)
async def login(
    body: schemas.LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    account = await _authenticate_with_limits(body, request, db)
    if "admin" in account.roles:
        raise api_error(ErrorCode.ADMIN_LOGIN_REQUIRED, status.HTTP_403_FORBIDDEN)
    issued = await sessions.issue_session(account, db)
    return schemas.TokenResponse(access_token=issued.access_token, refresh_token=issued.refresh_token)


@router.post("/auth/admin/login", response_model=schemas.TokenResponse)
async def admin_login(
    body: schemas.LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    account = await _authenticate_with_limits(body, request, db)
    if "admin" not in account.roles:
        security_event(
            "admin_login_rejected",
            level="warning",
            account_id=account.id,
            reason="admin_role_required",
        )
        raise api_error(ErrorCode.ADMIN_ONLY, status.HTTP_403_FORBIDDEN)
    issued = await sessions.issue_session(account, db)
    return schemas.TokenResponse(access_token=issued.access_token, refresh_token=issued.refresh_token)


@router.post("/auth/forgot-password", response_model=schemas.PasswordResetAck)
async def forgot_password(
    body: schemas.ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    await _enforce_auth_limit(
        f"auth:forgot:ip:{_peer_ip(request)}",
        settings.auth_forgot_ip_limit,
    )
    await _enforce_auth_limit(
        f"auth:forgot:account:{_email_bucket(body.email)}",
        settings.auth_forgot_account_limit,
    )
    message = await service.request_password_reset(body.email, body.locale, db)
    return schemas.PasswordResetAck(message=message)


@router.post("/auth/reset-password", response_model=schemas.PasswordResetAck)
async def reset_password(
    body: schemas.ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    await _enforce_auth_limit(
        f"auth:reset:ip:{_peer_ip(request)}",
        settings.auth_reset_ip_limit,
    )
    message = await service.reset_password(body.token, body.password, db)
    return schemas.PasswordResetAck(message=message)


@router.post("/auth/refresh", response_model=schemas.TokenResponse)
async def refresh(
    body: schemas.RefreshRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    await _enforce_auth_limit(
        f"auth:refresh:ip:{_peer_ip(request)}",
        settings.auth_refresh_account_limit,
    )
    issued = await sessions.rotate_refresh(body.refresh_token, db)
    return schemas.TokenResponse(access_token=issued.access_token, refresh_token=issued.refresh_token)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    account=Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    from src.models.auth_session import AuthSession

    session_id = getattr(request.state, "auth_session_id", None)
    if session_id is not None:
        session = await db.get(AuthSession, session_id)
        if session is not None and session.account_id == account.id:
            await sessions.revoke_session(session, db)
            await db.commit()
    return None


@router.post("/auth/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    account=Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    await sessions.revoke_all_sessions(account.id, db)
    await db.commit()
    return None


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


@router.patch("/admin/accounts/{account_id}/tier", response_model=schemas.AccountAdminRow)
async def admin_update_seller_tier(
    account_id: int,
    body: schemas.UpdateSellerTierRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_seller_tier(account_id, body.seller_tier, db, actor_id=admin.id)
