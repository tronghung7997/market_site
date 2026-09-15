from datetime import datetime

from pydantic import BaseModel, Field


class ReviewCreate(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


class ReviewResponse(BaseModel):
    """Public review row. Buyer account id and order id are deliberately not
    exposed: both are sequential and let anyone count accounts and orders."""
    id: int
    product_id: int
    # Masked reviewer handle for display, e.g. "ng***n".
    reviewer_label: str
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
    rating: int | None = None
    summary: ReviewSummary


class SellerReviewReply(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)


class SellerReviewRow(ReviewResponse):
    """Seller/admin row: order and buyer ids are fine here — the seller
    fulfilled that order and sees it in their console anyway."""
    order_id: int
    buyer_id: int
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
