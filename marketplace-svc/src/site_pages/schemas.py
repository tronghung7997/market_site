from datetime import datetime

from pydantic import BaseModel, Field

SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
TITLE_MAX = 160
BODY_MAX = 60_000


class SitePageLink(BaseModel):
    slug: str
    title: str


class SitePagePublic(BaseModel):
    slug: str
    title: str
    body: str
    updated_at: datetime | None


class SitePageAdmin(BaseModel):
    slug: str
    sort_order: int
    show_in_footer: bool
    title_vi: str
    title_en: str
    body_vi: str
    body_en: str
    is_system: bool
    customized: bool
    updated_at: datetime | None
    updated_by_id: int | None


class SitePageList(BaseModel):
    items: list[SitePageAdmin]


class SitePageCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=64, pattern=SLUG_PATTERN)
    sort_order: int = Field(default=100, ge=0, le=10_000)
    show_in_footer: bool = True
    title_vi: str = Field(min_length=1, max_length=TITLE_MAX)
    title_en: str = Field(default="", max_length=TITLE_MAX)
    body_vi: str = Field(min_length=1, max_length=BODY_MAX)
    body_en: str = Field(default="", max_length=BODY_MAX)


class SitePageUpdate(BaseModel):
    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    show_in_footer: bool | None = None
    title_vi: str | None = Field(default=None, min_length=1, max_length=TITLE_MAX)
    title_en: str | None = Field(default=None, max_length=TITLE_MAX)
    body_vi: str | None = Field(default=None, min_length=1, max_length=BODY_MAX)
    body_en: str | None = Field(default=None, max_length=BODY_MAX)
