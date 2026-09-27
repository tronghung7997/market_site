from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ActionItem(BaseModel):
    key: str
    severity: str  # "info" | "warning" | "critical"
    label: str
    count: int
    href: str
    dismissible: bool = False
    alert_id: int | None = None


NotificationCategory = Literal["order", "wallet", "message", "system"]


class NotificationItem(BaseModel):
    id: int
    category: NotificationCategory
    # Rendered by the client from ``kind`` + ``params`` in the reader's language.
    kind: str
    params: dict
    href: str | None
    read: bool
    created_at: datetime


class NotificationCounts(BaseModel):
    unread: int
    by_category: dict[str, int]


class NotificationPage(NotificationCounts):
    items: list[NotificationItem]
    next_cursor: int | None


class NotificationReadRequest(BaseModel):
    """Rows by id, a whole category, or (neither) everything."""
    ids: list[int] | None = Field(default=None, max_length=100)
    category: NotificationCategory | None = None
