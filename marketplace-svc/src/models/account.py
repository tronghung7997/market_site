from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base
from src.i18n.slug import new_public_key


class AccountRole(str, PyEnum):
    buyer = "buyer"
    seller = "seller"
    admin = "admin"


class SellerTier(str, PyEnum):
    new = "new"
    verified = "verified"
    trusted = "trusted"
    enterprise = "enterprise"


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    # Opaque public identity (seller URLs, chat counterparts). Never the id.
    public_key: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, default=new_public_key)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    roles: Mapped[list[str]] = mapped_column(ARRAY(String), default=["buyer"])
    is_active: Mapped[bool] = mapped_column(default=True)
    # Seller nội bộ (sàn vận hành): thấy khu Nguồn cung, được admin giao nguồn hàng.
    is_internal: Mapped[bool] = mapped_column(default=False, server_default="false", nullable=False)
    seller_tier: Mapped[SellerTier] = mapped_column(Enum(SellerTier), default=SellerTier.new, nullable=False)
    affiliate_code: Mapped[str] = mapped_column(
        String(8),
        unique=True,
        index=True,
        nullable=False,
        server_default=text("upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))"),
    )
    referred_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    registration_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    # NULL until the owner clicks the link we mailed them. Accounts that
    # existed before verification was introduced were backfilled as verified.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # TOTP two-factor: secret is encrypted at rest (security.crypto). A secret
    # with NULL enabled_at is a pending setup the user has not confirmed yet.
    totp_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # sha256 hashes of unused one-time backup codes.
    totp_backup_hashes: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    # Synthetic reviewer identity created by the trust-seed console. Cannot log
    # in (no usable password hash, is_active=false), receives no mail, and is
    # excluded from admin account lists, user counts and affiliate flows. Only
    # ever surfaces publicly through reviews.service.mask_reviewer().
    is_seeded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    @property
    def totp_enabled(self) -> bool:
        return self.totp_enabled_at is not None


class EmailVerificationToken(Base):
    """One-shot, hashed link token proving the account owner controls the mailbox."""

    __tablename__ = "email_verification_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Set when the link confirms a *new* address (email change); NULL for the
    # sign-up confirmation of the current address.
    new_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ApplicationStatus(str, PyEnum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class SellerApplication(Base):
    __tablename__ = "seller_applications"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(nullable=False)
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), nullable=True)
    contact: Mapped[str] = mapped_column(String(255), nullable=True)
    status: Mapped[ApplicationStatus] = mapped_column(Enum(ApplicationStatus), default=ApplicationStatus.pending)
    reject_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
