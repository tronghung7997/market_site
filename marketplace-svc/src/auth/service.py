from datetime import datetime, timedelta, timezone
import hashlib
import secrets

import bcrypt
import jwt
from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.audit.service import log_event
from src.exceptions import DuplicateEmail, ErrorCode, api_error
from src.logging import current_request_id
from src.models.account import Account, EmailVerificationToken, PasswordResetToken
from src.models.login_event import LoginEvent
from src.models.wallet import Wallet
from src.auth.utils import generate_unique_affiliate_code

_FORGOT_ACK = "Nếu tài khoản hợp lệ, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu"
_RESET_ACK = "Mật khẩu đã được cập nhật"


def hash_reset_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(
    account_id: int,
    roles: list[str],
    *,
    jti: str,
    session_id,
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(account_id),
        "roles": roles,
        "exp": expire,
        "jti": jti,
        "sid": str(session_id),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str, *, path: str | None = None) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        from src.security.events import security_event
        security_event(
            "auth_token_rejected",
            level="warning",
            reason="invalid_or_expired",
            path=path,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token không hợp lệ")


def hash_verify_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def issue_email_verification(account: Account, db: AsyncSession, *, locale: str = "vi") -> None:
    """Replace any unused link for the account and mail a fresh one. Flushes, never commits."""
    from src.auth.settings import verification_link_hours
    from src.mail.service import enqueue_mail, verify_email_url

    loc = locale if locale in {"vi", "en"} else "vi"
    await db.execute(
        delete(EmailVerificationToken).where(
            EmailVerificationToken.account_id == account.id,
            EmailVerificationToken.used_at.is_(None),
        )
    )
    raw = secrets.token_urlsafe(32)
    token_hash = hash_verify_token(raw)
    now = datetime.now(timezone.utc)
    db.add(EmailVerificationToken(
        account_id=account.id,
        token_hash=token_hash,
        expires_at=now + timedelta(hours=await verification_link_hours(db)),
    ))
    await db.flush()
    await enqueue_mail(
        db,
        template="email_verify",
        account_id=account.id,
        idempotency_key=f"email_verify:{account.id}:{token_hash}",
        payload={"action_url": verify_email_url(loc, raw)},
        locale=loc,
    )


async def verify_email(raw_token: str, db: AsyncSession) -> Account:
    now = datetime.now(timezone.utc)
    token = await db.scalar(
        select(EmailVerificationToken).where(EmailVerificationToken.token_hash == hash_verify_token(raw_token))
    )
    if token is None or token.used_at is not None or token.expires_at < now:
        raise api_error(ErrorCode.VERIFY_TOKEN_INVALID, status.HTTP_400_BAD_REQUEST)
    account = await db.get(Account, token.account_id, with_for_update=True)
    if account is None or not account.is_active:
        raise api_error(ErrorCode.VERIFY_TOKEN_INVALID, status.HTTP_400_BAD_REQUEST)
    token.used_at = now
    if token.new_email:
        # Email change: the new address is proven; make it the login email.
        taken = await db.scalar(select(Account.id).where(Account.email == token.new_email, Account.id != account.id))
        if taken:
            raise api_error(ErrorCode.DUPLICATE_EMAIL, status.HTTP_409_CONFLICT)
        old_email = account.email
        account.email = token.new_email
        account.email_verified_at = now
        await log_event(
            db, "warning", f"Email changed for account {account.id}",
            request_id=current_request_id(),
            metadata={
                "event": "email_changed",
                "actor_id": account.id,
                "actor_type": "buyer",
                "subject_type": "account",
                "subject_id": account.id,
                "outcome": "success",
                "source": "public",
                "old_email": old_email,
                "new_email": token.new_email,
            },
        )
    elif account.email_verified_at is None:
        account.email_verified_at = now
        await log_event(
            db, "info", f"Email verified for account {account.id}",
            request_id=current_request_id(),
            metadata={
                "event": "email_verified",
                "actor_id": account.id,
                "actor_type": "buyer",
                "subject_type": "account",
                "subject_id": account.id,
                "outcome": "success",
                "source": "public",
            },
        )
    await db.commit()
    await db.refresh(account)
    return account


async def resend_email_verification(account: Account, db: AsyncSession, *, locale: str = "vi") -> None:
    if account.email_verified_at is not None:
        raise api_error(ErrorCode.EMAIL_ALREADY_VERIFIED, status.HTTP_400_BAD_REQUEST)
    await issue_email_verification(account, db, locale=locale)
    await db.commit()


async def admin_mark_email_verified(account_id: int, db: AsyncSession, *, actor_id: int) -> Account:
    account = await db.get(Account, account_id, with_for_update=True)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    if account.email_verified_at is None:
        account.email_verified_at = datetime.now(timezone.utc)
        await log_event(
            db, "warning", f"Email marked verified by admin for account {account_id}",
            request_id=current_request_id(),
            metadata={
                "event": "email_verified_by_admin",
                "actor_id": actor_id,
                "actor_type": "admin",
                "subject_type": "account",
                "subject_id": account_id,
                "outcome": "success",
                "source": "admin",
            },
        )
        await db.commit()
        await db.refresh(account)
    return account


async def register_account(
    email: str,
    password: str,
    db: AsyncSession,
    referral_code: str | None = None,
    registration_ip: str | None = None,
    locale: str = "vi",
) -> Account:
    from src.audit.service import log_event
    from src.logging import current_request_id

    existing = await db.scalar(select(Account).where(Account.email == email))
    if existing:
        raise DuplicateEmail()
    affiliate_code = await generate_unique_affiliate_code(db)
    referred_by_id: int | None = None
    if referral_code:
        referrer = await db.scalar(
            select(Account).where(Account.affiliate_code == referral_code)
        )
        if referrer:
            referred_by_id = referrer.id
    account = Account(
        email=email,
        password_hash=hash_password(password),
        affiliate_code=affiliate_code,
        referred_by_id=referred_by_id,
        registration_ip=registration_ip,
    )
    db.add(account)
    await db.flush()
    wallet = Wallet(account_id=account.id)
    db.add(wallet)
    await issue_email_verification(account, db, locale=locale)
    await log_event(
        db, "info", f"Account registered {account.id}",
        request_id=current_request_id(),
        metadata={
            "event": "auth_register",
            "actor_id": account.id,
            "actor_type": "buyer",
            "subject_type": "account",
            "subject_id": account.id,
            "outcome": "success",
            "source": "public",
        },
    )
    await db.commit()
    await db.refresh(account)
    return account


LOGIN_EVENT_UA_MAX = 255


def _record_login_event(
    db: AsyncSession,
    account_id: int,
    *,
    kind: str,
    outcome: str,
    ip: str | None,
    user_agent: str | None,
    actor_id: int | None = None,
) -> None:
    """Append one row of login history to the caller's transaction."""
    db.add(LoginEvent(
        account_id=account_id,
        kind=kind,
        outcome=outcome,
        ip=(ip or None) and ip[:45],
        user_agent=(user_agent or None) and user_agent[:LOGIN_EVENT_UA_MAX],
        actor_id=actor_id,
    ))


async def authenticate(
    email: str,
    password: str,
    db: AsyncSession,
    *,
    kind: str = "login",
    ip: str | None = None,
    user_agent: str | None = None,
    mfa_active: bool = True,
) -> Account:
    """Verify credentials and write a login-history row for the account.

    Failed attempts against an existing account are recorded too (so an
    admin can see a password-guessing run); unknown emails leave no trace.
    """
    from src.security.events import principal_fingerprint, security_event

    account = await db.scalar(select(Account).where(Account.email == email))
    if not account or not account.is_active or not verify_password(password, account.password_hash):
        if account is not None:
            _record_login_event(
                db, account.id, kind=kind,
                outcome="inactive" if not account.is_active else "invalid_credentials",
                ip=ip, user_agent=user_agent,
            )
            await db.commit()
        # Single external reason; internal telemetry uses generic invalid_credentials.
        security_event(
            "auth_login_failed",
            level="warning",
            principal_fingerprint=principal_fingerprint(email),
            reason="invalid_credentials",
        )
        raise api_error(ErrorCode.INVALID_CREDENTIALS, status.HTTP_401_UNAUTHORIZED)
    if account.totp_enabled_at is not None and mfa_active:
        # Password stage passed; the session is only issued after the TOTP step.
        _record_login_event(db, account.id, kind=kind, outcome="mfa_pending", ip=ip, user_agent=user_agent)
        await db.commit()
        return account
    _record_login_event(db, account.id, kind=kind, outcome="success", ip=ip, user_agent=user_agent)
    security_event(
        "auth_login_success",
        level="info",
        account_id=account.id,
    )
    return account


async def list_login_events(account_id: int, db: AsyncSession, *, limit: int = 50) -> list[LoginEvent]:
    rows = await db.execute(
        select(LoginEvent)
        .where(LoginEvent.account_id == account_id)
        .order_by(LoginEvent.created_at.desc(), LoginEvent.id.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())


async def set_account_active(
    account_id: int,
    is_active: bool,
    db: AsyncSession,
    *,
    actor_id: int,
    reason: str | None = None,
    ip: str | None = None,
) -> Account:
    """Lock or unlock an account. Locking revokes every live session so the
    user is thrown out immediately, not at token expiry."""
    from src.auth.sessions import revoke_all_sessions
    from src.security.events import security_event

    account = await db.get(Account, account_id, with_for_update=True)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    if account_id == actor_id and not is_active:
        raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản của chính mình")
    if account.is_active == is_active:
        return account
    account.is_active = is_active
    if not is_active:
        await revoke_all_sessions(account_id, db)
    _record_login_event(
        db, account_id, kind="unlocked" if is_active else "locked", outcome="success",
        ip=ip, user_agent=None, actor_id=actor_id,
    )
    await log_event(
        db, "warning",
        f"Account {account_id} {'unlocked' if is_active else 'locked'}",
        request_id=current_request_id(),
        metadata={
            "event": "account_unlocked" if is_active else "account_locked",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "account",
            "subject_id": account_id,
            "outcome": "success",
            "source": "admin",
            "reason": (reason or "").strip()[:500] or None,
        },
    )
    security_event(
        "account_unlocked" if is_active else "account_locked",
        level="warning",
        account_id=account_id,
        actor_id=actor_id,
    )
    await db.commit()
    await db.refresh(account)
    return account


async def request_password_reset(email: str, locale: str, db: AsyncSession) -> str:
    """Always ack the same way. Enqueue mail only for an active account."""
    from src.mail.service import enqueue_mail, reset_password_url
    from src.security.events import principal_fingerprint, security_event

    loc = locale if locale in {"vi", "en"} else "vi"
    account = await db.scalar(select(Account).where(Account.email == email.strip()))
    if account is not None and account.is_active:
        await db.execute(
            delete(PasswordResetToken).where(
                PasswordResetToken.account_id == account.id,
                PasswordResetToken.used_at.is_(None),
            )
        )
        raw = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        db.add(
            PasswordResetToken(
                account_id=account.id,
                token_hash=hash_reset_token(raw),
                expires_at=now + timedelta(minutes=settings.password_reset_ttl_minutes),
            )
        )
        await db.flush()
        await enqueue_mail(
            db,
            template="password_reset",
            account_id=account.id,
            idempotency_key=f"password_reset:{account.id}:{hash_reset_token(raw)}",
            payload={"action_url": reset_password_url(loc, raw)},
            locale=loc,
        )
        await log_event(
            db, "info", f"Password reset requested for account {account.id}",
            request_id=current_request_id(),
            metadata={
                "event": "password_reset_requested",
                "actor_id": account.id,
                "actor_type": "buyer",
                "subject_type": "account",
                "subject_id": account.id,
                "outcome": "success",
                "source": "public",
            },
        )
        security_event(
            "password_reset_requested",
            level="info",
            account_id=account.id,
            principal_fingerprint=principal_fingerprint(email),
        )
    await db.commit()
    return _FORGOT_ACK


async def reset_password(
    raw_token: str, new_password: str, db: AsyncSession, *, locale: str = "vi",
) -> str:
    from src.mail.service import enqueue_mail, forgot_password_url
    from src.security.events import security_event

    loc = locale if locale in {"vi", "en"} else "vi"
    now = datetime.now(timezone.utc)
    token = await db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_reset_token(raw_token))
    )
    if (
        token is None
        or token.used_at is not None
        or token.expires_at <= now
    ):
        security_event("password_reset_rejected", level="warning", reason="invalid_or_expired")
        raise api_error(ErrorCode.PASSWORD_RESET_INVALID, status.HTTP_400_BAD_REQUEST)

    account = await db.get(Account, token.account_id)
    if account is None or not account.is_active:
        security_event("password_reset_rejected", level="warning", reason="inactive")
        raise api_error(ErrorCode.PASSWORD_RESET_INVALID, status.HTTP_400_BAD_REQUEST)

    account.password_hash = hash_password(new_password)
    token.used_at = now
    from src.auth.sessions import revoke_all_sessions
    await revoke_all_sessions(account.id, db)
    await db.execute(
        delete(PasswordResetToken).where(
            PasswordResetToken.account_id == account.id,
            PasswordResetToken.id != token.id,
            PasswordResetToken.used_at.is_(None),
        )
    )
    await enqueue_mail(
        db,
        template="password_changed",
        account_id=account.id,
        idempotency_key=f"password_changed:{account.id}:{token.id}",
        payload={"action_url": forgot_password_url(loc)},
        locale=loc,
    )
    await log_event(
        db, "info", f"Password reset completed for account {account.id}",
        request_id=current_request_id(),
        metadata={
            "event": "password_reset_completed",
            "actor_id": account.id,
            "actor_type": "buyer",
            "subject_type": "account",
            "subject_id": account.id,
            "outcome": "success",
            "source": "public",
        },
    )
    security_event("password_reset_completed", level="info", account_id=account.id)
    await db.commit()
    return _RESET_ACK


