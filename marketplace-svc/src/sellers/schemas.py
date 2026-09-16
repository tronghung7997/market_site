from datetime import datetime

from pydantic import BaseModel


class SellerSummary(BaseModel):
    """Public seller card. The sequential account id is deliberately absent:
    ``public_key`` is the only identifier, ``canonical_path`` the storefront URL."""
    public_key: str
    # Slug of the approved business name; None until the shop has a name.
    handle: str | None = None
    canonical_path: str
    display_name: str
    business_name: str | None
    completed_order_count: int
    rating_avg: float | None
    review_count: int
    seller_tier: str = "new"


class SellerProfile(SellerSummary):
    bio: str | None = None
    member_since: datetime | None = None
