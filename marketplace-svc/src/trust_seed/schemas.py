"""Transport contract for the trust-seed console."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.trust_seed.service import MAX_BATCH_SIZE


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: int
    count: int = Field(default=10, ge=1, le=MAX_BATCH_SIZE)
    # Star weights, e.g. {"5": 60, "4": 25, "3": 15}. Omitted = house default,
    # which keeps a realistic low-star tail.
    distribution: dict[int, int] | None = None
    locale: str = Field(default="vi", max_length=8)
    # Free-form prompt for one call, without touching the saved template.
    system_override: str | None = Field(default=None, max_length=8000)
    user_override: str | None = Field(default=None, max_length=8000)
    # Appended to the rendered template ("nhấn mạnh tốc độ giao hàng").
    extra_instructions: str = Field(default="", max_length=2000)


class DraftRow(BaseModel):
    index: int
    rating: int
    comment: str | None
    seller_reply: str | None
    # Policy failures for this row; a non-empty list blocks apply.
    problems: list[str]


class GenerateResponse(BaseModel):
    product_id: int
    product_title: str
    model: str
    used_fallback: bool
    locale: str
    requested_count: int
    distribution: dict[int, int]
    product_context: str
    drafts: list[DraftRow]


class ApplyItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=500)
    seller_reply: str | None = Field(default=None, max_length=300)


class ApplyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: int
    items: list[ApplyItem] = Field(min_length=1, max_length=MAX_BATCH_SIZE)
    # Reviews are spread across this window so they do not all land at once.
    date_from: datetime
    date_to: datetime
    source: str = Field(default="ai", pattern="^(ai|manual)$")
    model: str | None = Field(default=None, max_length=100)
    locale: str = Field(default="vi", max_length=8)
    prompt_snapshot: str | None = Field(default=None, max_length=8000)
    options_snapshot: dict | None = None
    bump_sold_count: bool = True


class ApplyResponse(BaseModel):
    batch_id: int
    product_id: int
    review_count: int
    rating_avg: float | None
    rating_count: int


class BatchRow(BaseModel):
    id: int
    product_id: int
    status: str
    review_count: int
    source: str
    model: str | None
    locale: str
    created_by_id: int
    created_at: str | None
    purged_at: str | None


class PurgeResponse(BaseModel):
    batch_id: int
    product_id: int
    removed_reviews: int


class ProductSummary(BaseModel):
    product_id: int
    seeded_reviews: int
    total_visible_reviews: int
    real_reviews: int
    seed_pool_size: int