_VALID_ROLES = {"buyer", "seller", "admin"}
_VALID_TIERS = {"new", "verified", "trusted", "enterprise"}


async def list_accounts(db: AsyncSession, search: str | None = None, page: int = 1, per_page: int = 20) -> dict:
    from sqlalchemy import func

    base = select(Account)
    count_q = select(func.count(Account.id))
    if search:
        base = base.where(Account.email.ilike(f"%{search}%"))
        count_q = count_q.where(Account.email.ilike(f"%{search}%"))
    total = await db.scalar(count_q) or 0
    rows = await db.execute(
        base.order_by(Account.id).offset((page - 1) * per_page).limit(per_page)
    )
    return {"items": list(rows.scalars().all()), "total": int(total), "page": page, "per_page": per_page}


async def update_roles(account_id: int, roles: list[str], requester_id: int, db: AsyncSession) -> Account:
    cleaned = sorted({r for r in roles})
    invalid = [r for r in cleaned if r not in _VALID_ROLES]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Vai trò không hợp lệ: {', '.join(invalid)}")
    if not cleaned:
        raise HTTPException(status_code=422, detail="Tài khoản phải có ít nhất một vai trò")
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    # An admin cannot strip their own admin role (prevents self-lockout).
    if account_id == requester_id and "admin" not in cleaned:
        raise HTTPException(status_code=400, detail="Không thể tự gỡ quyền admin của chính mình")
    old_roles = list(account.roles or [])
    account.roles = cleaned
    await log_event(
        db,
        "warning",
        f"Roles changed for account {account_id}",
        request_id=current_request_id(),
        metadata={
            "event": "auth_role_changed",
            "actor_id": requester_id,
            "actor_type": "admin",
            "subject_type": "account",
            "subject_id": account_id,
            "outcome": "success",
            "source": "admin",
            "old_roles": old_roles,
            "new_roles": cleaned,
        },
    )
    await db.commit()
    await db.refresh(account)
    return account


