from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

from src.i18n.slug import SLUG_PATTERN
from src.media.schemas import MediaId

Category = Literal["guide", "news"]


# Search engines cut titles at ~60 characters and snippets at ~160; a little
# headroom, then the editor shows the counter.
META_TITLE_MAX = 70
META_DESCRIPTION_MAX = 170
MAX_TAGS = 10
TAG_MAX = 40


class PostLocale(BaseModel):
    title: str = Field(default="", max_length=200)
    excerpt: str = Field(default="", max_length=400)
    body: str = Field(default="", max_length=60_000)
    # <title> / meta description; empty = the title / the excerpt.
    meta_title: str = Field(default="", max_length=META_TITLE_MAX)
    meta_description: str = Field(default="", max_length=META_DESCRIPTION_MAX)

    @field_validator("title", "excerpt", "meta_title", "meta_description", mode="before")
    @classmethod
    def trimmed(cls, value):
        return value.strip() if isinstance(value, str) else value


class PostWrite(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=SLUG_PATTERN)
    category: Category
    # vi is required to publish; en may stay empty (the storefront shows vi).
    vi: PostLocale
    en: PostLocale = PostLocale()
    # Upload id (purpose post_cover); null removes the cover.
    cover_image_id: MediaId | None = None
    publish: bool = False
    # With publish: when the post goes public. A future time schedules it
    # ("Hẹn giờ"); null keeps the current time (now for a first publish).
    published_at: datetime | None = None
    tags: list[str] = Field(default_factory=list, max_length=MAX_TAGS)
    # Absolute http(s) URL of the canonical copy when it lives elsewhere.
    canonical_url: str | None = Field(default=None, max_length=500)

    @field_validator("published_at")
    @classmethod
    def aware(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    @field_validator("tags", mode="before")
    @classmethod
    def clean_tags(cls, value):
        if not isinstance(value, list):
            return value
        out: list[str] = []
        for raw in value:
            if not isinstance(raw, str):
                raise ValueError("tags must be strings")
            tag = " ".join(raw.split()).lower()
            if not tag:
                continue
            if len(tag) > TAG_MAX:
                raise ValueError(f"a tag is at most {TAG_MAX} characters")
            if tag not in out:
                out.append(tag)
        return out

    @field_validator("canonical_url", mode="before")
    @classmethod
    def absolute_url(cls, value):
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("canonical_url must be a string")
        value = value.strip()
        if not value:
            return None
        parts = urlsplit(value)
        if parts.scheme not in ("http", "https") or not parts.netloc or any(c.isspace() for c in value):
            raise ValueError("canonical_url must be an absolute http(s) URL")
        return value


class PostSummary(BaseModel):
    slug: str
    category: Category
    title: str
    excerpt: str
    cover: dict | None
    published_at: datetime
    tags: list[str] = []


class PostSeo(BaseModel):
    """Resolved head tags of one post: meta_* already fall back to title / excerpt."""
    meta_title: str
    meta_description: str
    canonical_url: str | None = None


class PostDetail(PostSummary):
    body: str
    updated_at: datetime
    seo: PostSeo


class PostList(BaseModel):
    items: list[PostSummary]
    total: int
    page: int
    per_page: int


class PostAdmin(BaseModel):
    id: int
    slug: str
    category: Category
    status: Literal["draft", "published"]
    published_at: datetime | None
    # Published with a future published_at: public on its own at that time.
    scheduled: bool = False
    cover: dict | None
    vi: PostLocale
    en: PostLocale
    tags: list[str] = []
    canonical_url: str | None = None
    updated_at: datetime
