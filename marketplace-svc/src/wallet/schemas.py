from datetime import datetime

from pydantic import AliasChoices, BaseModel, Field, computed_field, field_validator

from src.media.schemas import MediaId
from src.media.service import private_images

MAX_PROOF_IMAGES = 3


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
    # Money of this account currently held in escrow, derived from open
    # orders (not a wallet column): what a buyer has paid for undelivered /
    # unconfirmed orders, and what a seller is waiting to receive.
    escrow_paid: int = 0
    escrow_incoming: int = 0
    # Open, unexpired deposit requests: money the buyer has sent or is about
    # to send that the wallet has not credited yet.
    pending_deposits: int = 0

    model_config = {"from_attributes": True}

    @computed_field  # type: ignore[prop-decorator]
    @property
    def balance(self) -> int:
        """Alias tương thích ngược — "balance" cũ tương đương available_balance."""
        return self.available_balance


class TopupRequest(BaseModel):
    account_id: int
    amount: int = Field(ge=1)
    # Why money is being created by hand — shown in the ledger row and the
    # audit log so a manual credit is never anonymous.
    reason: str = Field(min_length=3, max_length=500)
    # Evidence for the credit (upload ids, purpose adjustment_proof).
    proof_images: list[MediaId] = Field(default_factory=list, max_length=MAX_PROOF_IMAGES)

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("reason must be at least 3 characters")
        return value


class WalletDebitRequest(BaseModel):
    """Admin manual debit (ledger type adjustment_debit). Never overdraws."""
    amount: int = Field(ge=1)
    reason: str = Field(min_length=3, max_length=500)
    # Evidence (upload ids, purpose adjustment_proof); `proof_images` accepted as in topup.
    proof_media_ids: list[MediaId] = Field(
        default_factory=list, max_length=MAX_PROOF_IMAGES,
        validation_alias=AliasChoices("proof_media_ids", "proof_images"),
    )

    @field_validator("reason")
    @classmethod
    def strip_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("reason must be at least 3 characters")
        return value


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
    # Buyer/seller-facing reference: the order code (or provider reference for
    # deposits). reference_id keeps the internal form for idempotency/debugging.
    order_code: str | None = None
    # Admin manual credits: evidence images (PrivateImage shapes). Filled on the
    # admin ledger only; always empty on the owner's /wallet/transactions.
    proof_images: list[dict] = []
    reference_label: str | None = None
    # Rows of a withdrawal (lock / unlock / payout / fee): its request's status
    # (pending · approved · paid · rejected).
    withdraw_status: str | None = None
    # Sale payouts (purchase_release): the platform fee kept from that order;
    # the row's amount is already net of it.
    fee_amount: int | None = None
    # The row's order is a test order hidden from every order list (is_seeded):
    # the money moved, but no order list shows it.
    order_hidden: bool = False

    model_config = {"from_attributes": True}


class LedgerSummary(BaseModel):
    count: int
    # Money in / out of the available balance; `net` = in − out.
    in_: int = Field(alias="in", serialization_alias="in")
    out: int
    net: int
    open: int

    model_config = {"populate_by_name": True}


class LedgerPresent(BaseModel):
    groups: list[str]
    kinds: list[str]
    channels: list[str]


class LedgerPage(BaseModel):
    """GET /wallet/ledger: one page of the owner's rows and what the page header shows."""
    items: list[TransactionResponse]
    total: int
    page: int
    per_page: int
    summary: LedgerSummary
    # Rows per group under every filter except group / kind (for the group tabs).
    group_counts: dict[str, int]
    # Rows still open (held for an order, withdrawal under review) in the whole wallet.
    open_total: int
    # What the wallet has at all, so the page only offers filters that can match.
    present: LedgerPresent


class WithdrawRequestCreate(BaseModel):
    amount: int = Field(ge=1)
    # Snapshot thông tin nhận tiền — bắt buộc từ 2026-07-24 (thiết kế PayOS §4).
    # bank_bin (mã BIN ngân hàng) để phase 2 auto-payout qua PayOS; nhập tay
    # thì FE gửi kèm theo tên ngân hàng đã chọn.
    bank_name: str = Field(min_length=2, max_length=100)
    bank_account_number: str = Field(min_length=4, max_length=50)
    bank_account_holder: str = Field(min_length=2, max_length=100)
    bank_bin: str | None = Field(default=None, max_length=20)
    # TOTP or backup code; required when the admin policy demands 2FA for withdrawals.
    totp_code: str | None = Field(default=None, max_length=16)


class WithdrawMarkPaidRequest(BaseModel):
    payout_reference: str = Field(min_length=2, max_length=100)
    # Bank transfer receipts (upload ids, purpose payout_receipt).
    receipt_images: list[MediaId] = Field(default_factory=list, max_length=MAX_PROOF_IMAGES)


class WithdrawRejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class WithdrawRequestResponse(BaseModel):
    id: int
    account_id: int
    account_email: str | None = None
    amount: int
    status: str
    bank_name: str | None = None
    bank_account_number: str | None = None
    bank_account_holder: str | None = None
    bank_bin: str | None = None
    payout_reference: str | None = None
    paid_at: datetime | None = None
    reject_reason: str | None = None
    fee_amount: int = 0
    net_amount: int | None = None
    # PrivateImage shapes; owner: GET /wallet/withdrawals/{id}/receipt/{media_id}.
    receipt_images: list[dict] = Field(default_factory=list, validation_alias=AliasChoices("receipt_images", "receipt_media"))
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("receipt_images", mode="before")
    @classmethod
    def receipt_shapes(cls, value):
        return private_images(value)


class DemoTopupRequest(BaseModel):
    amount: int = Field(ge=1)
