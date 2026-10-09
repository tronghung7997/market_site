from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.models.account import Account
from src.rate_limit import check_rate_limit

from . import schemas, service

router = APIRouter(prefix="/admin/ops-telegram", tags=["ops-telegram"])

# Each of these calls Telegram with the bot token.
_LIMITS = {"save": (20, 600), "check": (20, 600), "test": (6, 600)}


async def _limit(action: str, account: Account) -> None:
    limit, window = _LIMITS[action]
    if not await check_rate_limit(f"ops-telegram:{action}:{account.id}", limit=limit, window_seconds=window):
        raise api_error(ErrorCode.RATE_LIMITED, status.HTTP_429_TOO_MANY_REQUESTS)


@router.get("", response_model=schemas.OpsTelegramConfigOut)
async def get_config(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.get_config(db)


@router.patch("", response_model=schemas.OpsTelegramConfigOut)
async def update_config(
    body: schemas.OpsTelegramConfigUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    changes = body.model_dump(exclude_unset=True)
    if changes.get("bot_token"):
        await _limit("save", admin)
    try:
        return await service.update_config(db, actor_id=admin.id, changes=changes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/check", response_model=schemas.BotIdentity)
async def check_token(
    body: schemas.TokenCheck,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await _limit("check", admin)
    return await service.check_token(db, body.token)


@router.post("/test", response_model=schemas.TestResult)
async def send_test(admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    await _limit("test", admin)
    return await service.send_test(db)
