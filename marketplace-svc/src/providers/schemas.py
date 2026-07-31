from datetime import datetime

from pydantic import BaseModel, Field

from src.adapters.registry import ADAPTERS


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
    # Sổ Xu ước tính — chỉ có ý nghĩa với adapter_type="topproxy" (trả trước
    # bằng Xu, không có API xem số dư). NULL = chưa bật theo dõi.
    credit_balance_xu: int | None = None
    credit_low_threshold_xu: int | None = None
    credit_updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class ProviderCreditUpdate(BaseModel):
    """Admin nhập lại số dư Xu sau khi nạp trên topproxy.vn.

    Cũng đóng vai trò nút "đã nạp, bán lại đi": bật lại provider và gỡ cảnh báo
    hết tiền (src/providers/credit.py::set_credit_balance)."""

    balance_xu: int = Field(ge=0, description="Số Xu hiện có, đọc từ topproxy.vn")
    low_threshold_xu: int | None = Field(
        default=None, ge=0, description="Dưới mức này thì cảnh báo. Bỏ trống = giữ nguyên/mặc định.",
    )


class ProviderTestResponse(BaseModel):
    health: dict
    provision_test: dict | None = None
    # Vì sao KHÔNG có provision_test — `provision_test: null` một mình là mơ hồ
    # (không chạy? chạy rồi hỏng?), admin nhìn nút Test không đoán được. Câu
    # này hiển thị thẳng trên UI thay cho một ô trống.
    provision_test_skipped_reason: str | None = None


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

# Sinh từ AdapterSpec.seller_registrable (adapters/registry.py) — chỉ các
# adapter gọi ra backend NGOÀI nền tảng do seller tự khai. mock/seller_pool/
# manual là luồng nội bộ, topproxy/scrapecreators/dproxy là hạ tầng admin-curate
# dùng chung, không phải thứ một seller đơn lẻ được tự nhận.
SELLER_ALLOWED_ADAPTER_TYPES = {
    name for name, spec in ADAPTERS.items() if spec.seller_registrable
}


class SellerProviderCreate(BaseModel):
    name: str
    adapter_type: str
    config: dict = {}


class SellerProviderUpdate(BaseModel):
    config: dict | None = None
    is_active: bool | None = None


class AdminProviderReview(BaseModel):
    note: str | None = None


class TopProxySeedRequest(BaseModel):
    """Tham số MỘT LẦN cho POST /admin/providers/topproxy/seed — thay cho việc
    ssh vào server chạy tay scripts/seed_topproxy.py. Secrets chỉ sống trong
    request này: api_key được seed ghi vào DB (mã hoá bằng ENCRYPTION_KEY),
    seller_password chỉ dùng nếu phải tạo mới tài khoản seller."""

    base_url: str = "https://topproxy.vn"
    api_key: str = Field(min_length=1)
    # Script từ chối mật khẩu demo khi seed hàng thật — bắt tối thiểu 8 ký tự
    # từ tầng schema luôn cho đỡ một vòng thất bại.
    seller_password: str = Field(min_length=8)
    xoay_get_url: str | None = None


class TopProxySeedResponse(BaseModel):
    ok: bool
    # stdout của script (danh sách provider/sản phẩm đã tạo/cập nhật) — script
    # không bao giờ in api_key, mật khẩu thật in dạng "(theo TOPPROXY_SELLER_PASSWORD)".
    output: str
