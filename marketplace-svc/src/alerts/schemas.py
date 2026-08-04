from datetime import datetime

from pydantic import BaseModel


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
