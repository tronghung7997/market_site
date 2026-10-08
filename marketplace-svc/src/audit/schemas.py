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


class UpstreamExchangeSummary(BaseModel):
    """One supplier/payment call; bodies are fetched one row at a time."""

    id: int
    created_at: datetime
    integration: str
    method: str
    host: str
    path: str
    status_code: int | None
    outcome: str
    duration_ms: int
    error: str | None
    request_id: str | None
    job: str | None
    provider_id: int | None
    order_id: int | None
    operation: str | None
    request_bytes: int
    response_bytes: int
    truncated: bool

    model_config = {"from_attributes": True}


class UpstreamExchangeDetail(UpstreamExchangeSummary):
    url_path: str | None
    request_body: str | None
    response_body: str | None


class AuditEntityEvent(BaseModel):
    id: int
    event: str | None
    actor_email: str | None
    created_at: datetime
    details: dict
