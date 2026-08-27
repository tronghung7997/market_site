from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.account import Account
from src.models.auth_session import AuthRefreshToken, AuthSession
from src.security.events import security_event
from src.security.token_denylist import deny_jti, jti_is_denied

from .service import create_access_token, decode_access_token

_INVALID = "Token không hợp lệ"


@dataclass(frozen=True)
class IssuedTokens:
    access_token: str
    refresh_token: str
    session: AuthSession


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _new_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def _refresh_expiry(now: datetime) -> datetime:
    return now + timedelta(days=settings.jwt_refresh_expire_days)


async def issue_session(account: Account, db: AsyncSession) -> IssuedTokens:
    now = datetime.now(timezone.utc)
    session_id = uuid4()
    family_id = uuid4()
    jti = str(uuid4())
    raw_refresh = _new_refresh_token()
    refresh_hash = hash_refresh_token(raw_refresh)
    expires_at = _refresh_expiry(now)
    session = AuthSession(
        id=session_id,
        account_id=account.id,
        family_id=family_id,
        access_jti=jti,
        refresh_token_hash=refresh_hash,
        expires_at=expires_at,
        last_used_at=now,
    )
    db.add(session)
    await db.flush()
    db.add(
        AuthRefreshToken(
            session_id=session_id,
            family_id=family_id,
            token_hash=refresh_hash,
            expires_at=expires_at,
        )
    )
    access = create_access_token(account.id, account.roles, jti=jti, session_id=session_id)
    await db.commit()
    return IssuedTokens(access_token=access, refresh_token=raw_refresh, session=session)


async def rotate_refresh(raw_refresh: str, db: AsyncSession) -> IssuedTokens:
    now = datetime.now(timezone.utc)
    token_hash = hash_refresh_token(raw_refresh)
    row = await db.scalar(
        select(AuthRefreshToken)
        .where(AuthRefreshToken.token_hash == token_hash)
        .with_for_update()
    )
    if row is None:
        security_event("auth_refresh_rejected", level="warning", reason="unknown_refresh")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID)
    if row.used_at is not None:
        await _revoke_family(row.family_id, db, reason="refresh_reuse")
        await db.commit()
        security_event(
            "auth_refresh_reuse_detected",
            level="warning",
            reason="refresh_reuse",
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID)
    if row.expires_at <= now:
        security_event("auth_refresh_rejected", level="warning", reason="expired_refresh")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID)

    session = await db.get(AuthSession, row.session_id, with_for_update=True)
    if session is None or session.revoked_at is not None or session.expires_at <= now:
        security_event("auth_refresh_rejected", level="warning", reason="revoked_session")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID)

    account = await db.get(Account, session.account_id)
    if account is None or not account.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Không tìm thấy tài khoản")

    old_jti = session.access_jti
    old_access_exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    row.used_at = now
    new_raw = _new_refresh_token()
    new_hash = hash_refresh_token(new_raw)
    new_jti = str(uuid4())
    new_expiry = _refresh_expiry(now)
    session.refresh_token_hash = new_hash
    session.access_jti = new_jti
    session.expires_at = new_expiry
    session.last_used_at = now
    db.add(
        AuthRefreshToken(
            session_id=session.id,
            family_id=session.family_id,
            token_hash=new_hash,
            expires_at=new_expiry,
        )
    )
    await deny_jti(old_jti, old_access_exp)
    access = create_access_token(account.id, account.roles, jti=new_jti, session_id=session.id)
    await db.commit()
    return IssuedTokens(access_token=access, refresh_token=new_raw, session=session)


async def revoke_session(session: AuthSession, db: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    if session.revoked_at is None:
        session.revoked_at = now
    await db.execute(
        update(AuthRefreshToken)
        .where(
            AuthRefreshToken.family_id == session.family_id,
            AuthRefreshToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    access_exp = now + timedelta(minutes=settings.jwt_expire_minutes)
    await deny_jti(session.access_jti, access_exp)


async def revoke_all_sessions(account_id: int, db: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(AuthSession).where(
            AuthSession.account_id == account_id,
            AuthSession.revoked_at.is_(None),
        )
    )
    sessions = list(result.scalars().all())
    family_ids = {row.family_id for row in sessions}
    for row in sessions:
        row.revoked_at = now
        await deny_jti(row.access_jti, now + timedelta(minutes=settings.jwt_expire_minutes))
    if family_ids:
        await db.execute(
            update(AuthRefreshToken)
            .where(
                AuthRefreshToken.family_id.in_(family_ids),
                AuthRefreshToken.used_at.is_(None),
            )
            .values(used_at=now)
        )


async def _revoke_family(family_id: UUID, db: AsyncSession, *, reason: str) -> None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(AuthSession).where(AuthSession.family_id == family_id)
    )
    for row in result.scalars().all():
        if row.revoked_at is None:
            row.revoked_at = now
        await deny_jti(row.access_jti, now + timedelta(minutes=settings.jwt_expire_minutes))
    await db.execute(
        update(AuthRefreshToken)
        .where(AuthRefreshToken.family_id == family_id, AuthRefreshToken.used_at.is_(None))
        .values(used_at=now)
    )
    security_event("auth_session_family_revoked", level="warning", reason=reason)


async def resolve_account_from_access_token(
    token: str,
    db: AsyncSession,
    *,
    path: str | None = None,
) -> tuple[Account, AuthSession]:
    payload = decode_access_token(token, path=path)
    jti = payload.get("jti")
    sid = payload.get("sid")
    sub = payload.get("sub")
    if not jti or not sid or not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID)
    if await jti_is_denied(str(jti)):
        security_event("auth_token_rejected", level="warning", reason="denied_jti", path=path)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID)
    try:
        session_id = UUID(str(sid))
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID)
    session = await db.get(AuthSession, session_id)
    if (
        session is None
        or session.revoked_at is not None
        or session.access_jti != str(jti)
        or str(session.account_id) != str(sub)
    ):
        security_event("auth_token_rejected", level="warning", reason="revoked_or_rotated", path=path)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID)
    account = await db.get(Account, session.account_id)
    if not account or not account.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Không tìm thấy tài khoản")
    return account, session
