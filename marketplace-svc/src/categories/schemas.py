from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    name: str
    slug: str
    icon: str | None = None
    parent_id: int | None = None
    sort_order: int = 0
    commission_rate: float | None = Field(default=None, ge=0, le=100)


class CategoryUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    commission_rate: float | None = Field(default=None, ge=0, le=100)


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
