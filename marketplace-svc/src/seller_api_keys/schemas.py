from datetime import datetime

from pydantic import BaseModel, Field


class SellerApiKeyCreated(BaseModel):
    """Returned only once, right after creation.

    api_secret is the HMAC key — never retrievable again after this response.
    api_key is the public key_id sent as X-API-Key.
    """
    id: int
    api_key: str = Field(description="Public key id (X-API-Key), prefix ak_live_")
    api_secret: str = Field(description="HMAC secret — store securely, shown once")
    signing_version: str = "v1"
    key_prefix: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SellerApiKeyResponse(BaseModel):
    id: int
    key_prefix: str
    signing_version: str = "v1"
    # Present for signed credentials; null for legacy bearer-only rows.
    key_id_masked: str | None = None
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None

    model_config = {"from_attributes": True}
