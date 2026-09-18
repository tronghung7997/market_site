from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class AnnouncementPublic(BaseModel):
    level: str
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
    announcement_text_vi: str
    announcement_text_en: str
    announcement_link_url: str
    announcement_starts_at: datetime | None
    announcement_ends_at: datetime | None
    announcement_version: int
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
    announcement_text_vi: str | None = Field(default=None, max_length=300)
    announcement_text_en: str | None = Field(default=None, max_length=300)
    announcement_link_url: str | None = Field(default=None, max_length=500)
    announcement_starts_at: datetime | None = None
    announcement_ends_at: datetime | None = None
    # Explicitly clear the nullable timestamps (None in JSON means "leave alone").
    clear_maintenance_until: bool = False
    clear_announcement_window: bool = False
