import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.models.account import Account
from src.config import settings
from src.rate_limit import check_rate_limit
from src.security.client_ip import request_client_ip
from src.security import turnstile
from src.security.events import security_event

from src.audit import notes as admin_notes
from src.audit.service import log_event
from src.disputes.schemas import DisputeListResponse
from src.logging import current_request_id
from src.orders.schemas import AdminOrderPage
from src.wallet.schemas import WalletDebitRequest, WalletResponse

from . import admin_accounts, schemas, service, sessions
from . import mfa
from . import settings as auth_settings
from .dependencies import get_current_account, require_role

router = APIRouter(tags=["auth"])


def _peer_ip(request: Request) -> str:
    # End-user IP: the BFF-forwarded value on a signed request, else the TCP
    # peer / trusted-proxy chain. Spoofable headers are never read directly.
    return request_client_ip(request)


def _user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent") or None


async def _enforce_captcha(token: str | None, request: Request, db: AsyncSession) -> None:
    """Turnstile is enforced only when the admin site key AND env secret exist."""
    if not turnstile.secret_configured() or not await auth_settings.turnstile_site_key(db):
        return
    if not token:
        raise api_error(ErrorCode.CAPTCHA_REQUIRED, status.HTTP_400_BAD_REQUEST)
    if not await turnstile.verify_token(token, remote_ip=_peer_ip(request)):
        security_event("captcha_failed", level="warning", path=request.url.path)
        raise api_error(ErrorCode.CAPTCHA_FAILED, status.HTTP_400_BAD_REQUEST)


async def _issue_or_challenge(account: Account, db: AsyncSession, *, kind: str, request: Request | None = None):
    """Session for accounts without 2FA; a short-lived challenge otherwise.
    With the marketplace-wide switch off, nobody is challenged."""
    if account.totp_enabled_at is not None and await auth_settings.mfa_feature_enabled(db):
        return schemas.MfaChallengeResponse(mfa_token=mfa.issue_mfa_token(account.id, kind=kind))
    issued = await sessions.issue_session(
        account, db,
        ip=_peer_ip(request) if request else None, user_agent=_user_agent(request) if request else None,
    )
    return schemas.TokenResponse(access_token=issued.access_token, refresh_token=issued.refresh_token)


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
        raise api_error(
            ErrorCode.AUTH_RATE_LIMITED,
            status.HTTP_429_TOO_MANY_REQUESTS,
            headers={"Retry-After": str(settings.auth_rate_limit_window_seconds)},
        )


async def _authenticate_with_limits(
    body: schemas.LoginRequest,
    request: Request,
    db: AsyncSession,
    *,
    kind: str = "login",
) -> Account:
    await _enforce_auth_limit(f"auth:login:ip:{_peer_ip(request)}", settings.auth_login_ip_limit)
    await _enforce_auth_limit(
        f"auth:login:account:{_email_bucket(body.email)}",
        settings.auth_login_account_limit,
    )
    return await service.authenticate(
        body.email, body.password, db,
        kind=kind, ip=_peer_ip(request), user_agent=_user_agent(request),
        mfa_active=await auth_settings.mfa_feature_enabled(db),
    )


