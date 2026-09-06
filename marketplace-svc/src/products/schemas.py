from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from src.products.covers import parse_cover_id, public_images
from src.security.input_limits import bounded_mapping

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
    title: str = Field(min_length=1, max_length=255)
    # Locale of the scalar buyer content in this command. Existing API clients
    # omit it and keep the historical VI behavior; the bilingual workbench
    # sends the seller-selected language explicitly.
    content_locale: Literal["en", "vi"] = "vi"
    description: str | None = Field(default=None, max_length=20000)
    cover_id: CoverId | None = None
    escrow_days: int = Field(default=2, ge=0, le=90)
    status: Literal["draft", "active"] = "draft"
    service_type: str = Field(default="other", max_length=50)
    features: list[str] | None = Field(default=None, max_length=50)
    specs: dict | None = None
    warranty_text: str | None = Field(default=None, max_length=8000)
    highlight_text: str | None = Field(default=None, max_length=2000)

    @field_validator("specs")
    @classmethod
    def bound_specs(cls, value):
        return bounded_mapping(value) if value is not None else value

    @field_validator("features")
    @classmethod
    def bound_feature_items(cls, value):
        if value is None:
            return value
        for item in value:
            if len(item) > 500:
                raise ValueError("Each feature must be at most 500 characters")
        return value

    @model_validator(mode="before")
    @classmethod
    def reject_images_blob(cls, data):
        return _reject_images_blob(data)


class ProductContentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content_locale: Literal["en", "vi"] | None = None
    category_id: int | None = None
    description: str | None = Field(default=None, max_length=20000)
    cover_id: CoverId | None = None
    escrow_days: int | None = Field(default=None, ge=0, le=90)
    service_type: str | None = Field(default=None, max_length=50)
    features: list[str] | None = Field(default=None, max_length=50)
    specs: dict | None = None
    warranty_text: str | None = Field(default=None, max_length=8000)
    highlight_text: str | None = Field(default=None, max_length=2000)

    @field_validator("specs")
    @classmethod
    def bound_specs(cls, value):
        return bounded_mapping(value) if value is not None else value

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

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=20000)
    features: list[str] | None = Field(default=None, max_length=50)
    warranty_text: str | None = Field(default=None, max_length=8000)
    highlight_text: str | None = Field(default=None, max_length=2000)
    specs: dict | None = None
    pricing_labels: dict | None = None

    @field_validator("specs", "pricing_labels")
    @classmethod
    def bound_objects(cls, value):
        return bounded_mapping(value) if value is not None else value


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
    name: str = Field(min_length=1, max_length=255)
    content_locale: Literal["en", "vi"] = "vi"
    price: int = Field(ge=0)
    delivery_mode: Literal["instant", "manual"] = "instant"
    sla_hours: int = Field(default=24, ge=1, le=24 * 30)
    sort_order: int = Field(default=0, ge=-1000, le=10000)
    duration_days: int | None = Field(default=None, ge=1, le=3650)


class VariantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    content_locale: Literal["en", "vi"] | None = None
    price: int | None = Field(default=None, ge=0)
    delivery_mode: Literal["instant", "manual"] | None = None
    sla_hours: int | None = Field(default=None, ge=1, le=24 * 30)
    sort_order: int | None = Field(default=None, ge=-1000, le=10000)
    is_active: bool | None = None
    duration_days: int | None = Field(default=None, ge=1, le=3650)


class VariantTranslationUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


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


class ProductCatalogCategoryCount(BaseModel):
    category_id: int
    count: int


class ProductCatalogSummaryResponse(BaseModel):
    products: int
    variants: int
    available_stock: int
    category_counts: list[ProductCatalogCategoryCount]


class SellerProductResponse(ProductListItemBase):
    """Item của GET /seller/products — bảng quản lý cần số đếm, không cần
    danh sách gói đầy đủ."""
    category_name: str | None = None
    variant_count: int
    total_stock: int


class SellerProductCounts(BaseModel):
    all: int
    active: int
    paused: int
    low_stock: int
    out_of_stock: int
    total_stock: int


class SellerProductListResponse(BaseModel):
    items: list[SellerProductResponse]
    total: int
    page: int
    per_page: int
    counts: SellerProductCounts
    categories: list[str] = []
    service_types: list[str] = []


class AdminProductFacet(BaseModel):
    key: str
    count: int


class AdminProductCounts(BaseModel):
    all: int
    active: int
    draft: int
    paused: int
    suspended: int
    needs_setup: int
    total_revenue: int = 0


class AdminProductListResponse(BaseModel):
    items: list[dict]
    total: int
    page: int
    per_page: int
    counts: AdminProductCounts
    sellers: list[AdminProductFacet] = []
    providers: list[AdminProductFacet] = []
    services: list[AdminProductFacet] = []


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
    pricing_strategy: str | None = Field(default=None, max_length=50)
    pricing_params: dict | None = None
    commission_rate: float | None = Field(default=None, ge=0, le=100)

    @field_validator("pricing_params")
    @classmethod
    def bound_pricing_params(cls, value):
        return bounded_mapping(value) if value is not None else value


class SellerPricingUpdate(BaseModel):
    """pricing_strategy/pricing_params do seller tự set trên sản phẩm của mình —
    tương tự việc seller đã tự đặt variant.price ở strategy fixed.
    commission_rate KHÔNG có ở đây, vẫn admin-only qua /admin/products/{id}/operations.
    provider_id GIỜ có — nhưng chỉ chấp nhận provider do chính seller đó tự
    đăng ký và đã được duyệt (products/service.py::update_seller_pricing
    validate lại, không tin schema layer)."""

    pricing_strategy: str | None = Field(default=None, max_length=50)
    pricing_params: dict | None = None
    provider_id: int | None = None

    @field_validator("pricing_params")
    @classmethod
    def bound_pricing_params(cls, value):
        return bounded_mapping(value) if value is not None else value


class ProductCoverItem(BaseModel):
    id: str
    group: str
    label: dict[str, str]


class ProductCoverCatalogResponse(BaseModel):
    items: list[ProductCoverItem]
