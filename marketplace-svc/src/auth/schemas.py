import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    referral_code: str | None = Field(default=None, max_length=16)
    locale: str = Field(default="vi", max_length=8)
    captcha_token: str | None = Field(default=None, max_length=4096)

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Mật khẩu không được vượt quá 72 byte")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)
    captcha_token: str | None = Field(default=None, max_length=4096)


class MfaChallengeResponse(BaseModel):
    """Password accepted; the session is issued by POST /auth/login/2fa."""
    mfa_required: bool = True
    mfa_token: str


class MfaLoginRequest(BaseModel):
    mfa_token: str = Field(min_length=20, max_length=1024)
    code: str = Field(min_length=6, max_length=16)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr
    locale: str = Field(default="vi", max_length=8)
    captcha_token: str | None = Field(default=None, max_length=4096)


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    password: str = Field(min_length=8, max_length=128)
    locale: str = Field(default="vi", max_length=8)

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Mật khẩu không được vượt quá 72 byte")
        return value


class PasswordResetAck(BaseModel):
    message: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=256)


class AccountResponse(BaseModel):
    id: int
    email: str
    roles: list[str]
    seller_tier: str
    email_verified: bool = True
    totp_enabled: bool = False
    # Marketplace-wide switch: when off the security page hides 2FA and
    # sign-in never asks for a code.
    mfa_available: bool = False
    # Admin whose console is locked until they enable TOTP (policy on).
    mfa_setup_required: bool = False
    is_internal: bool = False
    # Self-service profile (see ProfileUpdate).
    display_name: str | None = None
    phone: str | None = None
    telegram_username: str | None = None
    preferred_locale: str | None = None
    preferred_currency: str | None = None
    notification_prefs: dict[str, bool] = {}
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


NOTIFICATION_PREF_KEYS = ("orders", "disputes", "wallet", "marketing")


class ProfileUpdate(BaseModel):
    """PATCH /me — only the fields sent change; "" clears an optional one."""

    display_name: str | None = Field(default=None, max_length=80)
    phone: str | None = Field(default=None, max_length=32)
    telegram_username: str | None = Field(default=None, max_length=64)
    preferred_locale: str | None = Field(default=None, max_length=5)
    preferred_currency: str | None = Field(default=None, max_length=3)
    notification_prefs: dict[str, bool] | None = None

    @field_validator("display_name", "phone", "telegram_username", mode="before")
    @classmethod
    def _strip(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        if not value:
            return None
        digits = re.sub(r"[^0-9+]", "", value)
        if not re.fullmatch(r"\+?[0-9]{8,15}", digits):
            raise ValueError("Số điện thoại không hợp lệ")
        return value

    @field_validator("telegram_username")
    @classmethod
    def _telegram(cls, value: str | None) -> str | None:
        if not value:
            return None
        value = value.lstrip("@")
        if not re.fullmatch(r"[A-Za-z0-9_]{5,32}", value):
            raise ValueError("Tên Telegram gồm 5–32 ký tự chữ, số, gạch dưới")
        return value

    @field_validator("preferred_locale")
    @classmethod
    def _locale(cls, value: str | None) -> str | None:
        if not value:
            return None
        if value not in ("vi", "en"):
            raise ValueError("Ngôn ngữ không hỗ trợ")
        return value

    @field_validator("preferred_currency")
    @classmethod
    def _currency(cls, value: str | None) -> str | None:
        if not value:
            return None
        value = value.upper()
        if value not in ("VND", "USD"):
            raise ValueError("Tiền tệ không hỗ trợ")
        return value

    @field_validator("notification_prefs")
    @classmethod
    def _prefs(cls, value: dict[str, bool] | None) -> dict[str, bool] | None:
        if value is None:
            return None
        unknown = set(value) - set(NOTIFICATION_PREF_KEYS)
        if unknown:
            raise ValueError(f"Loại thông báo không hợp lệ: {', '.join(sorted(unknown))}")
        return value


class SessionRow(BaseModel):
    id: UUID
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime
    ip: str | None
    user_agent: str | None
    is_current: bool = False

    model_config = {"from_attributes": True}


class AccountAdminRow(BaseModel):
    id: int
    email: str
    roles: list[str]
    is_active: bool
    email_verified: bool = True
    totp_enabled: bool = False
    seller_tier: str
    is_internal: bool = False
    created_at: datetime
    last_login_at: datetime | None = None

    model_config = {"from_attributes": True}


class AccountsSummary(BaseModel):
    all: int = 0
    buyers: int = 0
    sellers: int = 0
    admins: int = 0
    locked: int = 0
    unverified: int = 0
    twofa: int = 0
    internal: int = 0
    new_7d: int = 0


class PaginatedAccounts(BaseModel):
    items: list[AccountAdminRow]
    total: int
    page: int
    per_page: int
    summary: AccountsSummary = AccountsSummary()


class UpdateRolesRequest(BaseModel):
    roles: list[str] = Field(min_length=1, max_length=3)


class UpdateSellerTierRequest(BaseModel):
    seller_tier: str


class UpdateAccountStatusRequest(BaseModel):
    is_active: bool
    reason: str | None = Field(default=None, max_length=500)


class LoginEventRow(BaseModel):
    id: int
    kind: str
    outcome: str
    ip: str | None
    user_agent: str | None
    actor_id: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)


class ResendVerificationRequest(BaseModel):
    locale: str = Field(default="vi", max_length=8)


class AuthRuntimeConfigResponse(BaseModel):
    require_email_verification: bool
    verification_link_hours: int
    mfa_feature_enabled: bool
    require_admin_2fa: bool
    require_2fa_for_withdrawal: bool
    turnstile_site_key: str
    # Whether the env secret exists — the site key alone does nothing.
    turnstile_secret_configured: bool = False
    updated_at: datetime | None = None
    updated_by_id: int | None = None


class AuthRuntimeConfigUpdate(BaseModel):
    require_email_verification: bool | None = None
    verification_link_hours: int | None = Field(default=None, ge=1, le=168)
    mfa_feature_enabled: bool | None = None
    require_admin_2fa: bool | None = None
    require_2fa_for_withdrawal: bool | None = None
    turnstile_site_key: str | None = Field(default=None, max_length=128)


class PublicAuthConfig(BaseModel):
    turnstile_site_key: str
    require_email_verification: bool
    mfa_enabled: bool


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
    locale: str = Field(default="vi", max_length=8)

    @field_validator("new_password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Mật khẩu không được vượt quá 72 byte")
        return value


class ChangeEmailRequest(BaseModel):
    new_email: EmailStr
    password: str = Field(max_length=128)
    locale: str = Field(default="vi", max_length=8)


class TotpSetupRequest(BaseModel):
    password: str = Field(max_length=128)


class TotpSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str


class TotpCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=16)


class TotpDisableRequest(BaseModel):
    password: str = Field(max_length=128)
    code: str = Field(min_length=6, max_length=16)


class BackupCodesResponse(BaseModel):
    backup_codes: list[str]


class UpdateInternalRequest(BaseModel):
    is_internal: bool
