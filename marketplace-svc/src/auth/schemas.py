from datetime import datetime

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

    model_config = {"from_attributes": True}


class AccountAdminRow(BaseModel):
    id: int
    email: str
    roles: list[str]
    is_active: bool
    email_verified: bool = True
    totp_enabled: bool = False
    seller_tier: str
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedAccounts(BaseModel):
    items: list[AccountAdminRow]
    total: int
    page: int
    per_page: int


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
