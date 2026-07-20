from pydantic import BaseModel


class PricingOptionsResponse(BaseModel):
    strategy: str
    fields: list[dict]
    base_info: dict | None = None
    ready: bool = True
    not_ready_reason: str | None = None


class CalculateRequest(BaseModel):
    user_config: dict


class CalculateResponse(BaseModel):
    amount: int
    original_amount: int | None = None
    discount_pct: float | None = None
