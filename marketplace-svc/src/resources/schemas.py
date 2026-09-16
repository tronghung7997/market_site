from datetime import datetime

from pydantic import BaseModel, Field

from src.orders.constants import MAX_ORDER_QUANTITY


RESTOCK_MAX_ITEMS = 5_000


class BulkResourceCreate(BaseModel):
    items: list[str] = Field(min_length=1, max_length=RESTOCK_MAX_ITEMS)


class RestockPreviewRequest(BaseModel):
    items: list[str] = Field(min_length=1, max_length=RESTOCK_MAX_ITEMS)


class RestockPreviewMalformed(BaseModel):
    line: int
    fields: int


class RestockPreviewResponse(BaseModel):
    total_lines: int
    duplicate_in_file: int
    existing_in_stock: int
    to_add: int
    expected_field_count: int | None = None
    malformed: list[RestockPreviewMalformed]
    malformed_total: int


class ResourceUpdate(BaseModel):
    data: str = Field(min_length=1, max_length=8000)


class ResourceRestock(BaseModel):
    data: str = Field(min_length=1, max_length=8000)


class BulkResourceAction(BaseModel):
    action: str = Field(pattern="^(archive|restore|delete)$")
    resource_ids: list[int] = Field(default_factory=list, max_length=5_000)
    # "Select all N rows matching the current filter": ids are ignored and the
    # filter fields below define the batch (same semantics as the list endpoint).
    all_matching: bool = False
    status: str | None = Field(default=None, pattern="^(available|assigned|expired|error)$")
    search: str | None = None
    archived_only: bool = False
    created_from: datetime | None = None
    created_to: datetime | None = None
    has_order: bool | None = None


class BulkResourceActionResult(BaseModel):
    action: str
    count: int
    resource_ids: list[int]


class InventoryVariantSummary(BaseModel):
    product_id: int
    product_title: str
    variant_id: int
    variant_name: str
    delivery_mode: str | None = None
    is_active: bool
    available: int
    assigned: int
    expired: int
    error: int
    archived: int


class InventoryCounts(BaseModel):
    all: int
    out: int
    low: int
    error: int
    available: int


class InventorySummaryResponse(BaseModel):
    items: list[InventoryVariantSummary]
    total: int
    page: int
    per_page: int
    counts: InventoryCounts


class BulkResourceResponse(BaseModel):
    count: int
    skipped_duplicate: int = 0
    skipped_existing: int = 0


class ResourceResponse(BaseModel):
    id: int
    variant_id: int
    status: str
    data: str
    order_id: int | None = None
    order_code: str | None = None
    assigned_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime
    refund_amount_cap: int | None = None
    is_archived: bool = False

    model_config = {"from_attributes": True}


class ResourceStatusSummary(BaseModel):
    available: int
    assigned: int
    expired: int
    error: int


class ResourceSellerFacet(BaseModel):
    seller_id: int
    seller_email: str | None = None
    count: int


class InternalAcquireRequest(BaseModel):
    variant_id: int
    quantity: int = Field(default=1, ge=1, le=MAX_ORDER_QUANTITY)


class InternalAcquireResponse(BaseModel):
    resources: list[dict]


class InternalReleaseRequest(BaseModel):
    resource_ids: list[int] = Field(min_length=1, max_length=MAX_ORDER_QUANTITY)


class AdminResourceResponse(BaseModel):
    id: int
    variant_id: int
    seller_id: int
    status: str
    order_id: int | None = None
    assigned_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime
    variant_name: str | None = None
    product_title: str | None = None
    product_id: int | None = None
    seller_email: str | None = None

    model_config = {"from_attributes": True}


class AdminResourceListResponse(BaseModel):
    items: list[AdminResourceResponse]
    total: int
    page: int
    per_page: int


# --- Package console -------------------------------------------------------

class InventoryPackage(BaseModel):
    product_id: int
    product_key: str | None = None
    product_title: str
    product_status: str
    cover_id: str | None = None
    service_type: str | None = None
    category_id: int
    category_name: str
    category_parent_id: int | None = None
    category_parent_name: str | None = None
    variant_id: int
    variant_key: str | None = None
    variant_name: str
    price: int
    delivery_mode: str | None = None
    is_active: bool
    available: int
    assigned: int
    error: int
    expired: int
    archived: int
    sold_30d: int
    last_restock_at: datetime | None = None
    stock_state: str


class InventoryPackageCounts(BaseModel):
    all: int
    low: int
    out: int
    error: int
    inactive: int
    available_total: int
    sold_30d: int
    products: int


class InventoryCategoryFacet(BaseModel):
    id: int
    name: str
    parent_id: int | None = None
    parent_name: str | None = None
    count: int


class InventoryPackagesResponse(BaseModel):
    items: list[InventoryPackage]
    total: int
    page: int
    per_page: int
    view: str
    counts: InventoryPackageCounts
    categories: list[InventoryCategoryFacet]
    low_stock_threshold: int


class InventoryPackageSibling(BaseModel):
    variant_id: int
    variant_key: str | None = None
    variant_name: str
    available: int
    is_active: bool
    delivery_mode: str | None = None
    price: int


class InventoryPackageDetail(InventoryPackage):
    low_stock_threshold: int
    expected_field_count: int | None = None
    siblings: list[InventoryPackageSibling]


class InventoryPackageBulkStatusRequest(BaseModel):
    variant_ids: list[int] = Field(min_length=1, max_length=500)
    is_active: bool


class InventoryPackageBulkStatusSkipped(BaseModel):
    id: int
    reason: str


class InventoryPackageBulkStatusResponse(BaseModel):
    updated: list[int]
    skipped: list[InventoryPackageBulkStatusSkipped]
    is_active: bool


class InventoryExportPreview(BaseModel):
    rows: list[dict]
    total: int
    packages: int
    row_limit: int
    columns: list[str]
    headers: dict[str, str]


class InventoryReportRow(BaseModel):
    key: str
    label: str | None = None
    sublabel: str | None = None
    product_id: int | None = None
    product_title: str | None = None
    category_id: int | None = None
    category_name: str | None = None
    category_parent_name: str | None = None
    added: int
    sold: int
    error: int
    expired: int
    archived: int
    stock: int
    revenue: int
    prev: dict[str, int] | None = None


class InventoryReportResponse(BaseModel):
    range: dict
    group_by: str
    basis: str
    packages: int
    rows: list[InventoryReportRow]
    totals: dict[str, int]
    prev_totals: dict[str, int] | None = None
    low_stock_threshold: int
