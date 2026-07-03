from datetime import datetime

from pydantic import BaseModel


class SellerApplyRequest(BaseModel):
    business_name: str
    description: str | None = None
    contact: str | None = None


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
    reason: str