async def update_seller_tier(
    account_id: int,
    tier: str,
    db: AsyncSession,
    *,
    actor_id: int | None = None,
) -> Account:
    if tier not in _VALID_TIERS:
        raise HTTPException(status_code=422, detail=f"Cấp độ người bán không hợp lệ: {tier}")
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    if "seller" not in account.roles:
        raise HTTPException(status_code=400, detail="Chỉ có thể gán cấp độ cho tài khoản người bán")
    old_tier = account.seller_tier.value if hasattr(account.seller_tier, "value") else str(account.seller_tier)
    account.seller_tier = tier
    await log_event(
        db,
        "warning",
        f"Seller tier changed for account {account_id}",
        request_id=current_request_id(),
        metadata={
            "event": "auth_tier_changed",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "account",
            "subject_id": account_id,
            "outcome": "success",
            "source": "admin",
            "old_tier": old_tier,
            "new_tier": tier,
        },
    )
    await db.commit()
    await db.refresh(account)
    return account


# ── Signed-in account security ───────────────────────────────────────────────

async def change_password(
    account: Account,
    current_password: str,
    new_password: str,
    db: AsyncSession,
    *,
    keep_session_id=None,
    locale: str = "vi",
) -> None:
    """Rotate the password, sign out every other device, notify by mail."""
    from src.auth.sessions import revoke_all_sessions
    from src.mail.service import enqueue_mail, forgot_password_url
    from src.security.events import security_event

    if not verify_password(current_password, account.password_hash):
        raise api_error(ErrorCode.PASSWORD_INCORRECT, status.HTTP_400_BAD_REQUEST)
    loc = locale if locale in {"vi", "en"} else "vi"
    account.password_hash = hash_password(new_password)
    await revoke_all_sessions(account.id, db, keep_session_id=keep_session_id)
    await enqueue_mail(
        db,
        template="password_changed",
        account_id=account.id,
        idempotency_key=f"password_changed:{account.id}:{secrets.token_hex(8)}",
        payload={"action_url": forgot_password_url(loc)},
        locale=loc,
    )
    await log_event(
        db, "warning", f"Password changed for account {account.id}",
        request_id=current_request_id(),
        metadata={
            "event": "password_changed",
            "actor_id": account.id,
            "actor_type": "buyer",
            "subject_type": "account",
            "subject_id": account.id,
            "outcome": "success",
            "source": "public",
        },
    )
    security_event("password_changed", level="info", account_id=account.id)
    await db.commit()


