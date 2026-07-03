from datetime import datetime

from pydantic import BaseModel

from src.models.service_task import ServiceTaskStatus


class TaskResponse(BaseModel):
    id: int
    order_id: int
    platform: str
    target_url: str
    status: ServiceTaskStatus
    assignee: str | None = None
    result_data: str | None = None
    created_at: datetime
    updated_at: datetime
    order_status: str | None = None

    model_config = {"from_attributes": True}


class TaskUpdateRequest(BaseModel):
    status: ServiceTaskStatus | None = None
    assignee: str | None = None
    result_data: str | None = None
