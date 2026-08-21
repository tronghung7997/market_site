import hashlib
import hmac

from fastapi import Depends, Header, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_session
from src.models.account import Account
from src.observability import metrics
from src.sellers.tiers import tier_at_least

from .service import decode_access_token

bearer_scheme = HTTPBearer()


async def get_current_account(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: AsyncSession = Depends(get_session),
) -> Account:
    payload = decode_access_token(credentials.credentials, path=request.url.path)
    account_id = int(payload["sub"])
    account = await db.get(Account, account_id)
    if not account or not account.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Không tìm thấy tài khoản")
    # Access middleware reads this after the app returns (correlation only).
    request.state.account_id = account.id
    return account


def require_role(role: str):
    async def checker(account: Account = Depends(get_current_account)) -> Account:
        if role not in account.roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Yêu cầu quyền {role}")
        return account
    return checker


def require_min_seller_tier(min_tier: str):
    async def checker(account: Account = Depends(require_role("seller"))) -> Account:
        if not tier_at_least(account.seller_tier, min_tier):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Tính năng này chỉ dành cho seller cấp {min_tier} trở lên",
            )
        return account
    return checker


async def verify_internal_key(
    request: Request,
    x_internal_key: str = Header(...),
) -> None:
    if not hmac.compare_digest(x_internal_key, settings.internal_api_key):
        from src.security.events import security_event
        security_event(
            "internal_key_rejected",
            level="warning",
            path=request.url.path,
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Khoá nội bộ không hợp lệ")


async def _resolve_account_by_api_key(
    key: str, db: AsyncSession, *, request: Request | None = None,
) -> Account:
    """Legacy bearer auth via X-Seller-Api-Key (hashed key_hash lookup)."""
    from src.models.seller_api_key import SellerApiKey

    key_hash = hashlib.sha256(key.encode()).hexdigest()
    row = await db.scalar(
        select(SellerApiKey).where(
            SellerApiKey.key_hash == key_hash,
            SellerApiKey.revoked_at.is_(None),
            SellerApiKey.expires_at > func.now(),
        )
    )
    if not row:
        from src.security.events import security_event
        prefix = key[:8] if len(key) >= 8 else None
        security_event(
            "seller_api_key_rejected",
            level="warning",
            key_prefix=prefix,
            path=request.url.path if request is not None else None,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key không hợp lệ hoặc đã bị thu hồi")
    row.last_used_at = func.now()
    account = await db.get(Account, row.account_id)
    if not account or not account.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Không tìm thấy tài khoản")
    if "seller" not in (account.roles or []):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Yêu cầu quyền seller")
    if request is not None:
        from src.seller_api_keys.service import required_scope_for_request
        required_scope = required_scope_for_request(request.method, request.url.path)
        if required_scope and required_scope not in (row.scopes or []):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="API key không có scope phù hợp")
    await db.commit()
    if request is not None:
        request.state.account_id = account.id
        request.state.api_key_id = row.id
        request.state.api_key_scopes = list(row.scopes or [])
    return account


async def get_account_from_api_key(
    request: Request,
    x_seller_api_key: str = Header(...),
    db: AsyncSession = Depends(get_session),
) -> Account:
    return await _resolve_account_by_api_key(x_seller_api_key, db, request=request)


async def get_seller_account_jwt_or_signed_request(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> Account:
    """Seller auth for machine + browser paths.

    Priority / rules:
    1. Any of the three signing headers *present* (including empty values) →
       require all three non-empty + valid HMAC. Never fall back to JWT or
       legacy key. Presence is checked via ``name in request.headers``, not
       truthiness of the value.
    2. JWT + any signing header → reject (credential confusion).
    3. X-Seller-Api-Key → legacy path when LEGACY_SELLER_API_KEY_MODE=allow.
    4. Bearer JWT → browser session.
    """
    from src.auth.request_signing import has_any_signing_header, verify_signed_request

    legacy_key = request.headers.get("x-seller-api-key")
    auth_header = request.headers.get("authorization") or ""
    has_jwt = auth_header.lower().startswith("bearer ")
    signing_attempt = has_any_signing_header(request)

    if signing_attempt and has_jwt:
        metrics.observe_auth_rejection("credential_confusion")
        from src.security.events import security_event
        security_event(
            "api_signing_rejected",
            level="warning",
            reason="credential_confusion",
            path=request.url.path,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Không gửi đồng thời JWT và signing headers",
        )

    if signing_attempt:
        # verify_signed_request → parse_signing_headers rejects missing/empty.
        return await verify_signed_request(request, db)

    if legacy_key:
        if settings.legacy_seller_api_key_mode == "deny":
            metrics.observe_auth_rejection("legacy_denied")
            from src.security.events import security_event
            security_event(
                "legacy_api_key_denied",
                level="warning",
                path=request.url.path,
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Legacy API key không còn được hỗ trợ — dùng request signing",
            )
        from src.security.events import security_event
        security_event(
            "legacy_api_key_used",
            level="warning",
            path=request.url.path,
        )
        account = await _resolve_account_by_api_key(legacy_key, db, request=request)
        metrics.observe_auth_method("legacy")
        return account

    if has_jwt:
        token = auth_header.split(" ", 1)[1]
        payload = decode_access_token(token, path=request.url.path)
        account = await db.get(Account, int(payload["sub"]))
        if not account or not account.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Không tìm thấy tài khoản")
        if "seller" not in account.roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Yêu cầu quyền seller")
        request.state.account_id = account.id
        metrics.observe_auth_method("jwt")
        return account

    metrics.observe_auth_rejection("missing_auth")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Yêu cầu đăng nhập hoặc signed API request",
    )


# Backward-compatible alias used by existing routers during the rename.
get_seller_account_jwt_or_api_key = get_seller_account_jwt_or_signed_request
