from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator


class MailConfigAdmin(BaseModel):
    provider: Literal["log", "smtp", "resend"]
    mail_from: str
    mail_from_name: str
    worker_enabled: bool
    env_provider: Literal["log", "smtp", "resend"]
    env_mail_from: str
    env_mail_from_name: str
    env_worker_enabled: bool
    resend_api_key_configured: bool
    smtp_host_configured: bool
    smtp_credentials_configured: bool
    smtp_host: str | None = None
    smtp_port: int
    effective_ready: bool
    effective_mode: str
    frontend_base_url: str
    updated_at: datetime | None = None
    updated_by_id: int | None = None
    source: str = "db"


class MailConfigUpdate(BaseModel):
    provider: Literal["log", "smtp", "resend"] | None = None
    mail_from: str | None = Field(None, max_length=255)
    mail_from_name: str | None = Field(None, max_length=80)
    worker_enabled: bool | None = None

    @model_validator(mode="after")
    def at_least_one(self):
        if (
            self.provider is None
            and self.mail_from is None
            and self.mail_from_name is None
            and self.worker_enabled is None
        ):
            raise ValueError("At least one field is required")
        return self


class MailSendTestRequest(BaseModel):
    to_email: EmailStr
    locale: Literal["vi", "en"] = "vi"


class MailSendTestResponse(BaseModel):
    id: int
    status: str
    to_email: str
    effective_mode: str
    logged_only: bool
    last_error: str | None = None


class MailOutboxRow(BaseModel):
    id: int
    template: str
    to_email: str
    account_id: int | None = None
    locale: str
    status: str
    attempts: int
    last_error: str | None = None
    scheduled_at: datetime
    sent_at: datetime | None = None
    created_at: datetime | None = None


class MailOutboxList(BaseModel):
    items: list[MailOutboxRow]
    total: int
    limit: int
    offset: int
