from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.models.account import Account
from src.rate_limit import check_rate_limit

from . import schemas, service

router = APIRouter(prefix="/seller/telegram", tags=["seller-telegram"])

# Each of these calls Telegram with the seller's token.
_LIMITS = {"connect": (10, 600), "link": (10, 600), "poll": (60, 60), "test": (6, 600), "confirm": (10, 600)}


async def _limit(action: str, account: Account) -> None:
    limit, window = _LIMITS[action]
    if not await check_rate_limit(f"seller-telegram:{action}:{account.id}", limit=limit, window_seconds=window):
        raise api_error(ErrorCode.RATE_LIMITED, status.HTTP_429_TOO_MANY_REQUESTS)


@router.get("", response_model=schemas.TelegramState)
async def get_state(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.get_state(account.id, db)


@router.put("", response_model=schemas.TelegramState)
async def connect(
    body: schemas.ConnectRequest,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    await _limit("connect", account)
    return await service.connect(account.id, body.token, db, replace_webhook=body.replace_webhook)


@router.delete("", response_model=schemas.TelegramState)
async def disconnect(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    return await service.disconnect(account.id, db)


@router.patch("/events", response_model=schemas.TelegramState)
async def update_events(
    body: schemas.EventsUpdate,
    account: Account = Depends(require_role("seller")),
    db: AsyncSession = Depends(get_session),
):
    return await service.update_events(account.id, body.events, db)


@router.post("/link", response_model=schemas.LinkCode)
async def start_link(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    await _limit("link", account)
    return await service.start_link(account.id, db)


@router.get("/link", response_model=schemas.LinkStatus)
async def poll_link(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    await _limit("poll", account)
    return await service.poll_link(account.id, db)


@router.post("/chats/{key}/confirm", response_model=schemas.TelegramState)
async def confirm_chat(
    key: str, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session),
):
    await _limit("confirm", account)
    return await service.confirm_chat(account.id, key, db)


@router.delete("/chats/{key}", response_model=schemas.TelegramState)
async def remove_chat(
    key: str, account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session),
):
    return await service.remove_chat(account.id, key, db)


@router.post("/test", response_model=schemas.TestResult)
async def send_test(account: Account = Depends(require_role("seller")), db: AsyncSession = Depends(get_session)):
    await _limit("test", account)
    return await service.send_test(account.id, db)
