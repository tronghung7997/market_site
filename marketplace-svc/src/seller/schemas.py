from datetime import datetime

from pydantic import BaseModel, Field


class SellerApplyRequest(BaseModel):
    business_name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=1000)
    contact: str | None = Field(default=None, max_length=255)


class SellerApplicationResponse(BaseModel):
    id: int
    account_id: int
    business_name: str
    description: str | None
    contact: str | None
    status: str
    reject_reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
