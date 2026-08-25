from pydantic import BaseModel, field_validator

from src.products.covers import COVER_IDS


def _normalize_icon(value: object) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, str) and value in COVER_IDS:
        return value
    raise ValueError("icon must be an allowlisted cover id")


class CategoryCreate(BaseModel):
    name: str
    slug: str
    icon: str | None = None
    parent_id: int | None = None
    sort_order: int = 0
    commission_rate: float | None = None

    @field_validator("icon", mode="before")
    @classmethod
    def validate_icon(cls, value: object) -> str | None:
        return _normalize_icon(value)


class CategoryUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    commission_rate: float | None = None

    @field_validator("icon", mode="before")
    @classmethod
    def validate_icon(cls, value: object) -> str | None:
        return _normalize_icon(value)


class CategoryResponse(BaseModel):
    id: int
    name: str
    slug: str
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
