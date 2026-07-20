from pydantic import BaseModel


class ActionItem(BaseModel):
    key: str
    severity: str  # "info" | "warning" | "critical"
    label: str
    count: int
    href: str
    dismissible: bool = False
    alert_id: int | None = None
