from datetime import datetime

from pydantic import BaseModel


class ProviderCreate(BaseModel):
    name: str
    # "type" từng là field bắt buộc riêng nhưng không nơi nào trong UI hiển thị
    # hay dùng nó — chỉ gây nhầm với adapter_type (cái thật sự quyết định hành
    # vi). Cho phép bỏ trống; router tự set = adapter_type nếu admin không điền.
    type: str = ""
    config: dict = {}
    priority: int = 1
    # Trước đây phải tạo xong rồi PUT riêng mới set được adapter_type — nghĩa
    # là provider mới luôn "mock" một cách âm thầm cho tới lần sửa thứ hai.
    # Cho set ngay lúc tạo để đây là một bước duy nhất, không phải hai.
    adapter_type: str = "mock"
    is_active: bool = True


class ProviderUpdateRequest(BaseModel):
    adapter_type: str | None = None
    config: dict | None = None
    fallback_provider_id: int | None = None
    is_active: bool | None = None


class ProviderResponse(BaseModel):
    id: int
    name: str
    type: str
    config: dict
    priority: int
    is_active: bool
    adapter_type: str = "mock"
    fallback_provider_id: int | None = None
    quality_score: float | None = None
    seller_id: int | None = None
    review_status: str = "approved"
    review_note: str | None = None

    model_config = {"from_attributes": True}


class ProviderTestResponse(BaseModel):
    health: dict
    provision_test: dict | None = None


class ProviderHealthResponse(BaseModel):
    id: int
    provider_id: int
    checked_at: datetime
    latency_ms: int | None
    success_rate: float
    status: str

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Seller self-service (Part A của spec 2026-07-21) — seller đăng ký backend
# của chính họ, luôn pending_review cho tới khi admin duyệt.
# ---------------------------------------------------------------------------

# Chỉ 2 adapter_type này gọi ra một backend NGOÀI nền tảng do seller tự khai —
# mock/seller_pool/manual là luồng nội bộ, topproxy/scrapecreators là hạ tầng
# admin-curate dùng chung, không phải thứ một seller đơn lẻ được tự nhận.
SELLER_ALLOWED_ADAPTER_TYPES = {"seller_gateway", "seller_task_webhook"}


class SellerProviderCreate(BaseModel):
    name: str
    adapter_type: str
    config: dict = {}


class SellerProviderUpdate(BaseModel):
    config: dict | None = None
    is_active: bool | None = None


class AdminProviderReview(BaseModel):
    note: str | None = None
