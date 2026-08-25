from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    referral_code: str | None = None

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Mật khẩu không được vượt quá 72 byte")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AccountResponse(BaseModel):
    id: int
    email: str
    roles: list[str]
    seller_tier: str

    model_config = {"from_attributes": True}


class AccountAdminRow(BaseModel):
    id: int
    email: str
    roles: list[str]
    is_active: bool
    seller_tier: str
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedAccounts(BaseModel):
    items: list[AccountAdminRow]
    total: int
    page: int
    per_page: int


class UpdateRolesRequest(BaseModel):
    roles: list[str]


class UpdateSellerTierRequest(BaseModel):
    seller_tier: str