async def request_email_change(
    account: Account,
    new_email: str,
    password: str,
    db: AsyncSession,
    *,
    locale: str = "vi",
) -> None:
    """Mail a confirmation link to the new address and a heads-up to the old one.
    The address only changes when the new mailbox clicks the link."""
    from src.auth.settings import verification_link_hours
    from src.mail.service import enqueue_mail, forgot_password_url, verify_email_url

    if not verify_password(password, account.password_hash):
        raise api_error(ErrorCode.PASSWORD_INCORRECT, status.HTTP_400_BAD_REQUEST)
    new_email = new_email.strip()
    if new_email.casefold() == account.email.casefold():
        raise HTTPException(status_code=400, detail="Email mới trùng email hiện tại")
    if await db.scalar(select(Account.id).where(Account.email == new_email)):
        raise api_error(ErrorCode.DUPLICATE_EMAIL, status.HTTP_409_CONFLICT)
    loc = locale if locale in {"vi", "en"} else "vi"
    await db.execute(
        delete(EmailVerificationToken).where(
            EmailVerificationToken.account_id == account.id,
            EmailVerificationToken.used_at.is_(None),
        )
    )
    raw = secrets.token_urlsafe(32)
    token_hash = hash_verify_token(raw)
    db.add(EmailVerificationToken(
        account_id=account.id,
        token_hash=token_hash,
        new_email=new_email,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=await verification_link_hours(db)),
    ))
    await db.flush()
    await enqueue_mail(
        db,
        template="email_change_confirm",
        to_email=new_email,
        idempotency_key=f"email_change_confirm:{account.id}:{token_hash}",
        payload={"action_url": verify_email_url(loc, raw)},
        locale=loc,
    )
    await enqueue_mail(
        db,
        template="email_change_notice",
        account_id=account.id,
        idempotency_key=f"email_change_notice:{account.id}:{token_hash}",
        payload={"new_email": new_email, "action_url": forgot_password_url(loc)},
        locale=loc,
    )
    await log_event(
        db, "info", f"Email change requested for account {account.id}",
        request_id=current_request_id(),
        metadata={
            "event": "email_change_requested",
            "actor_id": account.id,
            "actor_type": "buyer",
            "subject_type": "account",
            "subject_id": account.id,
            "outcome": "success",
            "source": "public",
            "new_email": new_email,
        },
    )
    await db.commit()


