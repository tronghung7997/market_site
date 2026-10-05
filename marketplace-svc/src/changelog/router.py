from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account

from . import schemas, service
from .service import ChangelogError

router = APIRouter(prefix="/admin/changelog", tags=["changelog"])


def _http(exc: ChangelogError) -> None:
    raise HTTPException(status_code=exc.status, detail=exc.detail) from exc


@router.get("", response_model=schemas.ReleaseList)
async def list_releases(
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_releases(db, account_id=admin.id)


@router.get("/latest", response_model=schemas.ReleaseList)
async def latest_releases(
    limit: int = Query(3, ge=1, le=10),
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    """Header popover: newest published releases + unread count."""
    return await service.list_releases(db, account_id=admin.id, limit=limit, published_only=True)


@router.post("/seen", status_code=204)
async def mark_seen(
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    await service.mark_seen(db, account_id=admin.id)
    return Response(status_code=204)


@router.post("", response_model=schemas.Release, status_code=201)
async def create_release(
    body: schemas.ReleaseWrite,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.create_release(db, actor_id=admin.id, data=body.model_dump())
    except ChangelogError as exc:
        _http(exc)


@router.patch("/{release_id}", response_model=schemas.Release)
async def update_release(
    release_id: int,
    body: schemas.ReleaseUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.update_release(
            db, actor_id=admin.id, release_id=release_id, data=body.model_dump(exclude_unset=True),
        )
    except ChangelogError as exc:
        _http(exc)


@router.delete("/{release_id}", status_code=204)
async def delete_release(
    release_id: int,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        await service.delete_release(db, actor_id=admin.id, release_id=release_id)
    except ChangelogError as exc:
        _http(exc)
    return Response(status_code=204)
