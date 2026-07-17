from datetime import datetime

from pydantic import BaseModel, computed_field


class WithdrawPolicy(BaseModel):
    """Điều kiện rút tiền của chính tài khoản này, để UI hiện hạn mức TRƯỚC khi
    seller bấm rút thay vì báo lỗi sau. Backend giữ bảng tier→hạn mức
    (`sellers/tiers.py`); client không suy diễn lại."""

    tier: str
    # None = không giới hạn (cấp enterprise). Phân biệt với `withdraw_policy`
    # bằng None ở ngoài, nghĩa là tài khoản không phải seller nên không rút được.
    limit_per_request: int | None


class WalletResponse(BaseModel):
    id: int
    account_id: int
    pending_balance: int
    available_balance: int
    locked_balance: int
    updated_at: datetime
    withdraw_policy: WithdrawPolicy | None = None

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
    # "in" | "out" | "neutral" — tác động lên available_balance. Backend sở hữu
    # ngữ nghĩa này (models/wallet.py::TRANSACTION_DIRECTION) thay vì để mỗi client
    # tự đoán theo type.
    direction: str
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