async def start_totp_setup(account: Account, password: str, db: AsyncSession) -> dict:
    from src.auth import mfa

    if not verify_password(password, account.password_hash):
        raise api_error(ErrorCode.PASSWORD_INCORRECT, status.HTTP_400_BAD_REQUEST)
    if account.totp_enabled_at is not None:
        raise api_error(ErrorCode.MFA_ALREADY_ENABLED, status.HTTP_400_BAD_REQUEST)
    secret = mfa.new_secret()
    mfa.store_pending_secret(account, secret)
    await db.commit()
    return {"secret": secret, "otpauth_uri": mfa.provisioning_uri(secret, account.email)}


async def confirm_totp_setup(account: Account, code: str, db: AsyncSession) -> list[str]:
    from src.auth import mfa

    if account.totp_enabled_at is not None:
        raise api_error(ErrorCode.MFA_ALREADY_ENABLED, status.HTTP_400_BAD_REQUEST)
    if not account.totp_secret or not mfa.verify_totp(account, code):
        raise api_error(ErrorCode.MFA_CODE_INVALID, status.HTTP_400_BAD_REQUEST)
    codes = mfa.generate_backup_codes()
    mfa.enable(account, codes)
    await log_event(
        db, "warning", f"Two-factor enabled for account {account.id}",
        request_id=current_request_id(),
        metadata={
            "event": "mfa_enabled",
            "actor_id": account.id,
            "actor_type": "buyer",
            "subject_type": "account",
            "subject_id": account.id,
            "outcome": "success",
            "source": "public",
        },
    )
    await db.commit()
    return codes


