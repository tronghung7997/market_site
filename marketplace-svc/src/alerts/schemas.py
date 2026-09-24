from datetime import datetime

from pydantic import BaseModel, Field


class AlertResponse(BaseModel):
    id: int
    type: str
    severity: str
    target_type: str
    target_id: int
    message: str
    is_active: bool
    created_at: datetime
    fingerprint: str | None = None
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    occurrence_count: int = 1
    resolved_at: datetime | None = None

    model_config = {"from_attributes": True}


class AlertRef(BaseModel):
    """A concrete record an alert is about, with the admin page that opens it."""
    kind: str
    id: int
    label: str
    detail: str | None = None
    href: str | None = None
    role: str | None = None


class AdminAlertResponse(BaseModel):
    id: int
    type: str
    fingerprint: str | None = None
    severity: str
    target_type: str
    target_id: int
    message: str
    is_active: bool
    created_at: datetime
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    occurrence_count: int = 1
    resolved_at: datetime | None = None
    admin_resolved_at: datetime | None = None
    admin_resolved_by: str | None = None
    admin_note: str | None = None
    # "ops" = operator incident; "user" = addressed to a seller/buyer, shown
    # to admins for oversight (resolving it here does not hide it from them).
    audience: str
    href: str | None = None
    refs: list[AlertRef] = []


class AlertResolveRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class AlertBulkResolveRequest(AlertResolveRequest):
    ids: list[int] = Field(min_length=1, max_length=500)
