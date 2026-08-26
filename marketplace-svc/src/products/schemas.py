from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from src.products.covers import parse_cover_id, public_images

CoverId = Literal[
    "facebook", "instagram", "tiktok", "youtube", "x",
    "proxy", "token", "endpoint", "cloud",
    "payment", "takedown", "account", "other",
]


def _reject_images_blob(data):
    if isinstance(data, dict) and "images" in data:
        raise ValueError("images is not accepted; use cover_id")
    return data


class ProductCreate(BaseModel):
    category_id: int
    title: str
    # Locale of the scalar buyer content in this command. Existing API clients
    # omit it and keep the historical VI behavior; the bilingual workbench
    # sends the seller-selected language explicitly.
    content_locale: Literal["en", "vi"] = "vi"
    description: str | None = None
    cover_id: CoverId | None = None
    escrow_days: int = 2
    status: Literal["draft", "active"] = "draft"
    service_type: str = "other"
    features: list[str] | None = None
    specs: dict | None = None
    warranty_text: str | None = None
    highlight_text: str | None = None
    # commission_rate is admin-controlled (set via /admin/products/{id}/operations),
    # not settable by sellers.

    @model_validator(mode="before")
    @classmethod
    def reject_images_blob(cls, data):
        return _reject_images_blob(data)


class ProductContentUpdate(BaseModel):
    title: str | None = None
    content_locale: Literal["en", "vi"] | None = None
    category_id: int | None = None
    description: str | None = None
    cover_id: CoverId | None = None
    escrow_days: int | None = None
    service_type: str | None = None
    features: list[str] | None = None
    specs: dict | None = None
    warranty_text: str | None = None
    highlight_text: str | None = None

    @model_validator(mode="before")
    @classmethod
    def reject_images_blob(cls, data):
        return _reject_images_blob(data)


class SellerProductUpdate(ProductContentUpdate):
    """Seller-editable content. Lifecycle status uses the dedicated status endpoint."""


class SellerProductStatusUpdate(BaseModel):
    status: Literal["active", "paused"]


class ProductUpdate(ProductContentUpdate):
    """Admin edit schema; admins may also change lifecycle status."""

    status: str | None = None


class ProductTranslationUpdate(BaseModel):
    """Buyer-facing content for one explicit locale.

    ``pricing_labels`` contains labels only; numeric pricing and machine keys
    remain in the common ``pricing_params`` object.
    """

    title: str | None = None
    description: str | None = None
    features: list[str] | None = None
    warranty_text: str | None = None
    highlight_text: str | None = None
    specs: dict | None = None
    pricing_labels: dict | None = None


class ProductResponse(BaseModel):
    id: int
    seller_id: int
    category_id: int
    title: str
    description: str | None
    images: dict | None
    cover_id: str | None = None
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

    @field_validator("images", mode="before")
    @classmethod
    def coerce_images(cls, value):
        return public_images(value)

    @model_validator(mode="after")
    def populate_cover_id(self):
        if self.cover_id is None:
            self.cover_id = parse_cover_id(self.images)
        return self


class VariantCreate(BaseModel):
    name: str
    content_locale: Literal["en", "vi"] = "vi"
    price: int = Field(ge=0)
    delivery_mode: Literal["instant", "manual"] = "instant"
    sla_hours: int = 24
    sort_order: int = 0
    duration_days: int | None = None


class VariantUpdate(BaseModel):
    name: str | None = None
    content_locale: Literal["en", "vi"] | None = None
    price: int | None = Field(default=None, ge=0)
    delivery_mode: Literal["instant", "manual"] | None = None
    sla_hours: int | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    duration_days: int | None = None


class VariantTranslationUpdate(BaseModel):
    name: str = Field(min_length=1)


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
    # Management detail responses expose raw locale buckets so sellers can
    # edit a translation without storefront fallback masking missing content.
    translations: dict[str, dict] | None = None
    primary_locale: str | None = None

    model_config = {"from_attributes": True}