async def disable_totp(account: Account, password: str, code: str, db: AsyncSession) -> None:
    from src.auth import mfa

    if not verify_password(password, account.password_hash):
        raise api_error(ErrorCode.PASSWORD_INCORRECT, status.HTTP_400_BAD_REQUEST)
    if account.totp_enabled_at is None:
        raise api_error(ErrorCode.MFA_NOT_ENABLED, status.HTTP_400_BAD_REQUEST)
    if not mfa.verify_code(account, code):
        raise api_error(ErrorCode.MFA_CODE_INVALID, status.HTTP_400_BAD_REQUEST)
    mfa.disable(account)
    await log_event(
        db, "warning", f"Two-factor disabled for account {account.id}",
        request_id=current_request_id(),
        metadata={
            "event": "mfa_disabled",
            "actor_id": account.id,
            "actor_type": "buyer",
            "subject_type": "account",
            "subject_id": account.id,
            "outcome": "success",
            "source": "public",
        },
    )
    await db.commit()


async def regenerate_backup_codes(account: Account, code: str, db: AsyncSession) -> list[str]:
    from src.auth import mfa

    if account.totp_enabled_at is None:
        raise api_error(ErrorCode.MFA_NOT_ENABLED, status.HTTP_400_BAD_REQUEST)
    if not mfa.verify_totp(account, code):
        raise api_error(ErrorCode.MFA_CODE_INVALID, status.HTTP_400_BAD_REQUEST)
    codes = mfa.generate_backup_codes()
    account.totp_backup_hashes = [mfa._hash_backup(c) for c in codes]
    await db.commit()
    return codes


async def complete_mfa_login(mfa_token: str, code: str, db: AsyncSession, *, ip: str | None, user_agent: str | None) -> tuple[Account, str]:
    """Second step of sign-in: swap a valid challenge token + TOTP/backup code
    for a real session. Returns (account, kind) so the router can apply the
    admin-only rule for the admin entrance."""
    from src.auth import mfa
    from src.security.events import security_event

    decoded = mfa.decode_mfa_token(mfa_token)
    if decoded is None:
        raise api_error(ErrorCode.MFA_TOKEN_INVALID, status.HTTP_401_UNAUTHORIZED)
    account_id, kind = decoded
    account = await db.get(Account, account_id, with_for_update=True)
    if account is None or not account.is_active or account.totp_enabled_at is None:
        raise api_error(ErrorCode.MFA_TOKEN_INVALID, status.HTTP_401_UNAUTHORIZED)
    if not mfa.verify_code(account, code):
        _record_login_event(db, account.id, kind=kind, outcome="mfa_failed", ip=ip, user_agent=user_agent)
        await db.commit()
        security_event("auth_mfa_failed", level="warning", account_id=account.id)
        raise api_error(ErrorCode.MFA_CODE_INVALID, status.HTTP_400_BAD_REQUEST)
    _record_login_event(db, account.id, kind=kind, outcome="success", ip=ip, user_agent=user_agent)
    security_event("auth_login_success", level="info", account_id=account.id, mfa=True)
    return account, kind
async def update_internal(
    account_id: int, is_internal: bool, db: AsyncSession, *, actor_id: int | None = None,
) -> Account:
    """Bật/tắt cờ seller nội bộ. Bật đồng thời cấp role seller nếu chưa có —
    admin không phải làm hai bước."""
    account = await db.get(Account, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    if "admin" in account.roles:
        raise HTTPException(status_code=400, detail="Tài khoản admin không thể là seller nội bộ")
    if is_internal and "seller" not in account.roles:
        account.roles = [*account.roles, "seller"]
    account.is_internal = is_internal
    await log_event(
        db, "warning", f"Internal flag {'set' if is_internal else 'cleared'} for account {account_id}",
        request_id=current_request_id(),
        metadata={
            "event": "auth_internal_changed", "actor_id": actor_id, "actor_type": "admin",
            "subject_type": "account", "subject_id": account_id, "outcome": "success",
            "source": "admin", "is_internal": is_internal,
        },
    )
    await db.commit()
    await db.refresh(account)
    return account
