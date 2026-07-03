from datetime import datetime

from pydantic import BaseModel


class ProviderCreate(BaseModel):
    name: str
    type: str
    config: dict
    priority: int = 1


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
