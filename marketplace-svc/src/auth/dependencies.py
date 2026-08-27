import hmac

from fastapi import Depends, Header, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import get_session
from src.models.account import Account
from src.sellers.tiers import tier_at_least

from .sessions import resolve_account_from_access_token

bearer_scheme = HTTPBearer()


async def get_current_account(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
    db: AsyncSession = Depends(get_session),
) -> Account:
    account, session = await resolve_account_from_access_token(
        credentials.credentials, db, path=request.url.path
    )
    request.state.account_id = account.id
    request.state.auth_session_id = session.id
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


async def get_seller_account(account: Account = Depends(get_current_account)) -> Account:
    if "seller" not in account.roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Yêu cầu quyền seller")
    return account


async def verify_internal_key(
    request: Request,
    x_internal_key: str = Header(...),
) -> None:
    if not hmac.compare_digest(x_internal_key, settings.internal_api_key):
        from src.security.events import security_event

        security_event("internal_key_rejected", level="warning", path=request.url.path)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Khoá nội bộ không hợp lệ")
