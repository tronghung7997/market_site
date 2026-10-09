from typing import Literal

from pydantic import BaseModel, Field, field_validator

from src.media.schemas import MediaId
from src.media.service import public_image
from src.products.covers import COVER_IDS


def _normalize_icon(value: object) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, str) and value in COVER_IDS:
        return value
    raise ValueError("icon must be an allowlisted cover id")


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    name_en: str | None = Field(default=None, max_length=100)
    slug: str = Field(min_length=1, max_length=100)
    icon: str | None = None
    # Upload id (POST /media/uploads, purpose category_image); shown instead of the icon.
    image_id: MediaId | None = None
    parent_id: int | None = None
    sort_order: int = Field(default=0, ge=-1000, le=10000)
    commission_rate: float | None = Field(default=None, ge=0, le=100)

    @field_validator("icon", mode="before")
    @classmethod
    def validate_icon(cls, value: object) -> str | None:
        return _normalize_icon(value)


class CategoryFaqItem(BaseModel):
    q: str = Field(min_length=1, max_length=200)
    a: str = Field(min_length=1, max_length=1000)


class CategoryContentLocale(BaseModel):
    """Buyer-facing copy of a category page in one language. Every field is
    optional; an empty value clears it (the page then falls back to the other
    language, then shows nothing)."""
    description: str | None = Field(default=None, max_length=300)
    # Markdown, rendered with raw HTML disabled.
    guide: str | None = Field(default=None, max_length=8000)
    faq: list[CategoryFaqItem] | None = Field(default=None, max_length=12)
    # <title> and meta description of the page (empty = the generic ones).
    seo_title: str | None = Field(default=None, max_length=70)
    seo_description: str | None = Field(default=None, max_length=170)
    # Short markdown lead shown above the offers (raw HTML disabled).
    intro: str | None = Field(default=None, max_length=2000)


class CategoryContentAdmin(BaseModel):
    vi: CategoryContentLocale
    en: CategoryContentLocale


class CategoryContentPublic(CategoryContentLocale):
    slug: str
    locale: str


class CategoryRedirectPublic(BaseModel):
    """Where an old category slug lives now."""
    slug: str


class CategoryRedirectRow(CategoryRedirectPublic):
    old_slug: str


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    # English storefront name (i18n.en.name); "" clears it so EN falls back to legacy.
    name_en: str | None = Field(default=None, max_length=100)
    slug: str | None = Field(default=None, min_length=1, max_length=100)
    icon: str | None = None
    # Present-and-null removes the uploaded image (the icon shows again).
    image_id: MediaId | None = None
    # Present-and-null moves the category to the root (exclude_unset tells the two apart).
    parent_id: int | None = None
    sort_order: int | None = Field(default=None, ge=-1000, le=10000)
    is_active: bool | None = None
    commission_rate: float | None = Field(default=None, ge=0, le=100)
    # Page copy per language; a locale that is present replaces that
    # language's description / guide / FAQ as a whole.
    content: dict[Literal["vi", "en"], CategoryContentLocale] | None = None

    @field_validator("icon", mode="before")
    @classmethod
    def validate_icon(cls, value: object) -> str | None:
        return _normalize_icon(value)


class CategoryResponse(BaseModel):
    id: int
    name: str = Field(min_length=1, max_length=100)
    slug: str = Field(min_length=1, max_length=100)
    icon: str | None
    image: dict | None = None
    parent_id: int | None
    sort_order: int
    is_active: bool
    commission_rate: float | None = None
    # Additive after locale-aware public catalog resolve (optional on admin CRUD).
    locale: str | None = None
    available_locales: list[str] | None = None

    model_config = {"from_attributes": True}

    @field_validator("image", mode="before")
    @classmethod
    def public_image_shape(cls, value):
        return public_image(value)


class CategoryTreeResponse(CategoryResponse):
    children: list["CategoryTreeResponse"] = []


class CategoryAdminRow(CategoryResponse):
    """Admin directory row: every category (hidden ones too) with what hangs off it."""

    name_en: str | None = None
    # Direct children / products, then the whole branch (this node + descendants).
    child_count: int
    product_count: int
    active_product_count: int
    branch_product_count: int
    branch_active_product_count: int
    seller_count: int


class CategoryAdminSummary(BaseModel):
    total: int
    roots: int
    active: int
    hidden: int
    empty: int


class CategoryAdminListResponse(BaseModel):
    items: list[CategoryAdminRow]
    summary: CategoryAdminSummary


class CategoryReorder(BaseModel):
    """Sibling ids in the wanted order; each gets sort_order = its index."""

    ids: list[int] = Field(min_length=1, max_length=500)
