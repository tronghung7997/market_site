from datetime import datetime

from pydantic import BaseModel


class BulkResourceCreate(BaseModel):
    items: list[str]


class ResourceUpdate(BaseModel):
    data: str


class InventoryVariantSummary(BaseModel):
    product_id: int
    product_title: str
    variant_id: int
    variant_name: str
    delivery_mode: str | None = None
    is_active: bool
    available: int
    assigned: int
    expired: int
    error: int


class BulkResourceResponse(BaseModel):
    count: int


class ResourceResponse(BaseModel):
    id: int
    variant_id: int
    status: str
    data: str
    order_id: int | None = None
    assigned_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ResourceStatusSummary(BaseModel):
    available: int
    assigned: int
    expired: int
    error: int


class ResourceSellerFacet(BaseModel):
    seller_id: int
    seller_email: str | None = None
    count: int


class InternalAcquireRequest(BaseModel):
    variant_id: int
    quantity: int = 1


class InternalAcquireResponse(BaseModel):
    resources: list[dict]


class InternalReleaseRequest(BaseModel):
    resource_ids: list[int]


class AdminResourceResponse(BaseModel):
    id: int
    variant_id: int
    seller_id: int
    status: str
    order_id: int | None = None
    assigned_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime
    variant_name: str | None = None
    product_title: str | None = None
    product_id: int | None = None
    seller_email: str | None = None

    model_config = {"from_attributes": True}


class AdminResourceListResponse(BaseModel):
    items: list[AdminResourceResponse]
    total: int
    page: int
    per_page: int
