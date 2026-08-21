from datetime import datetime

from pydantic import BaseModel, Field, field_validator


ALLOWED_API_KEY_SCOPES = {"orders:read", "orders:write", "resources:write"}
DEFAULT_API_KEY_SCOPES = sorted(ALLOWED_API_KEY_SCOPES)


class SellerApiKeyCreate(BaseModel):
    scopes: list[str] = Field(default_factory=lambda: list(DEFAULT_API_KEY_SCOPES), min_length=1, max_length=3)

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, scopes: list[str]) -> list[str]:
        cleaned = sorted(set(scopes))
        invalid = sorted(set(cleaned) - ALLOWED_API_KEY_SCOPES)
        if invalid:
            raise ValueError(f"Scope không hợp lệ: {', '.join(invalid)}")
        return cleaned


class SellerApiKeyCreated(BaseModel):
    """Returned only once, right after creation.

    api_secret is the HMAC key — never retrievable again after this response.
    api_key is the public key_id sent as X-API-Key.
    """
    id: int
    api_key: str = Field(description="Public key id (X-API-Key), prefix ak_live_")
    api_secret: str = Field(description="HMAC secret — store securely, shown once")
    signing_version: str = "v1"
    scopes: list[str]
    key_prefix: str
    created_at: datetime
    expires_at: datetime

    model_config = {"from_attributes": True}


class SellerApiKeyResponse(BaseModel):
    id: int
    key_prefix: str
    signing_version: str = "v1"
    # Present for signed credentials; null for legacy bearer-only rows.
    key_id_masked: str | None = None
    scopes: list[str]
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None

    model_config = {"from_attributes": True}
