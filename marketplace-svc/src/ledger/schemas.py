from datetime import datetime

from pydantic import BaseModel


class LedgerFinding(BaseModel):
    kind: str
    target_type: str
    target_id: int
    expected: int
    actual: int
    delta: int
    detail: str = ""


class LedgerRunResponse(BaseModel):
    id: int
    ran_at: datetime
    duration_ms: int
    trigger: str
    ok: bool
    wallets_checked: int
    orders_checked: int
    mismatch_count: int
    totals: dict
    findings: list[LedgerFinding]

    model_config = {"from_attributes": True}
