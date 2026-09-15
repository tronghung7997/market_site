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

    model_config = {"from_attributes": True}
