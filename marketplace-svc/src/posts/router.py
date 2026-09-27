from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.i18n.deps import get_request_locale
from src.models.account import Account

from . import schemas, service

router = APIRouter(tags=["posts"])


@router.get("/public/posts", response_model=schemas.PostList)
async def list_posts(
    category: Literal["guide", "news"] | None = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(service.PAGE_SIZE, ge=1, le=50),
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    return await service.public_list(db, locale=locale, category=category, page=page, per_page=per_page)


@router.get("/public/posts/{slug}", response_model=schemas.PostDetail)
async def get_post(slug: str, locale: str = Depends(get_request_locale), db: AsyncSession = Depends(get_session)):
    return await service.public_detail(slug, db, locale=locale)


@router.get("/public/post-slugs")
async def post_slugs(db: AsyncSession = Depends(get_session)) -> list[dict]:
    """Published slugs for the sitemap."""
    return await service.sitemap_slugs(db)


@router.get("/admin/posts", response_model=list[schemas.PostAdmin])
async def admin_posts(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.admin_list(db)


@router.post("/admin/posts", response_model=schemas.PostAdmin, status_code=status.HTTP_201_CREATED)
async def create_post(body: schemas.PostWrite, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await service.create(body.model_dump(), db, actor_id=admin.id)


@router.put("/admin/posts/{post_id}", response_model=schemas.PostAdmin)
async def update_post(
    post_id: int, body: schemas.PostWrite, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session),
):
    return await service.update(post_id, body.model_dump(), db, actor_id=admin.id)


@router.delete("/admin/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(post_id: int, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    await service.delete(post_id, db, actor_id=admin.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
