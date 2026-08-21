from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class SellerApiKey(Base):
    __tablename__ = "seller_api_keys"
    __table_args__ = (Index("ix_seller_api_keys_account_expires", "account_id", "expires_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    # Legacy bearer key (X-Seller-Api-Key). sha256 hex of plaintext — not
    # bcrypt: the key already has 256 bits of entropy from secrets.token_urlsafe.
    # Nullable for signed-only credentials created after request-signing rollout.
    key_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    # Masked display of key_id (signed) or legacy key (bearer).
    key_prefix: Mapped[str] = mapped_column(String(24), nullable=False)
    # Public credential identifier for signed requests (X-API-Key: ak_live_…).
    key_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    # Fernet-encrypted API secret used as HMAC key. Never logged or returned
    # after the create response.
    signing_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    signing_version: Mapped[str] = mapped_column(String(8), nullable=False, server_default="v1")
    scopes: Mapped[list[str]] = mapped_column(
        ARRAY(String),
        nullable=False,
        server_default=text("ARRAY['orders:read','orders:write','resources:write']::varchar[]"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now() + interval '90 days'"),
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
