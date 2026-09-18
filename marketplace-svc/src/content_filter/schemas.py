from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ContentFilterConfigResponse(BaseModel):
    enabled: bool
    action: str
    keywords: list[str]
    block_phone_numbers: bool
    block_links: bool
    mask_char: str
    updated_at: datetime | None = None
    updated_by_id: int | None = None


class ContentFilterConfigUpdate(BaseModel):
    enabled: bool | None = None
    action: Literal["block", "mask"] | None = None
    keywords: list[str] | None = Field(default=None, max_length=200)
    block_phone_numbers: bool | None = None
    block_links: bool | None = None
    mask_char: str | None = Field(default=None, min_length=1, max_length=1)


class ContentFilterTestRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ContentFilterTestResponse(BaseModel):
    blocked: bool
    text: str
    matches: list[str]
