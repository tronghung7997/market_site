"""Blog posts. Only published posts whose published_at has passed reach the
storefront (a future published_at is a scheduled post: no job flips it, every
public read filters on the clock). English copy falls back to Vietnamese field
by field. Covers are public media (post_cover)."""
from datetime import datetime, timezone

from fastapi import status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.exceptions import ErrorCode, api_error
from src.media import service as media_service
from src.media.service import public_image
from src.models.media import MediaPurpose
from src.models.post import Post

PAGE_SIZE = 12
LOCALE_FIELDS = ("title", "excerpt", "body", "meta_title", "meta_description")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _public(*where):
    """Filters of a post a visitor may read right now."""
    return (Post.status == "published", Post.published_at <= _now(), *where)


def _localized(post: Post, locale: str) -> dict:
    vi = (post.i18n or {}).get("vi") or {}
    en = (post.i18n or {}).get("en") or {}
    chosen = en if locale == "en" else vi
    return {field: (chosen.get(field) or vi.get(field) or "") for field in LOCALE_FIELDS}


def _summary(post: Post, locale: str) -> dict:
    text = _localized(post, locale)
    return {
        "slug": post.slug, "category": post.category, "title": text["title"], "excerpt": text["excerpt"],
        "cover": public_image(post.cover), "published_at": post.published_at, "tags": list(post.tags or []),
    }


def _seo(post: Post, locale: str) -> dict:
    """Head tags in one language: its own meta field, else its own title /
    excerpt, and only then the Vietnamese ones (an English page never gets a
    Vietnamese meta title while it has an English title)."""
    vi = (post.i18n or {}).get("vi") or {}
    en = (post.i18n or {}).get("en") or {}
    buckets = [en, vi] if locale == "en" else [vi]

    def pick(meta: str, plain: str) -> str:
        for bucket in buckets:
            value = (bucket.get(meta) or "").strip() or (bucket.get(plain) or "").strip()
            if value:
                return value
        return ""

    return {
        "meta_title": pick("meta_title", "title"),
        "meta_description": pick("meta_description", "excerpt"),
        "canonical_url": post.canonical_url,
    }


def _admin(post: Post) -> dict:
    i18n = post.i18n or {}
    return {
        "id": post.id, "slug": post.slug, "category": post.category, "status": post.status,
        "published_at": post.published_at,
        "scheduled": post.status == "published" and post.published_at is not None and post.published_at > _now(),
        "cover": public_image(post.cover),
        "vi": {f: (i18n.get("vi") or {}).get(f, "") for f in LOCALE_FIELDS},
        "en": {f: (i18n.get("en") or {}).get(f, "") for f in LOCALE_FIELDS},
        "tags": list(post.tags or []), "canonical_url": post.canonical_url,
        "updated_at": post.updated_at,
    }


async def public_list(db: AsyncSession, *, locale: str, category: str | None, page: int, per_page: int = PAGE_SIZE) -> dict:
    where = list(_public())
    if category:
        where.append(Post.category == category)
    total = await db.scalar(select(func.count(Post.id)).where(*where)) or 0
    posts = (await db.scalars(
        select(Post).where(*where).order_by(Post.published_at.desc(), Post.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )).all()
    return {"items": [_summary(p, locale) for p in posts], "total": int(total), "page": page, "per_page": per_page}


async def public_detail(slug: str, db: AsyncSession, *, locale: str) -> dict:
    post = await db.scalar(select(Post).where(*_public(Post.slug == slug)))
    if post is None:
        raise api_error(ErrorCode.POST_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    return {
        **_summary(post, locale), "body": _localized(post, locale)["body"], "updated_at": post.updated_at,
        "seo": _seo(post, locale),
    }


async def admin_list(db: AsyncSession) -> list[dict]:
    posts = (await db.scalars(select(Post).order_by(Post.updated_at.desc(), Post.id.desc()))).all()
    return [_admin(p) for p in posts]


def _check_publishable(data: dict) -> None:
    vi = data["vi"]
    if data.get("publish") and not (vi["title"] and vi["body"].strip()):
        raise api_error(ErrorCode.POST_INCOMPLETE, status.HTTP_422_UNPROCESSABLE_CONTENT)


async def _apply(post: Post, data: dict, db: AsyncSession, actor_id: int) -> None:
    post.slug = data["slug"]
    post.category = data["category"]
    post.i18n = {"vi": data["vi"], "en": data["en"]}
    post.tags = list(data.get("tags") or [])
    post.canonical_url = data.get("canonical_url")
    if data.get("publish"):
        if data.get("published_at") is not None:
            post.published_at = data["published_at"]
        elif post.status != "published" or post.published_at is None:
            post.published_at = _now()
        post.status = "published"
    else:
        post.status = "draft"
    await db.flush()
    snaps = await media_service.set_subject_media(
        db, actor_id=actor_id, purpose=MediaPurpose.post_cover, subject_type="post", subject_id=post.id,
        public_ids=[data["cover_image_id"]] if data.get("cover_image_id") else [], max_count=1,
    )
    post.cover = snaps[0] if snaps else None


async def create(data: dict, db: AsyncSession, *, actor_id: int) -> dict:
    _check_publishable(data)
    post = Post(slug=data["slug"], category=data["category"], author_id=actor_id, i18n={})
    db.add(post)
    try:
        await _apply(post, data, db, actor_id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise api_error(ErrorCode.POST_SLUG_TAKEN, status.HTTP_409_CONFLICT) from None
    await db.refresh(post)
    return _admin(post)


async def update(post_id: int, data: dict, db: AsyncSession, *, actor_id: int) -> dict:
    _check_publishable(data)
    post = await db.get(Post, post_id, with_for_update=True)
    if post is None:
        raise api_error(ErrorCode.POST_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    try:
        await _apply(post, data, db, actor_id)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise api_error(ErrorCode.POST_SLUG_TAKEN, status.HTTP_409_CONFLICT) from None
    await db.refresh(post)
    return _admin(post)


async def delete(post_id: int, db: AsyncSession, *, actor_id: int) -> None:
    post = await db.get(Post, post_id, with_for_update=True)
    if post is None:
        raise api_error(ErrorCode.POST_NOT_FOUND, status.HTTP_404_NOT_FOUND)
    await media_service.set_subject_media(
        db, actor_id=actor_id, purpose=MediaPurpose.post_cover, subject_type="post", subject_id=post.id,
        public_ids=[], max_count=1,
    )
    await db.delete(post)
    await db.commit()


async def sitemap_slugs(db: AsyncSession) -> list[dict]:
    """Slugs of posts a visitor can open now; scheduled posts stay out."""
    rows = (await db.execute(
        select(Post.slug, Post.updated_at).where(*_public()).order_by(Post.published_at.desc())
    )).all()
    return [{"slug": slug, "updated_at": updated_at} for slug, updated_at in rows]
