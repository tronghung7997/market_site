from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account
from src.config import settings
from src.database import get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.media import service
from src.media.http import image_response, not_found
from src.media.schemas import MediaUploadResponse
from src.media.urls import parse_public_key
from src.models.account import Account
from src.models.media import MediaPurpose
from src.rate_limit import check_rate_limit

router = APIRouter(tags=["media"])


@router.post("/media/uploads", status_code=status.HTTP_201_CREATED, response_model=MediaUploadResponse)
async def upload_media(
    request: Request,
    purpose: MediaPurpose = Query(...),
    account: Account = Depends(get_current_account),
    db: AsyncSession = Depends(get_session),
):
    """Body is the raw image bytes (``Content-Type: image/*``), not multipart.
    Size is capped by the body-limit middleware (MEDIA_MAX_UPLOAD_BYTES)."""
    if not await check_rate_limit(
        f"media-upload:{account.id}", limit=settings.media_upload_rate_limit_per_hour, window_seconds=3600,
    ):
        raise api_error(ErrorCode.RATE_LIMITED, status.HTTP_429_TOO_MANY_REQUESTS, headers={"Retry-After": "600"})
    obj = await service.upload(db, account, purpose, await request.body())
    return service.upload_view(obj)


@router.get("/public/media/{key:path}", include_in_schema=False)
async def public_media(key: str, request: Request, db: AsyncSession = Depends(get_session)) -> Response:
    """Public images while they are served by the app (MEDIA_PUBLIC_BASE_URL empty).
    Responses are immutable, so a CDN in front answers repeat requests."""
    parsed = parse_public_key(key)
    if parsed is None:
        return not_found()
    prefix, variant = parsed
    obj = await service.find_public(db, prefix)
    if obj is None or variant not in obj.variants:
        return not_found()
    return await image_response(db, request, obj, variant)
