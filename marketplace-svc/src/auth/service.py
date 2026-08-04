from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.audit.service import log_event
from src.exceptions import DuplicateEmail
from src.logging import current_request_id
from src.models.account import Account
from src.models.wallet import Wallet
from src.auth.utils import generate_unique_affiliate_code


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(account_id: int, roles: list[str]) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(account_id), "roles": roles, "exp": expire}
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


async def register_account(
    email: str, password: str, db: AsyncSession, referral_code: str | None = None
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
    )
    db.add(account)
    await db.flush()
    wallet = Wallet(account_id=account.id)
    db.add(wallet)
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


async def authenticate(email: str, password: str, db: AsyncSession) -> Account:
    from src.security.events import principal_fingerprint, security_event

    account = await db.scalar(select(Account).where(Account.email == email))
    if not account or not account.is_active or not verify_password(password, account.password_hash):
        # Single external reason; internal telemetry uses generic invalid_credentials.
        security_event(
            "auth_login_failed",
            level="warning",
            principal_fingerprint=principal_fingerprint(email),
            reason="invalid_credentials",
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email hoặc mật khẩu không đúng")
    security_event(
        "auth_login_success",
        level="info",
        account_id=account.id,
    )
    return account


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
