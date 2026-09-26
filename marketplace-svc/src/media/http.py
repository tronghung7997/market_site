"""HTTP delivery of one stored image, shared by the public media route and the
private endpoints owned by features (chat, disputes, wallet, admin). The
feature authorises the caller and finds the object; this only builds the
response."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.media.service import read_variant
from src.media.store import CONTENT_TYPE, PRIVATE_CACHE_CONTROL, PUBLIC_CACHE_CONTROL, s3_store
from src.media.urls import object_key
from src.models.media import MediaObject


def _presign_moment(ttl: int) -> datetime:
    """Sign as of the start of a half-TTL window, so every request in that window
    gets the same URL and the browser cache can reuse the downloaded image."""
    window = max(ttl // 2, 1)
    now = int(datetime.now(timezone.utc).timestamp())
    return datetime.fromtimestamp(now - now % window, timezone.utc)


def not_found() -> Response:
    return Response(status_code=404, headers={"Cache-Control": "no-store"})


async def image_response(db: AsyncSession, request: Request, obj: MediaObject, variant: str) -> Response:
    variant = variant if variant in obj.variants else "full"
    public = obj.visibility == "public"
    cache_control = PUBLIC_CACHE_CONTROL if public else PRIVATE_CACHE_CONTROL
    etag = f'"{obj.variants[variant]["sha256"]}"'
    headers = {"Cache-Control": cache_control, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    if obj.storage == "s3" and not public:
        # Private bytes never pass through the app once they are in S3: a
        # short-lived signed URL lets the browser fetch them from the bucket.
        ttl = settings.media_signed_url_ttl_seconds
        store = s3_store()
        url = store.client.presigned_get(
            store.bucket(False), object_key(obj.key_prefix, variant), expires=ttl, now=_presign_moment(ttl),
        )
        return RedirectResponse(url, status_code=302, headers={"Cache-Control": f"private, max-age={max(ttl // 4, 1)}"})
    data = await read_variant(db, obj, variant)
    if data is None:
        return not_found()
    headers["Content-Disposition"] = "inline"
    return Response(content=data, media_type=CONTENT_TYPE, headers=headers)
