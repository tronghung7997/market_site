from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class TransactionType(str, PyEnum):
    topup = "topup"
    # Nạp tiền thật qua cổng thanh toán (PayOS) — tách khỏi `topup` (admin gõ
    # tay) để đối soát doanh thu nạp không lẫn thao tác vận hành.
    deposit = "deposit"
    purchase_hold = "purchase_hold"
    purchase_release = "purchase_release"
    platform_fee = "platform_fee"
    withdraw = "withdraw"
    withdraw_lock = "withdraw_lock"
    withdraw_unlock = "withdraw_unlock"
    refund = "refund"
    affiliate_commission = "affiliate_commission"
    # Bút toán đối soát: sổ giao dịch và available_balance lệch nhau vì migration
    # q1a2b3c4d5e6 chuyển tiền giữa các lớp số dư bằng SQL thô, không ghi sổ.
    # Không sửa quá khứ — ghi nhận chênh lệch để sổ cộng ra đúng số dư từ đây.
    adjustment_credit = "adjustment_credit"
    adjustment_debit = "adjustment_debit"


class TransactionDirection(str, PyEnum):
    in_ = "in"
    out = "out"
    neutral = "neutral"


# Nguồn sự thật duy nhất về việc mỗi loại giao dịch tác động available_balance ra
# sao. Trước đây frontend tự suy diễn bằng một set 3 phần tử và mặc định phủ định
# ("không nằm trong set thì là tiền ra"), nên mọi loại quên liệt kê đều âm thầm bị
# tính là tiền ra — đó chính là bug làm tổng vào/ra không cộng ra được số dư.
# Mọi thay đổi available_balance đều ghi kèm một Transaction đúng số tiền, nên:
#   Σ(in) − Σ(out) == available_balance
# Mọi amount đều dương; dấu suy ra từ đây, không bao giờ từ giá trị.
TRANSACTION_DIRECTION: dict[str, TransactionDirection] = {
    TransactionType.topup: TransactionDirection.in_,
    TransactionType.deposit: TransactionDirection.in_,
    TransactionType.purchase_release: TransactionDirection.in_,
    TransactionType.refund: TransactionDirection.in_,
    TransactionType.affiliate_commission: TransactionDirection.in_,
    TransactionType.withdraw_unlock: TransactionDirection.in_,
    TransactionType.platform_fee: TransactionDirection.in_,
    TransactionType.adjustment_credit: TransactionDirection.in_,
    TransactionType.purchase_hold: TransactionDirection.out,
    TransactionType.withdraw_lock: TransactionDirection.out,
    TransactionType.adjustment_debit: TransactionDirection.out,
    # Tiền đã rời available từ lúc withdraw_lock; dòng này chỉ rút khỏi
    # locked_balance. Tính nó là tiền ra nữa là đếm hai lần.
    TransactionType.withdraw: TransactionDirection.neutral,
}


class WithdrawStatus(str, PyEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"
    # Admin đã chuyển khoản thật xong (kèm payout_reference) — approved chỉ là
    # "đồng ý chi", paid mới là "tiền đã rời tài khoản".
    paid = "paid"


class Wallet(Base):
    __tablename__ = "wallets"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), unique=True, nullable=False)
    # pending_balance: tiền escrow chờ giao dịch hoàn tất — không track riêng ở
    # đợt này, escrow vẫn theo Order.status như trước; luôn = 0 cho tới khi có
    # nhu cầu mở rộng.
    pending_balance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # available_balance: tương đương "balance" cũ — tiền tự do dùng/rút.
    available_balance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # locked_balance: tiền bị khoá vì một withdraw request đang chờ admin duyệt.
    locked_balance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    wallet_id: Mapped[int] = mapped_column(ForeignKey("wallets.id"), nullable=False)
    type: Mapped[TransactionType] = mapped_column(Enum(TransactionType), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WithdrawRequest(Base):
    __tablename__ = "withdraw_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[WithdrawStatus] = mapped_column(Enum(WithdrawStatus), default=WithdrawStatus.pending)
    # Snapshot thông tin nhận tiền TẠI THỜI ĐIỂM yêu cầu — seller đổi số tài
    # khoản sau đó không được ảnh hưởng lệnh cũ. bank_bin để phase 2 gọi PayOS
    # Payout API (`toBin`). Nullable vì lệnh cũ trước migration không có.
    bank_bin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    bank_account_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    bank_account_holder: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Mã tham chiếu giao dịch admin điền khi bấm "Đã chi".
    payout_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
