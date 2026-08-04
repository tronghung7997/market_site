import hashlib
import hmac

from fastapi import Depends, Header, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_session
from src.models.account import Account
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
    from src.models.seller_api_key import SellerApiKey

    key_hash = hashlib.sha256(key.encode()).hexdigest()
    row = await db.scalar(
        select(SellerApiKey).where(SellerApiKey.key_hash == key_hash, SellerApiKey.revoked_at.is_(None))
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
    from sqlalchemy import func
    row.last_used_at = func.now()
    account = await db.get(Account, row.account_id)
    await db.commit()
    if not account or not account.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Không tìm thấy tài khoản")
    if request is not None:
        request.state.account_id = account.id
    return account


async def get_account_from_api_key(
    request: Request,
    x_seller_api_key: str = Header(...),
    db: AsyncSession = Depends(get_session),
) -> Account:
    return await _resolve_account_by_api_key(x_seller_api_key, db, request=request)


async def get_seller_account_jwt_or_api_key(
    request: Request,
    db: AsyncSession = Depends(get_session),
) -> Account:
    """Accepts either the usual JWT (browser session) or a seller's own
    X-Seller-Api-Key (script/server-to-server) — whichever is present. If
    both are somehow sent, the API key wins so the two auth paths never
    silently blend."""
    api_key = request.headers.get("x-seller-api-key")
    if api_key:
        return await _resolve_account_by_api_key(api_key, db, request=request)

    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Yêu cầu đăng nhập hoặc API key")
    token = auth_header.split(" ", 1)[1]
    payload = decode_access_token(token, path=request.url.path)
    account = await db.get(Account, int(payload["sub"]))
    if not account or not account.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Không tìm thấy tài khoản")
    if "seller" not in account.roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Yêu cầu quyền seller")
    request.state.account_id = account.id
    return account
