from datetime import datetime

from pydantic import BaseModel, EmailStr


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    referral_code: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AccountResponse(BaseModel):
    id: int
    email: str
    roles: list[str]

    model_config = {"from_attributes": True}


class AccountAdminRow(BaseModel):
    id: int
    email: str
    roles: list[str]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedAccounts(BaseModel):
    items: list[AccountAdminRow]
    total: int
    page: int
    per_page: int


class UpdateRolesRequest(BaseModel):
    roles: list[str]
