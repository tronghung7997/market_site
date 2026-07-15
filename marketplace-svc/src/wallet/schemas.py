from datetime import datetime

from pydantic import BaseModel


class WalletResponse(BaseModel):
    id: int
    account_id: int
    balance: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class TopupRequest(BaseModel):
    account_id: int
    amount: int


class TransactionResponse(BaseModel):
    id: int
    type: str
    amount: int
    description: str | None
    reference_id: str | None
    created_at: datetime
    order_status: str | None = None

    model_config = {"from_attributes": True}


class WithdrawRequestCreate(BaseModel):
    amount: int


class WithdrawRequestResponse(BaseModel):
    id: int
    account_id: int
    account_email: str | None = None
    amount: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class DemoTopupRequest(BaseModel):
    amount: int
