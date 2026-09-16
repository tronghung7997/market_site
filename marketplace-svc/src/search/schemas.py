"""Transport contract for storefront search (typeahead + results page).

Product hits deliberately carry no sequential ids: ``public_key`` /
``canonical_path`` are the only handles, mirroring the public catalog.
Category ids are part of the existing public ``/categories`` contract and
stay (the storefront filters by ``category_id``).
"""

from pydantic import BaseModel

from src.products.schemas import ProductListPageResponse
from src.sellers.schemas import SellerSummary


class SearchProductHit(BaseModel):
    public_key: str
    slug: str
    canonical_path: str
    title: str
    highlight_text: str | None = None
    cover_id: str | None = None
    service_type: str | None = None
    category_id: int
    category_slug: str
    category_name: str
    seller_name: str | None = None
    seller_path: str | None = None
    # Storefront "from" price in ledger units; None when the product has no
    # priced package yet (the UI then links through without a price).
    price_from: int | None = None
    sold_count: int = 0
    rating_avg: float | None = None
    rating_count: int = 0


class SearchCategoryHit(BaseModel):
    id: int
    name: str
    slug: str
    icon: str | None = None
    parent_id: int | None = None
    parent_name: str | None = None
    parent_slug: str | None = None


class SearchSuggestResponse(BaseModel):
    """Typeahead payload: a handful of ranked hits per group, nothing paginated."""
    query: str
    products: list[SearchProductHit]
    categories: list[SearchCategoryHit]
    sellers: list[SellerSummary]


class SearchResponse(BaseModel):
    """Results page: paginated products plus the top category/seller matches
    (only computed on page 1 — later pages carry empty lists)."""
    query: str
    products: ProductListPageResponse
    categories: list[SearchCategoryHit]
    sellers: list[SellerSummary]
