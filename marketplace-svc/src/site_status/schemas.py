from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class AnnouncementPublic(BaseModel):
    level: str
    # text: render as plain text. html: allowlist-sanitized markup.
    format: str = "text"
    text_vi: str
    text_en: str
    link_url: str
    version: int


class SiteStatusPublic(BaseModel):
    maintenance_enabled: bool
    maintenance_message_vi: str
    maintenance_message_en: str
    maintenance_until: datetime | None
    withdrawals_frozen: bool
    deposits_frozen: bool
    orders_frozen: bool
    announcement: AnnouncementPublic | None
    # Effective image upload cap (MB) so clients can refuse a file before sending it.
    media_max_upload_mb: int = 10


class SiteStatusAdmin(BaseModel):
    maintenance_enabled: bool
    maintenance_message_vi: str
    maintenance_message_en: str
    maintenance_until: datetime | None
    withdrawals_frozen: bool
    deposits_frozen: bool
    orders_frozen: bool
    freeze_reason: str
    announcement_enabled: bool
    announcement_level: str
    announcement_format: str = "text"
    announcement_text_vi: str
    announcement_text_en: str
    announcement_link_url: str
    announcement_starts_at: datetime | None
    announcement_ends_at: datetime | None
    announcement_version: int
    # Image upload cap (MB); env MEDIA_MAX_UPLOAD_BYTES is the ceiling.
    media_max_upload_mb: int = 10
    updated_at: datetime | None = None
    updated_by_id: int | None = None


class SiteStatusUpdate(BaseModel):
    maintenance_enabled: bool | None = None
    maintenance_message_vi: str | None = Field(default=None, max_length=2000)
    maintenance_message_en: str | None = Field(default=None, max_length=2000)
    maintenance_until: datetime | None = None
    withdrawals_frozen: bool | None = None
    deposits_frozen: bool | None = None
    orders_frozen: bool | None = None
    freeze_reason: str | None = Field(default=None, max_length=500)
    announcement_enabled: bool | None = None
    announcement_level: Literal["info", "warn", "danger"] | None = None
    announcement_format: Literal["text", "html"] | None = None
    # ≤ 300 in text format, ≤ 1000 in html format (checked by the service).
    announcement_text_vi: str | None = Field(default=None, max_length=1000)
    announcement_text_en: str | None = Field(default=None, max_length=1000)
    announcement_link_url: str | None = Field(default=None, max_length=500)
    announcement_starts_at: datetime | None = None
    announcement_ends_at: datetime | None = None
    media_max_upload_mb: int | None = Field(default=None, ge=1, le=100)
    # Explicitly clear the nullable timestamps (None in JSON means "leave alone").
    clear_maintenance_until: bool = False
    clear_announcement_window: bool = False


class AnnouncementPreviewRequest(BaseModel):
    html: str = Field(default="", max_length=1000)


class AnnouncementPreviewResponse(BaseModel):
    # Exactly what the storefront would render for this input.
    html: str
