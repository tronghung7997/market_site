from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import get_current_account, require_role
from src.config import settings
from src.database import get_session
from src.errors.codes import ErrorCode
from src.errors.exceptions import api_error
from src.media import service
from src.media.http import image_response, not_found
from src.media.schemas import MediaRemove, MediaUploadResponse
from src.media.urls import parse_public_key
from src.models.account import Account
from src.models.media import MediaPurpose, MediaStatus
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


@router.get("/admin/media/stats")
async def admin_media_stats(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    """Live images by purpose and store — the numbers devops needs to size R2."""
    return await service.admin_stats(db)


@router.get("/admin/media")
async def admin_media_list(
    purpose: MediaPurpose | None = None,
    status_filter: MediaStatus | None = Query(default=None, alias="status"),
    owner: str | None = Query(default=None, max_length=255),
    page: int = Query(default=1, ge=1, le=10_000),
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.admin_list(
        db, purpose=purpose.value if purpose else None, status=status_filter.value if status_filter else None,
        owner=owner, page=page,
    )


@router.get("/admin/media/{public_id}/content", include_in_schema=False)
async def admin_media_content(
    public_id: str, request: Request, v: str = "full",
    _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
) -> Response:
    """Any stored image, private ones included, for moderation."""
    return await image_response(db, request, await service.admin_find(db, public_id), v)


@router.post("/admin/media/{public_id}/remove")
async def admin_media_remove(
    public_id: str, body: MediaRemove,
    admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
):
    """Take an image down: bytes deleted, every URL of it answers 404, audited."""
    return await service.remove(db, public_id, actor_id=admin.id, reason=body.reason.strip())
