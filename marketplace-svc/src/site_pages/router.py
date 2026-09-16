from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.i18n.deps import get_request_locale
from src.models.account import Account

from . import schemas, service
from .service import SitePageError

router = APIRouter(tags=["site-pages"])


def _http(exc: SitePageError) -> None:
    raise HTTPException(status_code=exc.status, detail=exc.detail) from exc


@router.get("/public/site-pages", response_model=list[schemas.SitePageLink])
async def public_site_page_links(
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    """Footer links, in display order. Unauthenticated."""
    return await service.footer_links(db, locale)


@router.get("/public/site-pages/{slug}", response_model=schemas.SitePagePublic)
async def public_site_page(
    slug: str,
    locale: str = Depends(get_request_locale),
    db: AsyncSession = Depends(get_session),
):
    page = await service.public_page(db, slug, locale)
    if page is None:
        raise HTTPException(status_code=404, detail="page not found")
    return page


@router.get("/admin/site-pages", response_model=schemas.SitePageList)
async def admin_site_pages(
    _: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    return await service.list_pages(db)


@router.post("/admin/site-pages", response_model=schemas.SitePageAdmin, status_code=201)
async def create_site_page(
    body: schemas.SitePageCreate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.create_page(db, actor_id=admin.id, data=body.model_dump())
    except SitePageError as exc:
        _http(exc)


@router.patch("/admin/site-pages/{slug}", response_model=schemas.SitePageAdmin)
async def update_site_page(
    slug: str,
    body: schemas.SitePageUpdate,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.update_page(
            db, actor_id=admin.id, slug=slug, data=body.model_dump(exclude_unset=True),
        )
    except SitePageError as exc:
        _http(exc)


@router.post("/admin/site-pages/{slug}/reset", response_model=schemas.SitePageAdmin)
async def reset_site_page(
    slug: str,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        return await service.reset_page(db, actor_id=admin.id, slug=slug)
    except SitePageError as exc:
        _http(exc)


@router.delete("/admin/site-pages/{slug}", status_code=204)
async def delete_site_page(
    slug: str,
    admin: Account = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_session),
):
    try:
        await service.delete_page(db, actor_id=admin.id, slug=slug)
    except SitePageError as exc:
        _http(exc)
    return Response(status_code=204)
