from datetime import datetime

from pydantic import BaseModel


class ProductCreate(BaseModel):
    category_id: int
    title: str
    description: str | None = None
    images: list[str] | None = None
    escrow_days: int = 2
    status: str = "draft"
    service_type: str = "other"
    features: list[str] | None = None
    specs: dict | None = None
    warranty_text: str | None = None
    highlight_text: str | None = None
    # commission_rate is admin-controlled (set via /admin/products/{id}/operations),
    # not settable by sellers.


class ProductUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    images: list[str] | None = None
    escrow_days: int | None = None
    status: str | None = None
    service_type: str | None = None
    features: list[str] | None = None
    specs: dict | None = None
    warranty_text: str | None = None
    highlight_text: str | None = None


class ProductResponse(BaseModel):
    id: int
    seller_id: int
    category_id: int
    title: str
    description: str | None
    images: dict | None
    escrow_days: int
    status: str
    service_type: str | None
    features: list | None
    specs: dict | None
    warranty_text: str | None
    highlight_text: str | None
    sold_count: int
    rating_avg: float | None
    rating_count: int
    pricing_strategy: str | None = None
    pricing_params: dict | None = None
    commission_rate: float | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class VariantCreate(BaseModel):
    name: str
    price: int
    delivery_mode: str = "instant"
    sla_hours: int = 24
    sort_order: int = 0
    duration_days: int | None = None


class VariantUpdate(BaseModel):
    name: str | None = None
    price: int | None = None
    delivery_mode: str | None = None
    sla_hours: int | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    duration_days: int | None = None


class VariantResponse(BaseModel):
    id: int
    product_id: int
    name: str
    price: int
    delivery_mode: str
    sla_hours: int
    sort_order: int
    is_active: bool
    stock_count: int = 0
    duration_days: int | None = None

    model_config = {"from_attributes": True}


class ProductDetailResponse(ProductResponse):
    variants: list[VariantResponse] = []
    seller_email: str | None = None
    category_name: str | None = None


class ProductListResponse(ProductResponse):
    seller_email: str | None = None
    category_name: str | None = None


class ProductOperationsUpdate(BaseModel):
    provider_id: int | None = None
    pricing_strategy: str | None = None
    pricing_params: dict | None = None
    commission_rate: float | None = None


class SellerPricingUpdate(BaseModel):
    """pricing_strategy/pricing_params do seller tự set trên sản phẩm của mình —
    tương tự việc seller đã tự đặt variant.price ở strategy fixed. provider_id
    và commission_rate KHÔNG có ở đây, vẫn admin-only qua /admin/products/{id}/operations."""

    pricing_strategy: str | None = None
    pricing_params: dict | None = None
