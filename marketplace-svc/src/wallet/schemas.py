from datetime import datetime

from pydantic import BaseModel, computed_field


class WalletResponse(BaseModel):
    id: int
    account_id: int
    pending_balance: int
    available_balance: int
    locked_balance: int
    updated_at: datetime

    model_config = {"from_attributes": True}

    @computed_field  # type: ignore[prop-decorator]
    @property
    def balance(self) -> int:
        """Alias tương thích ngược — "balance" cũ tương đương available_balance."""
        return self.available_balance


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
