"""Persist admin-editable footer pages.

One row per slug holds both locales; the storefront asks for one locale and
gets the vi copy when the en copy is blank (admins usually write vi first).
Built-in slugs (``defaults.SYSTEM_SLUGS``) cannot be deleted because the
footer, sitemap and buyer flows link to them; they can be reset to the seed.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.models.site_page import SitePage
from src.runtime_config import ProcessConfigCache

from .defaults import DEFAULT_PAGES, SYSTEM_SLUGS

_LOCALES = ("vi", "en")

# Storefront reads (footer links + page body) are hot and public; writes are rare.
_public_cache: ProcessConfigCache[list[dict]] = ProcessConfigCache("site_pages_public", ttl_seconds=30)


class SitePageError(Exception):
    def __init__(self, detail: str, *, status: int = 422) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status = status


def _localized(row: dict, locale: str) -> tuple[str, str]:
    loc = locale if locale in _LOCALES else "vi"
    title = row[f"title_{loc}"].strip() or row["title_vi"]
    body = row[f"body_{loc}"].strip() or row["body_vi"]
    return title, body


def _row_dict(row: SitePage) -> dict:
    return {
        "slug": row.slug,
        "sort_order": row.sort_order,
        "show_in_footer": row.show_in_footer,
        "title_vi": row.title_vi,
        "title_en": row.title_en,
        "body_vi": row.body_vi,
        "body_en": row.body_en,
        "updated_at": row.updated_at,
        "updated_by_id": row.updated_by_id,
    }


def _row_admin(row: SitePage) -> dict:
    data = _row_dict(row)
    seed = DEFAULT_PAGES.get(row.slug)
    data["is_system"] = row.slug in SYSTEM_SLUGS
    data["customized"] = bool(seed) and any(
        data[key] != seed[key] for key in ("title_vi", "title_en", "body_vi", "body_en")
    )
    return data


async def _all_rows(db: AsyncSession) -> list[SitePage]:
    return list(
        (await db.execute(select(SitePage).order_by(SitePage.sort_order, SitePage.slug))).scalars().all()
    )


async def _public_rows(db: AsyncSession) -> list[dict]:
    cached = _public_cache.get()
    if cached is not None:
        return cached
    rows = [_row_dict(row) for row in await _all_rows(db)]
    _public_cache.set(rows)
    return rows


async def seed_defaults(db: AsyncSession) -> None:
    """Insert missing built-in slugs. Used by tests; production seeds via migration."""
    have = {row.slug for row in await _all_rows(db)}
    for slug, seed in DEFAULT_PAGES.items():
        if slug not in have:
            db.add(SitePage(slug=slug, show_in_footer=True, **seed))
    await db.flush()
    _public_cache.invalidate()


async def footer_links(db: AsyncSession, locale: str) -> list[dict]:
    return [
        {"slug": row["slug"], "title": _localized(row, locale)[0]}
        for row in await _public_rows(db)
        if row["show_in_footer"]
    ]


async def public_page(db: AsyncSession, slug: str, locale: str) -> dict | None:
    for row in await _public_rows(db):
        if row["slug"] == slug:
            title, body = _localized(row, locale)
            return {"slug": slug, "title": title, "body": body, "updated_at": row["updated_at"]}
    return None


async def list_pages(db: AsyncSession) -> dict:
    return {"items": [_row_admin(row) for row in await _all_rows(db)]}


async def _get(db: AsyncSession, slug: str) -> SitePage:
    row = await db.get(SitePage, slug)
    if row is None:
        raise SitePageError("page not found", status=404)
    return row


def _clean_text(value: str | None, *, required: bool) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if required and not text:
        raise SitePageError("vi title and body cannot be empty")
    return text


async def _audit(db: AsyncSession, actor_id: int, action: str, slug: str) -> None:
    await log_event(
        db, "info", f"Site page {action}",
        metadata={
            "event": f"site_page_{action}",
            "actor_id": actor_id,
            "actor_type": "admin",
            "subject_type": "site_page",
            "subject_id": slug,
            "outcome": "success",
            "source": "admin",
        },
    )


async def create_page(db: AsyncSession, *, actor_id: int, data: dict) -> dict:
    if await db.get(SitePage, data["slug"]) is not None:
        raise SitePageError("slug already exists", status=409)
    row = SitePage(
        slug=data["slug"],
        sort_order=data["sort_order"],
        show_in_footer=data["show_in_footer"],
        title_vi=_clean_text(data["title_vi"], required=True),
        title_en=_clean_text(data["title_en"], required=False),
        body_vi=_clean_text(data["body_vi"], required=True),
        body_en=_clean_text(data["body_en"], required=False),
        updated_by_id=actor_id,
    )
    db.add(row)
    await db.flush()
    await _audit(db, actor_id, "created", row.slug)
    await db.commit()
    await db.refresh(row)
    _public_cache.invalidate()
    return _row_admin(row)


async def update_page(db: AsyncSession, *, actor_id: int, slug: str, data: dict) -> dict:
    row = await _get(db, slug)
    for key in ("title_vi", "body_vi"):
        if (value := _clean_text(data.get(key), required=True)) is not None:
            setattr(row, key, value)
    for key in ("title_en", "body_en"):
        if (value := _clean_text(data.get(key), required=False)) is not None:
            setattr(row, key, value)
    if data.get("sort_order") is not None:
        row.sort_order = data["sort_order"]
    if data.get("show_in_footer") is not None:
        row.show_in_footer = data["show_in_footer"]
    row.updated_by_id = actor_id
    await db.flush()
    await _audit(db, actor_id, "updated", slug)
    await db.commit()
    await db.refresh(row)
    _public_cache.invalidate()
    return _row_admin(row)


async def reset_page(db: AsyncSession, *, actor_id: int, slug: str) -> dict:
    seed = DEFAULT_PAGES.get(slug)
    if seed is None:
        raise SitePageError("page has no default content")
    await _get(db, slug)
    return await update_page(
        db, actor_id=actor_id, slug=slug,
        data={key: seed[key] for key in ("title_vi", "title_en", "body_vi", "body_en")},
    )


async def delete_page(db: AsyncSession, *, actor_id: int, slug: str) -> None:
    if slug in SYSTEM_SLUGS:
        raise SitePageError("built-in pages cannot be deleted")
    row = await _get(db, slug)
    await db.delete(row)
    await db.flush()
    await _audit(db, actor_id, "deleted", slug)
    await db.commit()
    _public_cache.invalidate()
