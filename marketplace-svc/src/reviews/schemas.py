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

    model_config = {"from_attributes": True}
