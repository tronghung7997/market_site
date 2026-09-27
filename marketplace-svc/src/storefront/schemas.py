from pydantic import BaseModel


class MarketplaceStats(BaseModel):
    """Storefront-wide counts shown on the home page.

    Every number follows the visibility the storefront already applies on
    product and shop pages: active products, sellers with at least one of
    them, completed orders, and reviews that are not hidden by an admin.
    """
    products_on_sale: int
    sellers_on_sale: int
    completed_orders: int
    review_count: int
    rating_avg: float | None = None
