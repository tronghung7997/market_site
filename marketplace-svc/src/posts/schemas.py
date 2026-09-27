from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from src.i18n.slug import SLUG_PATTERN
from src.media.schemas import MediaId

Category = Literal["guide", "news"]


class PostLocale(BaseModel):
    title: str = Field(default="", max_length=200)
    excerpt: str = Field(default="", max_length=400)
    body: str = Field(default="", max_length=60_000)

    @field_validator("title", "excerpt")
    @classmethod
    def trimmed(cls, value: str) -> str:
        return value.strip()


class PostWrite(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=SLUG_PATTERN)
    category: Category
    # vi is required to publish; en may stay empty (the storefront shows vi).
    vi: PostLocale
    en: PostLocale = PostLocale()
    # Upload id (purpose post_cover); null removes the cover.
    cover_image_id: MediaId | None = None
    publish: bool = False


class PostSummary(BaseModel):
    slug: str
    category: Category
    title: str
    excerpt: str
    cover: dict | None
    published_at: datetime


class PostDetail(PostSummary):
    body: str
    updated_at: datetime


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
    cover: dict | None
    vi: PostLocale
    en: PostLocale
    updated_at: datetime
