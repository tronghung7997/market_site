from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ChangePerson(BaseModel):
    id: int
    email: str
    name: str | None = None


class ConfigChangeRequestOut(BaseModel):
    id: int
    section: str
    section_label: str
    # The section's own audit event: the client renders `diff` with the same
    # labels as the settings history (features/admin-logs/settings-audit.ts).
    settings_event: str | None
    href: str | None
    status: Literal["pending", "approved", "rejected", "cancelled", "superseded", "expired"]
    payload: dict[str, Any]
    diff: dict[str, Any]
    context: dict[str, Any] | None
    reason: str
    requested_by: ChangePerson | None
    requested_at: datetime
    expires_at: datetime
    decided_by: ChangePerson | None
    decided_at: datetime | None
    decision_note: str | None
    is_mine: bool
    can_approve: bool
    can_reject: bool
    can_cancel: bool


class ConfigChangeList(BaseModel):
    items: list[ConfigChangeRequestOut]
    next_before_id: int | None
    pending_count: int
    approval_required: bool
    expiry_days: int


class ConfigChangeDecision(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class ConfigChangeQueued(BaseModel):
    """202 body of a settings PATCH whose change waits for a second admin."""
    status: Literal["pending_approval"]
    request: ConfigChangeRequestOut
    # Fields applied at once anyway (maintenance, freezes, tier badges).
    applied_fields: list[str]
    config: dict[str, Any]