class ProductListItemBase(BaseModel):
    """Bản GỌN của một sản phẩm cho mọi danh sách.

    Không mang description/specs/features/warranty_text — chỉ trang chi tiết
    cần, còn mô tả markdown dài hàng KB nhân N sản phẩm là payload phình vô
    ích. Không mang commission_rate — mức hoa hồng là thoả thuận admin↔seller,
    không phát ra API public. pricing_strategy/params phải giữ: frontend tính
    giá "Chỉ từ" thật từ chúng (lib/pricing-display.ts).

    Public list/detail also expose additive ``locale`` / ``available_locales``
    after server-side i18n resolve (Agent B catalog contract)."""
    id: int
    seller_id: int
    category_id: int
    title: str
    images: dict | None
    cover_id: str | None = None
    escrow_days: int
    status: str
    service_type: str | None
    highlight_text: str | None
    sold_count: int
    rating_avg: float | None
    rating_count: int
    pricing_strategy: str | None = None
    pricing_params: dict | None = None
    created_at: datetime
    locale: str | None = None
    available_locales: list[str] | None = None

    @field_validator("images", mode="before")
    @classmethod
    def coerce_images(cls, value):
        return public_images(value)

    @model_validator(mode="after")
    def populate_cover_id(self):
        if self.cover_id is None:
            self.cover_id = parse_cover_id(self.images)
        return self


class ProductListItemResponse(ProductListItemBase):
    """Item của GET /products — kèm gói + tồn kho để list không cần gọi chi
    tiết từng sản phẩm (fix N+1 trang chủ)."""
    variants: list[VariantResponse] = []


class ProductListPageResponse(BaseModel):
    """Phong bì phân trang GET /products, cùng khuôn orders."""
    items: list[ProductListItemResponse]
    total: int
    page: int
    per_page: int


class SellerProductResponse(ProductListItemBase):
    """Item của GET /seller/products — bảng quản lý cần số đếm, không cần
    danh sách gói đầy đủ."""
    category_name: str | None = None
    variant_count: int
    total_stock: int


class ProductDetailResponse(ProductListItemResponse):
    """GET /products/{id} và /seller/products/{id}/detail — bản đầy đủ.
    Vẫn KHÔNG có commission_rate; admin lấy qua GET /admin/products/{id}."""
    description: str | None
    features: list | None
    specs: dict | None
    warranty_text: str | None
    translations: dict[str, dict] | None = None
    primary_locale: str | None = None
    seller_name: str | None = None
    category_name: str | None = None


class AdminProductDetailResponse(ProductDetailResponse):
    """Chi tiết cho trang admin — thêm commission_rate (form hoa hồng đọc từ
    đây sau khi trường này rút khỏi response public)."""
    commission_rate: float | None = None
    seller_email: str | None = None


class ProductOperationsUpdate(BaseModel):
    provider_id: int | None = None
    pricing_strategy: str | None = None
    pricing_params: dict | None = None
    commission_rate: float | None = Field(default=None, ge=0, le=100)


class SellerPricingUpdate(BaseModel):
    """pricing_strategy/pricing_params do seller tự set trên sản phẩm của mình —
    tương tự việc seller đã tự đặt variant.price ở strategy fixed.
    commission_rate KHÔNG có ở đây, vẫn admin-only qua /admin/products/{id}/operations.
    provider_id GIỜ có — nhưng chỉ chấp nhận provider do chính seller đó tự
    đăng ký và đã được duyệt (products/service.py::update_seller_pricing
    validate lại, không tin schema layer)."""

    pricing_strategy: str | None = None
    pricing_params: dict | None = None
    provider_id: int | None = None


class ProductCoverItem(BaseModel):
    id: str
    group: str
    label: dict[str, str]


class ProductCoverCatalogResponse(BaseModel):
    items: list[ProductCoverItem]
