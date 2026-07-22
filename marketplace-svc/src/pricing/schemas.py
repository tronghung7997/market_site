from pydantic import BaseModel


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


class CalculateResponse(BaseModel):
    amount: int
    original_amount: int | None = None
    discount_pct: float | None = None
