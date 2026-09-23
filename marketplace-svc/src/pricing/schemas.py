from pydantic import BaseModel, Field, field_validator

from src.security.input_limits import bounded_mapping


class PricingOptionsResponse(BaseModel):
    strategy: str
    fields: list[dict]
    base_info: dict | None = None
    ready: bool = True
    not_ready_reason: str | None = None
    # Buyer-safe (no config/credentials) — lets the frontend give a
    # simplified, jargon-free purchase experience for adapters whose
    # fulfillment model doesn't fit the generic dynamic-pricing form (e.g.
    # DProxy: always exactly 1 proxy, never N per order). See
    # docs/superpowers/plans/2026-07-22-dproxy-consolidated-review.md P0/P1.
    adapter_type: str | None = None


class CalculateRequest(BaseModel):
    user_config: dict

    @field_validator("user_config")
    @classmethod
    def bound_user_config(cls, value):
        return bounded_mapping(value)


class CalculateResponse(BaseModel):
    amount: int
    original_amount: int | None = None
    discount_pct: float | None = None


class ProxyPlanDraft(BaseModel):
    type: str = Field(min_length=1, max_length=40)
    network: str = Field(min_length=1, max_length=60)
    days: int = Field(ge=1, le=3650)
    price: int | None = Field(default=None, ge=0, le=1_000_000_000)


class ProxyPlanQuoteRequest(BaseModel):
    plans: list[ProxyPlanDraft] = Field(min_length=1, max_length=200)
