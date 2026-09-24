from datetime import datetime

from pydantic import BaseModel, Field


class LogEntryResponse(BaseModel):
    id: int
    service: str
    level: str
    request_id: str | None
    job_id: str | None
    message: str
    metadata: dict | None = Field(default=None, validation_alias="metadata_")
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class LogRef(BaseModel):
    kind: str
    id: int
    label: str
    detail: str | None = None
    href: str | None = None
    role: str | None = None


class AdminLogEntry(BaseModel):
    id: int
    service: str
    level: str
    request_id: str | None
    job_id: str | None
    message: str
    metadata: dict | None = None
    created_at: datetime
    # Who acted (resolved account) and the records the event is about.
    actor: LogRef | None = None
    refs: list[LogRef] = []