@router.post("/auth/register", response_model=schemas.RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: schemas.RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    await _enforce_auth_limit(
        f"auth:register:ip:{_peer_ip(request)}",
        settings.auth_register_ip_limit,
    )
    await _enforce_captcha(body.captcha_token, request, db)
    account = await service.register_account(
        body.email,
        body.password,
        db,
        referral_code=body.referral_code,
        registration_ip=_peer_ip(request),
        locale=body.locale,
    )
    profile = schemas.AccountResponse.model_validate(account).model_dump()
    if account.must_verify_email:
        # Strict flow: no session until the emailed link is clicked; the
        # owner then signs in with their password.
        handoff = await service.create_signup_handoff(account, db)
        return schemas.RegisterResponse(**profile, verification_required=True, signup_handoff=handoff)
    # Sign the new account in right away: a second /auth/login would need a
    # second captcha token, which the widget only hands out once per render.
    issued = await sessions.issue_session(account, db, ip=_peer_ip(request), user_agent=_user_agent(request))
    return schemas.RegisterResponse(
        **profile,
        access_token=issued.access_token,
        refresh_token=issued.refresh_token,
    )


@router.post("/auth/verify-email", response_model=schemas.VerifyEmailResponse)
async def verify_email(body: schemas.VerifyEmailRequest, request: Request, db: AsyncSession = Depends(get_session)):
    account = await service.verify_email(body.token, db)
    profile = schemas.AccountResponse.model_validate(account).model_dump()
    if body.handoff:
        # Same browser that signed up: confirming the mailbox signs it in.
        state, owner = await service.redeem_signup_handoff(
            body.handoff, db, ip=_peer_ip(request), user_agent=_user_agent(request),
        )
        if state == "ready" and owner is not None and owner.id == account.id:
            issued = await sessions.issue_session(owner, db, ip=_peer_ip(request), user_agent=_user_agent(request))
            return schemas.VerifyEmailResponse(
                **profile, access_token=issued.access_token, refresh_token=issued.refresh_token,
            )
        await db.rollback()
    return schemas.VerifyEmailResponse(**profile)


@router.post("/auth/signup-handoff/claim", response_model=schemas.SignupHandoffClaimResponse)
async def claim_signup_handoff(
    body: schemas.SignupHandoffClaimRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    """Polled by the "check your inbox" screen: signs that browser in once the
    link was confirmed, even on another device. The secret only exists in the
    signing-up browser's HttpOnly cookie."""
    await _enforce_auth_limit(f"auth:signup-claim:ip:{_peer_ip(request)}", settings.auth_signup_claim_ip_limit)
    state, account = await service.redeem_signup_handoff(
        body.handoff, db, ip=_peer_ip(request), user_agent=_user_agent(request),
    )
    if state != "ready" or account is None:
        await db.rollback()
        return schemas.SignupHandoffClaimResponse(status=state)
    issued = await sessions.issue_session(account, db, ip=_peer_ip(request), user_agent=_user_agent(request))
    return schemas.SignupHandoffClaimResponse(
        status="ready", access_token=issued.access_token, refresh_token=issued.refresh_token,
    )


@router.post("/auth/verify-email/resend-public", status_code=status.HTTP_204_NO_CONTENT)
async def resend_verification_public(
    body: schemas.PublicResendVerificationRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    """Resend for an account that cannot sign in until it is verified.
    Always 204, whether or not the address exists."""
    await _enforce_auth_limit(f"auth:verify-resend:ip:{_peer_ip(request)}", settings.auth_forgot_ip_limit)
    await _enforce_auth_limit(
        f"auth:verify-resend:email:{_email_bucket(body.email)}",
        settings.auth_verify_resend_account_limit,
    )
    await service.resend_email_verification_by_email(body.email, db, locale=body.locale)
    return None


@router.post("/auth/verify-email/resend", status_code=status.HTTP_204_NO_CONTENT)
async def resend_verification(
    body: schemas.ResendVerificationRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    await _enforce_auth_limit(
        f"auth:verify-resend:account:{account.id}",
        settings.auth_verify_resend_account_limit,
    )
    await service.resend_email_verification(account, db, locale=body.locale)
    return None


@router.post("/auth/login", response_model=schemas.TokenResponse | schemas.MfaChallengeResponse)
async def login(
    body: schemas.LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    await _enforce_captcha(body.captcha_token, request, db)
    account = await _authenticate_with_limits(body, request, db)
    if "admin" in account.roles:
        raise api_error(ErrorCode.ADMIN_LOGIN_REQUIRED, status.HTTP_403_FORBIDDEN)
    return await _issue_or_challenge(account, db, kind="login", request=request)


@router.post("/auth/admin/login", response_model=schemas.TokenResponse | schemas.MfaChallengeResponse)
async def admin_login(
    body: schemas.LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    # No Turnstile on the admin console: it is reached from an internal
    # network that cannot load Cloudflare, and it is already IP-allowlisted
    # and rate-limited (decision 2026-09-22).
    account = await _authenticate_with_limits(body, request, db, kind="admin_login")
    if "admin" not in account.roles:
        security_event(
            "admin_login_rejected",
            level="warning",
            account_id=account.id,
            reason="admin_role_required",
        )
        raise api_error(ErrorCode.ADMIN_ONLY, status.HTTP_403_FORBIDDEN)
    return await _issue_or_challenge(account, db, kind="admin_login", request=request)


@router.post("/auth/login/2fa", response_model=schemas.TokenResponse)
async def login_mfa(
    body: schemas.MfaLoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    decoded = mfa.decode_mfa_token(body.mfa_token)
    if decoded is None:
        raise api_error(ErrorCode.MFA_TOKEN_INVALID, status.HTTP_401_UNAUTHORIZED)
    await _enforce_auth_limit(f"auth:mfa:account:{decoded[0]}", settings.auth_mfa_account_limit)
    account, kind = await service.complete_mfa_login(
        body.mfa_token, body.code, db, ip=_peer_ip(request), user_agent=_user_agent(request),
    )
    if kind == "admin_login" and "admin" not in account.roles:
        raise api_error(ErrorCode.ADMIN_ONLY, status.HTTP_403_FORBIDDEN)
    if kind != "admin_login" and "admin" in account.roles:
        raise api_error(ErrorCode.ADMIN_LOGIN_REQUIRED, status.HTTP_403_FORBIDDEN)
    issued = await sessions.issue_session(account, db, ip=_peer_ip(request), user_agent=_user_agent(request))
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
    await _enforce_captcha(body.captcha_token, request, db)
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
    message = await service.reset_password(body.token, body.password, db, locale=body.locale)
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
async def me(account=Depends(get_current_account), db: AsyncSession = Depends(get_session)):
    resp = schemas.AccountResponse.model_validate(account)
    resp.mfa_available = await auth_settings.mfa_feature_enabled(db)
    resp.mfa_setup_required = (
        "admin" in (account.roles or [])
        and account.totp_enabled_at is None
        and await auth_settings.admin_2fa_required(db)
    )
    return resp


@router.patch("/me", response_model=schemas.AccountResponse)
async def update_me(
    body: schemas.ProfileUpdate,
    account=Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """Self-service profile. Contacts/preferences only — email and password
    have their own verified flows."""
    data = body.model_dump(exclude_unset=True)
    prefs = data.pop("notification_prefs", None)
    if "avatar_id" in data:
        await service.set_avatar(account, data.pop("avatar_id"), db)
    for key, value in data.items():
        setattr(account, key, value)
    if prefs is not None:
        account.notification_prefs = {**(account.notification_prefs or {}), **prefs}
    await db.commit()
    await db.refresh(account)
    return await me(account, db)


@router.get("/me/sessions", response_model=list[schemas.SessionRow])
async def my_sessions(
    request: Request,
    account=Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    current = getattr(request.state, "auth_session_id", None)
    rows = await sessions.list_active_sessions(account.id, db)
    out = []
    for row in rows:
        item = schemas.SessionRow.model_validate(row)
        item.is_current = current is not None and row.id == current
        out.append(item)
    return out


@router.delete("/me/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_my_session(
    session_id: UUID,
    account=Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    from src.models.auth_session import AuthSession

    session = await db.get(AuthSession, session_id)
    if session is None or session.account_id != account.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên đăng nhập")
    await sessions.revoke_session(session, db)
    await db.commit()
    return None


@router.get("/me/login-events", response_model=list[schemas.LoginEventRow])
async def my_login_events(
    account=Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
    limit: int = Query(30, ge=1, le=100),
):
    return await service.list_login_events(account.id, db, limit=limit)


@router.get("/public/auth-config", response_model=schemas.PublicAuthConfig)
async def public_auth_config(db: AsyncSession = Depends(get_session)):
    cfg = await auth_settings.get_auth_settings(db)
    site_key = cfg["turnstile_site_key"] if turnstile.secret_configured() else ""
    return {
        "turnstile_site_key": site_key,
        "require_email_verification": cfg["require_email_verification"],
        "mfa_enabled": cfg["mfa_feature_enabled"],
    }


# ── Signed-in account security ───────────────────────────────────────────────

@router.post("/auth/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: schemas.ChangePasswordRequest,
    request: Request,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    await service.change_password(
        account, body.current_password, body.new_password, db,
        keep_session_id=getattr(request.state, "auth_session_id", None), locale=body.locale,
    )
    return None


@router.post("/auth/change-email", status_code=status.HTTP_204_NO_CONTENT)
async def change_email(
    body: schemas.ChangeEmailRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    await _enforce_auth_limit(f"auth:verify-resend:account:{account.id}", settings.auth_verify_resend_account_limit)
    await service.request_email_change(account, str(body.new_email), body.password, db, locale=body.locale)
    return None


async def _require_mfa_feature(db: AsyncSession) -> None:
    if not await auth_settings.mfa_feature_enabled(db):
        raise api_error(ErrorCode.MFA_FEATURE_DISABLED, status.HTTP_403_FORBIDDEN)


@router.post("/auth/2fa/setup", response_model=schemas.TotpSetupResponse)
async def totp_setup(
    body: schemas.TotpSetupRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    await _require_mfa_feature(db)
    return await service.start_totp_setup(account, body.password, db)


@router.post("/auth/2fa/enable", response_model=schemas.BackupCodesResponse)
async def totp_enable(
    body: schemas.TotpCodeRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    await _require_mfa_feature(db)
    await _enforce_auth_limit(f"auth:mfa:account:{account.id}", settings.auth_mfa_account_limit)
    return {"backup_codes": await service.confirm_totp_setup(account, body.code, db)}


@router.post("/auth/2fa/disable", status_code=status.HTTP_204_NO_CONTENT)
async def totp_disable(
    body: schemas.TotpDisableRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    await _enforce_auth_limit(f"auth:mfa:account:{account.id}", settings.auth_mfa_account_limit)
    await service.disable_totp(account, body.password, body.code, db)
    return None


@router.post("/auth/2fa/backup-codes", response_model=schemas.BackupCodesResponse)
async def totp_backup_codes(
    body: schemas.TotpCodeRequest,
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    await _enforce_auth_limit(f"auth:mfa:account:{account.id}", settings.auth_mfa_account_limit)
    return {"backup_codes": await service.regenerate_backup_codes(account, body.code, db)}


@router.get("/admin/accounts", response_model=schemas.PaginatedAccounts)
async def admin_list_accounts(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    search: str | None = Query(None, max_length=200),
    role: str | None = Query(None),
    status: str | None = Query(None),
    tier: str | None = Query(None, max_length=100),
    sort: str = Query("newest"),
    direction: str | None = Query(None, alias="dir", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    return await service.list_accounts(
        db, search=search, page=page, per_page=per_page, role=role, status=status, tier=tier, sort=sort,
        direction=direction,
    )


@router.get("/admin/accounts/export.csv")
async def admin_export_accounts(
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    search: str | None = Query(None, max_length=200),
    role: str | None = Query(None),
    status: str | None = Query(None),
    tier: str | None = Query(None, max_length=100),
    sort: str = Query("newest"),
    direction: str | None = Query(None, alias="dir", pattern="^(asc|desc)$"),
    ids: str | None = Query(None, max_length=2000, description="Comma-separated account ids (max 200); overrides filters"),
):
    from fastapi.responses import Response

    id_list: list[int] = []
    if ids:
        try:
            id_list = list(dict.fromkeys(int(part) for part in ids.split(",") if part.strip()))
        except ValueError:
            raise HTTPException(status_code=422, detail="ids không hợp lệ") from None
        if len(id_list) > 200:
            raise HTTPException(status_code=422, detail="Tối đa 200 tài khoản")
    body = await admin_accounts.export_accounts_csv(
        db, search=search, role=role, status=status, tier=tier, sort=sort, ids=id_list or None, direction=direction,
    )
    await log_event(
        db, "info", "Admin exported the account directory",
        request_id=current_request_id(),
        metadata={
            "event": "accounts_exported", "actor_id": admin.id, "actor_type": "admin", "outcome": "success",
            "source": "admin", "filters": {"search": search, "role": role, "status": status, "tier": tier},
            "ids": id_list or None,
        },
    )
    await db.commit()
    return Response(
        content=body, media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="accounts.csv"', "Cache-Control": "no-store"},
    )


@router.post("/admin/accounts/bulk-status", response_model=schemas.BulkStatusResponse)
async def admin_bulk_status(
    body: schemas.BulkStatusRequest,
    request: Request,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await admin_accounts.bulk_set_active(
        body.ids, body.active, db, actor_id=admin.id, reason=body.reason, ip=_peer_ip(request),
    )


@router.get("/admin/accounts/{account_id}", response_model=schemas.AccountAdminRow)
async def admin_get_account(
    account_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.get_account_row(db, account_id)


@router.patch("/admin/accounts/{account_id}/roles", response_model=schemas.AccountAdminRow)
async def admin_update_roles(
    account_id: int,
    body: schemas.UpdateRolesRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await service.update_roles(account_id, body.roles, admin.id, db, confirm=body.confirm)
    return await service.get_account_row(db, account_id)


@router.patch("/admin/accounts/{account_id}/status", response_model=schemas.AccountAdminRow)
async def admin_set_account_status(
    account_id: int,
    body: schemas.UpdateAccountStatusRequest,
    request: Request,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await service.set_account_active(
        account_id, body.is_active, db,
        actor_id=admin.id, reason=body.reason, ip=_peer_ip(request),
    )
    return await service.get_account_row(db, account_id)


@router.get("/admin/accounts/{account_id}/login-events", response_model=list[schemas.LoginEventRow])
async def admin_login_events(
    account_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    limit: int = Query(50, ge=1, le=200),
):
    if await db.get(Account, account_id) is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    return await service.list_login_events(account_id, db, limit=limit)


@router.post("/admin/accounts/{account_id}/verify-email", response_model=schemas.AccountAdminRow)
async def admin_verify_email(
    account_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await service.admin_mark_email_verified(account_id, db, actor_id=admin.id)
    return await service.get_account_row(db, account_id)


@router.get("/admin/auth-config", response_model=schemas.AuthRuntimeConfigResponse)
async def admin_auth_config(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return {**await auth_settings.get_auth_settings(db), "turnstile_secret_configured": turnstile.secret_configured()}


@router.patch("/admin/auth-config", response_model=schemas.AuthRuntimeConfigResponse)
async def admin_update_auth_config(
    body: schemas.AuthRuntimeConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        updated = await auth_settings.update_auth_settings(db, actor_id=admin.id, **body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {**updated, "turnstile_secret_configured": turnstile.secret_configured()}


@router.patch("/admin/accounts/{account_id}/tier", response_model=schemas.AccountAdminRow)
async def admin_update_seller_tier(
    account_id: int,
    body: schemas.UpdateSellerTierRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await service.update_seller_tier(account_id, body.seller_tier, db, actor_id=admin.id, reason=body.reason)
    return await service.get_account_row(db, account_id)


@router.patch("/admin/accounts/{account_id}/internal", response_model=schemas.AccountAdminRow)
async def admin_update_internal(
    account_id: int,
    body: schemas.UpdateInternalRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await service.update_internal(account_id, body.is_internal, db, actor_id=admin.id)
    return await service.get_account_row(db, account_id)


@router.patch("/admin/accounts/{account_id}/api-access", response_model=schemas.AccountAdminRow)
async def admin_update_api_access(
    account_id: int,
    body: schemas.UpdateApiAccessRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await service.update_api_access(account_id, body.api_access_enabled, db, actor_id=admin.id)
    return await service.get_account_row(db, account_id)


@router.get("/admin/accounts/{account_id}/overview", response_model=schemas.AccountOverview)
async def admin_account_overview(
    account_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await admin_accounts.account_overview(db, account_id)


@router.post("/admin/accounts/{account_id}/sessions/revoke", response_model=schemas.RevokeSessionsResponse)
async def admin_revoke_sessions(
    account_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return {"revoked": await admin_accounts.revoke_sessions(db, account_id, actor_id=admin.id)}


@router.post("/admin/accounts/{account_id}/password-reset", status_code=status.HTTP_204_NO_CONTENT)
async def admin_send_password_reset(
    account_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await admin_accounts.send_password_reset(db, account_id, actor_id=admin.id)
    return None


@router.post("/admin/accounts/{account_id}/wallet-debit", response_model=WalletResponse)
async def admin_wallet_debit(
    account_id: int,
    body: WalletDebitRequest,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    from src.wallet import service as wallet_service

    await admin_accounts.ensure_account(db, account_id)
    return await wallet_service.admin_debit(
        account_id, body.amount, db, actor_id=admin.id, reason=body.reason, proof_ids=body.proof_media_ids,
    )


@router.get("/admin/accounts/{account_id}/orders", response_model=AdminOrderPage)
async def admin_account_orders(
    account_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    side: str = Query("buyer", pattern="^(buyer|seller)$"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    from src.orders import admin_list

    await admin_accounts.ensure_account(db, account_id)
    party = {"buyer_id": account_id} if side == "buyer" else {"seller_id": account_id}
    return await admin_list.list_admin_orders(
        db, page=page, per_page=min(per_page, admin_list.ADMIN_ORDERS_PAGE_MAX), **party,
    )


@router.get("/admin/accounts/{account_id}/disputes", response_model=DisputeListResponse)
async def admin_account_disputes(
    account_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=100),
):
    from src.disputes import service as disputes_service

    await admin_accounts.ensure_account(db, account_id)
    return await disputes_service.list_account_disputes(db, account_id, page=page, per_page=per_page)


@router.get("/admin/accounts/{account_id}/notes", response_model=list[schemas.AdminNote])
async def admin_account_notes(
    account_id: int,
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await admin_accounts.ensure_account(db, account_id)
    return await admin_notes.list_notes(db, "account", account_id)


@router.post("/admin/accounts/{account_id}/notes", response_model=schemas.AdminNote, status_code=status.HTTP_201_CREATED)
async def admin_add_account_note(
    account_id: int,
    body: schemas.AdminNoteCreate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await admin_accounts.ensure_account(db, account_id)
    return await admin_notes.add_note(db, "account", account_id, body.body, author_id=admin.id)
