from datetime import datetime

from pydantic import BaseModel


class SellerSummary(BaseModel):
    account_id: int
    email: str
    business_name: str | None
    completed_order_count: int
    rating_avg: float | None
    review_count: int
    seller_tier: str = "new"


class SellerProfile(SellerSummary):
    bio: str | None = None
    member_since: datetime | None = None
