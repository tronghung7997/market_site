from datetime import datetime

from pydantic import BaseModel, Field


class ReviewCreate(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


class ReviewResponse(BaseModel):
    id: int
    order_id: int
    buyer_id: int
    product_id: int
    rating: int
    comment: str | None
    created_at: datetime
    variant_name: str | None = None
    seller_reply: str | None = None
    seller_replied_at: datetime | None = None
    is_auto: bool = False

    model_config = {"from_attributes": True}


class ReviewSummary(BaseModel):
    average: float | None = None
    counts: dict[int, int]


class PublicReviewList(BaseModel):
    items: list[ReviewResponse]
    total: int
    page: int
    per_page: int
    summary: ReviewSummary


class SellerReviewReply(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)


class SellerReviewRow(ReviewResponse):
    product_title: str | None = None
    is_hidden: bool = False


class SellerReviewList(BaseModel):
    items: list[SellerReviewRow]
    total: int
    unreplied: int
    page: int
    per_page: int


class AdminReviewRow(SellerReviewRow):
    buyer_email: str | None = None
    seller_id: int | None = None
    hidden_reason: str | None = None
    hidden_at: datetime | None = None
    hidden_by_id: int | None = None


class AdminReviewList(BaseModel):
    items: list[AdminReviewRow]
    total: int
    page: int
    per_page: int


class AdminReviewVisibility(BaseModel):
    hidden: bool
    reason: str | None = Field(default=None, max_length=500)
