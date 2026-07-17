from datetime import datetime

from pydantic import BaseModel


class SellerApiKeyCreated(BaseModel):
    """Returned only once, right after creation — the plaintext key is never
    retrievable again after this response."""
    id: int
    key: str
    key_prefix: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SellerApiKeyResponse(BaseModel):
    id: int
    key_prefix: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None

    model_config = {"from_attributes": True}
