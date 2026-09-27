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
    # Badge icon of the seller's tier (PublicImage), when the admin set one.
    tier_badge: dict | None = None
    # Shop logo (PublicImage) or None.
    logo: dict | None = None


class SellerResponseTime(BaseModel):
    """Typical first reply to a buyer over 30 days: band ``15m``/``1h``/``6h``/
    ``24h``/``slow``, share of chats answered (%), and how many chats count."""
    within: str
    rate: int
    sample: int


class SellerProfile(SellerSummary):
    bio: str | None = None
    member_since: datetime | None = None
    banner: dict | None = None
    # Null until enough buyer chats (sellers.activity.MIN_RESPONSE_SAMPLE).
    response_time: SellerResponseTime | None = None
    # Last sign-in/refresh band: 15m, 1h, 24h, 7d, 30d; null if older or never.
    active_within: str | None = None
    # Trust score 0–100 over the admin's window; null until enough orders.
    trust_score: int | None = None
    # Coarse bands (low / medium / high) of the dispute and 1-star rates.
    dispute_band: str | None = None
    one_star_band: str | None = None
