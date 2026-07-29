from datetime import datetime

from pydantic import BaseModel


class DepositCreateRequest(BaseModel):
    amount: int


class DepositResponse(BaseModel):
    id: int
    amount: int
    status: str
    checkout_url: str | None = None
    qr_code: str | None = None
    paid_amount: int | None = None
    created_at: datetime
    expires_at: datetime
    paid_at: datetime | None = None

    model_config = {"from_attributes": True}


class AdminDepositResponse(DepositResponse):
    account_id: int
    account_email: str | None = None
    payment_link_id: str | None = None
    payos_reference: str | None = None
