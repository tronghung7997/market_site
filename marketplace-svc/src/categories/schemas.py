from pydantic import BaseModel, Field, field_validator

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
    parent_id: int | None = None
    sort_order: int = Field(default=0, ge=-1000, le=10000)
    commission_rate: float | None = Field(default=None, ge=0, le=100)

    @field_validator("icon", mode="before")
    @classmethod
    def validate_icon(cls, value: object) -> str | None:
        return _normalize_icon(value)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    # English storefront name (i18n.en.name); "" clears it so EN falls back to legacy.
    name_en: str | None = Field(default=None, max_length=100)
    slug: str | None = Field(default=None, min_length=1, max_length=100)
    icon: str | None = None
    # Present-and-null moves the category to the root (exclude_unset tells the two apart).
    parent_id: int | None = None
    sort_order: int | None = Field(default=None, ge=-1000, le=10000)
    is_active: bool | None = None
    commission_rate: float | None = Field(default=None, ge=0, le=100)

    @field_validator("icon", mode="before")
    @classmethod
    def validate_icon(cls, value: object) -> str | None:
        return _normalize_icon(value)


class CategoryResponse(BaseModel):
    id: int
    name: str = Field(min_length=1, max_length=100)
    slug: str = Field(min_length=1, max_length=100)
    icon: str | None
    parent_id: int | None
    sort_order: int
    is_active: bool
    commission_rate: float | None = None
    # Additive after locale-aware public catalog resolve (optional on admin CRUD).
    locale: str | None = None
    available_locales: list[str] | None = None

    model_config = {"from_attributes": True}


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
