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
