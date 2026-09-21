"""Transport contract for the admin AI console."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AiProviderConfigOut(BaseModel):
    provider_kind: str
    base_url: str
    model: str
    fallback_models: list[str]
    # Deliberately a boolean: the stored key never leaves the server.
    api_key_configured: bool
    temperature: float
    timeout_seconds: int
    max_retries: int
    daily_token_budget: int
    is_enabled: bool
    updated_at: str | None = None
    updated_by_id: int | None = None


class AiProviderConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_kind: Literal["openai_compatible", "gemini_native"] | None = None
    base_url: str | None = Field(default=None, max_length=255)
    model: str | None = Field(default=None, max_length=100)
    fallback_models: list[str] | None = None
    # Write-only. "" clears the stored key; omitting the field keeps it.
    api_key: str | None = Field(default=None, max_length=512)
    temperature: float | None = Field(default=None, ge=0, le=2)
    timeout_seconds: int | None = Field(default=None, ge=1, le=120)
    max_retries: int | None = Field(default=None, ge=0, le=5)
    daily_token_budget: int | None = Field(default=None, ge=0)
    is_enabled: bool | None = None

    @field_validator("base_url")
    @classmethod
    def _http_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().rstrip("/")
        if not cleaned.startswith(("http://", "https://")):
            raise ValueError("base_url phải bắt đầu bằng http:// hoặc https://")
        return cleaned

    @field_validator("fallback_models")
    @classmethod
    def _bounded_fallbacks(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [v.strip() for v in value if v and v.strip()]
        if len(cleaned) > 5:
            raise ValueError("Tối đa 5 mô hình dự phòng")
        return cleaned


class AiConnectionTestResult(BaseModel):
    ok: bool
    model: str | None
    latency_ms: int | None
    used_fallback: bool
    error_kind: str | None
    message: str


class AiPromptOut(BaseModel):
    task: str
    locale: str
    system_prompt: str
    user_prompt: str
    updated_at: str | None = None
    updated_by_id: int | None = None


class AiPromptUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    system_prompt: str = Field(min_length=1, max_length=8000)
    user_prompt: str = Field(min_length=1, max_length=8000)


class AiUsageRow(BaseModel):
    task: str
    calls: int
    tokens: int
    failures: int


class AiUsageSummary(BaseModel):
    days: int
    items: list[AiUsageRow]
    # 0 = no ceiling configured.
    daily_token_budget: int
    # Trailing 24h, matching the window the budget check enforces.
    tokens_used_today: int
