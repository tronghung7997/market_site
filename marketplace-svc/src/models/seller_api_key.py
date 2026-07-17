from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SellerApiKey(Base):
    __tablename__ = "seller_api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    # sha256 hex of the plaintext key — not bcrypt: the key already has 256
    # bits of entropy from secrets.token_urlsafe, so bcrypt's deliberate
    # slowness (meant to blunt brute-forcing low-entropy passwords) would
    # just add latency to every API-key-authenticated request for no benefit.
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    key_prefix: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
