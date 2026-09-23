"""Nguồn hàng: /seller/sources/* (nguồn được giao cho seller) và
/admin/sources/* (mọi nguồn). Cùng handler, khác SourceScope."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.dependencies import require_role
from src.database import get_session
from src.models.account import Account
from src.suppliers import gateway_sources, proxy_sources, sources
from src.suppliers.sources import SourceScope

router = APIRouter(tags=["supplier-sources"])


# --- schemas ------------------------------------------------------------

class SourceSummary(BaseModel):
    id: int
    public_key: str
    name: str
    adapter_type: str
    kind: Literal["catalog", "proxy", "server", "gateway"] = "catalog"
    is_active: bool
    review_status: str
    seller_id: int | None
    seller_email: str | None
    seller_is_internal: bool = False
    seller_business_name: str | None = None
    min_margin_pct: float
    markup_pct: float = 30
    round_to: int = 1000
    follow_cost: bool = False
    balance_vnd: int | None = None
    active_listing_count: int = 0
    # lỗi đồng bộ gần nhất (không phải "delisted") — nguồn vẫn bán theo cache cũ
    sync_error: str | None = None
    stats_7d: dict = {}
    # nguồn API: request 24h, key còn request, lời 7 ngày
    gateway_stats: dict | None = None
    low_balance_vnd: int | float | str | None = None
    catalog_count: int
    catalog_synced_at: datetime | None
    listing_count: int
    listing_error_count: int
    listing_low_margin_count: int = 0
    listing_auto_paused_count: int = 0
    product_count: int = 0
    attention_count: int = 0
    last_test_result: dict | None = None
    last_tested_at: datetime | None = None


class ImportItem(BaseModel):
    external_id: str = Field(min_length=1, max_length=100)
    category_id: int
    title: str | None = Field(default=None, max_length=255)
    variant_name: str | None = Field(default=None, max_length=255)
    price: int | None = Field(default=None, ge=0)
    status: Literal["draft", "active"] = "draft"
    description: str | None = Field(default=None, max_length=20000)
    warranty_text: str | None = Field(default=None, max_length=8000)
    service_type: str | None = Field(default=None, max_length=50)
    escrow_days: int | None = Field(default=None, ge=0, le=90)
    # Gộp: thêm vào sản phẩm có sẵn, hoặc các item cùng group_key → 1 sản phẩm mới
    product_id: int | None = None
    group_key: str | None = Field(default=None, max_length=64)


class ImportRequest(BaseModel):
    items: list[ImportItem] = Field(min_length=1, max_length=100)
    # admin: seller sở hữu sản phẩm (mặc định seller được giao nguồn)
    owner_seller_id: int | None = None


class AttachRequest(BaseModel):
    variant_id: int
    external_id: str = Field(min_length=1, max_length=100)


class ListingUpdate(BaseModel):
    price: int | None = Field(default=None, ge=0)
    variant_name: str | None = Field(default=None, max_length=255)
    external_id: str | None = Field(default=None, max_length=100)
    is_active: bool | None = None
    product_id: int | None = None   # chuyển phân loại sang sản phẩm khác
    # False → trả về luật giá của nguồn (đặt lại giá theo luật ngay)
    price_manual: bool | None = None


class NewSeller(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    business_name: str = Field(min_length=1, max_length=255)


class SourceCreate(BaseModel):
    adapter_type: str
    name: str = Field(min_length=1, max_length=255)
    config: dict = {}
    seller_id: int | None = None
    new_seller: NewSeller | None = None


class SourceTestRequest(BaseModel):
    adapter_type: str
    config: dict = {}


class GatewayPackage(BaseModel):
    label: str = Field(default="", max_length=60)
    size: int = Field(ge=1, le=10_000_000)
    price: int = Field(ge=1, le=10_000_000_000)
    active: bool = True


class GatewayPackagesUpdate(BaseModel):
    packages: list[GatewayPackage] | None = Field(default=None, max_length=12)
    cost_per_request: float | None = Field(default=None, ge=0, le=1_000_000)
    title: str | None = Field(default=None, min_length=1, max_length=255)
    category_id: int | None = None
    publish: bool | None = None


class GatewayTry(BaseModel):
    endpoint: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    body: dict | None = None


class PlanImportItem(BaseModel):
    external_id: str = Field(min_length=1, max_length=100)
    type: str = Field(default="", max_length=40)
    network: str = Field(default="", max_length=40)
    days: int | None = Field(default=None, ge=1, le=365)
    price: int | None = Field(default=None, ge=0)
    type_label: str | None = Field(default=None, max_length=80)
    network_label: str | None = Field(default=None, max_length=80)
    title: str | None = Field(default=None, max_length=255)
    category_id: int | None = None
    status: Literal["draft", "active"] = "draft"
    description: str | None = Field(default=None, max_length=20000)
    escrow_days: int | None = Field(default=None, ge=0, le=90)
    product_id: int | None = None
    group_key: str | None = Field(default=None, max_length=64)


class PlanImportRequest(BaseModel):
    items: list[PlanImportItem] = Field(min_length=1, max_length=100)
    owner_seller_id: int | None = None


class OfferUpdate(BaseModel):
    product_id: int
    plan_key: str = Field(min_length=3, max_length=120)
    price: int = Field(ge=1)


class OfferRemove(BaseModel):
    product_id: int
    plan_key: str = Field(min_length=3, max_length=120)


class OfferRepriceRequest(BaseModel):
    margin_pct: float = Field(ge=0, le=1000)
    round_to: int = Field(default=1000, ge=1, le=1_000_000)


class RepriceRequest(BaseModel):
    # Bỏ trống → luật giá đang lưu của nguồn.
    margin_pct: float | None = Field(default=None, ge=0, le=1000)
    round_to: int | None = Field(default=None, ge=1, le=1_000_000)
    listing_ids: list[int] | None = None
    only_below_min: bool = False
    dry_run: bool = False
    include_manual: bool = False


class SettingsUpdate(BaseModel):
    # seller nội bộ + admin
    markup_pct: float | None = Field(default=None, ge=0, le=1000)
    round_to: Literal[1, 100, 500, 1000, 5000, 10000] | None = None
    follow_cost: bool | None = None
    # 0 không có nghĩa "không chặn" ở _min_margin_pct (rơi về mặc định) → ≥ 1.
    min_margin_pct: float | None = Field(default=None, ge=1, le=500)
    auto_pause_after_failures: int | None = Field(default=None, ge=0, le=100)
    low_balance_vnd: int | None = Field(default=None, ge=0, le=1_000_000_000)
    # nguồn API (gateway)
    timeout_seconds: int | None = Field(default=None, ge=5, le=120)
    max_attempts: int | None = Field(default=None, ge=1, le=3)
    rate_limit_per_minute: int | None = Field(default=None, ge=1, le=600)
    # chỉ admin
    name: str | None = Field(default=None, min_length=1, max_length=255)
    base_url: str | None = Field(default=None, min_length=8, max_length=255, pattern=r"^https?://")
    api_key: str | None = Field(default=None, min_length=4, max_length=512)
    is_active: bool | None = None
    seller_id: int | None = None


# --- handlers dùng chung -------------------------------------------------

def _routes(prefix: str, role: str):
    r = APIRouter(prefix=prefix)

    def scope_of(account: Account) -> SourceScope:
        if role == "admin":
            return SourceScope(seller_id=None)
        # Khu "Nguồn cung" chỉ dành cho seller NỘI BỘ (sàn vận hành) — seller
        # thường không thấy trên UI và cũng không gọi được API.
        if not account.is_internal:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ seller nội bộ dùng được Nguồn cung")
        return SourceScope(seller_id=account.id)

    @r.get("", response_model=list[SourceSummary])
    async def list_sources(account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session)):
        return await sources.list_sources(scope_of(account), db)

    @r.get("/{provider_id}/catalog")
    async def browse(
        provider_id: str,
        q: str = "", group: str = "", in_stock: bool = True,
        max_cost: int | None = Query(default=None, ge=0),
        page: int = Query(default=1, ge=1), per_page: int = Query(default=50, ge=1, le=200),
        sort: Literal["stock", "cost_asc", "cost_desc", "name"] = "stock",
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        return await sources.browse_catalog(
            provider, scope, db, q=q, group=group, in_stock=in_stock, max_cost=max_cost,
            page=page, per_page=per_page, sort=sort,
        )

    @r.post("/{provider_id}/sync")
    async def sync(provider_id: str, account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session)):
        provider = await sources.get_source(provider_id, scope_of(account), db)
        return await sources.sync_now(provider, db)

    @r.get("/{provider_id}/listings")
    async def listings(provider_id: str, account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session)):
        scope = scope_of(account)
        provider = await sources.get_catalog_source(provider_id, scope, db)
        return await sources.list_listings(provider, scope, db)

    @r.post("/{provider_id}/import", status_code=201)
    async def import_items(
        provider_id: str, body: ImportRequest,
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        scope = scope_of(account)
        provider = await sources.get_catalog_source(provider_id, scope, db)
        return await sources.import_items(
            provider, scope, [i.model_dump() for i in body.items], db,
            owner_seller_id=body.owner_seller_id if scope.is_admin else None,
        )

    @r.post("/{provider_id}/attach", status_code=201)
    async def attach(
        provider_id: str, body: AttachRequest,
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        scope = scope_of(account)
        provider = await sources.get_catalog_source(provider_id, scope, db)
        listing = await sources.attach_existing_variant(provider, scope, body.variant_id, body.external_id, db)
        return {"listing_id": listing.id, "variant_id": listing.variant_id, "external_id": listing.external_product_id}

    @r.post("/{provider_id}/reprice")
    async def reprice(
        provider_id: str, body: RepriceRequest,
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        scope = scope_of(account)
        provider = await sources.get_catalog_source(provider_id, scope, db)
        return await sources.reprice_listings(
            provider, scope, db, margin_pct=body.margin_pct, round_to=body.round_to,
            listing_ids=body.listing_ids, only_below_min=body.only_below_min,
            dry_run=body.dry_run, include_manual=body.include_manual,
        )

    @r.get("/{provider_id}/purchases")
    async def purchases(
        provider_id: str,
        days: int = Query(default=1, description="1 | 7 | 30"),
        result: Literal["all", "ok", "failed", "pending"] = "all",
        q: str = Query(default="", max_length=100),
        page: int = Query(default=1, ge=1), per_page: int = Query(default=50, ge=1, le=200),
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        if days not in sources.PURCHASE_WINDOWS:
            raise HTTPException(status_code=422, detail="days phải là 1, 7 hoặc 30")
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        return await sources.list_purchases(
            provider, scope, db, days=days, result=result, q=q, page=page, per_page=per_page,
        )

    @r.get("/{provider_id}/settings")
    async def get_settings(provider_id: str, account: Account = Depends(require_role(role)),
                           db: AsyncSession = Depends(get_session)):
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        return await sources.get_settings(provider, scope, db)

    @r.patch("/{provider_id}/settings")
    async def update_settings(provider_id: str, body: SettingsUpdate,
                              account: Account = Depends(require_role(role)),
                              db: AsyncSession = Depends(get_session)):
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        return await sources.update_settings(
            provider, scope, body.model_dump(exclude_unset=True), db, actor_id=account.id,
        )

    # --- nguồn API (gateway): gói bán, endpoint, request -----------------

    async def gateway_source(provider_id: str, account: Account, db: AsyncSession):
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        if sources.source_kind(provider.adapter_type) != "gateway":
            raise HTTPException(status_code=400, detail="Nguồn này không bán theo gói request")
        return scope, provider

    @r.get("/{provider_id}/gateway")
    async def gateway_overview(provider_id: str, account: Account = Depends(require_role(role)),
                               db: AsyncSession = Depends(get_session)):
        scope, provider = await gateway_source(provider_id, account, db)
        return await gateway_sources.get_gateway(provider, scope, db)

    @r.put("/{provider_id}/packages")
    async def gateway_packages(provider_id: str, body: GatewayPackagesUpdate,
                               account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session)):
        scope, provider = await gateway_source(provider_id, account, db)
        return await gateway_sources.update_packages(
            provider, scope, body.model_dump(exclude_unset=True), db, actor_id=account.id,
        )

    @r.post("/{provider_id}/try")
    async def gateway_try(provider_id: str, body: GatewayTry, account: Account = Depends(require_role(role)),
                          db: AsyncSession = Depends(get_session)):
        _scope, provider = await gateway_source(provider_id, account, db)
        return await gateway_sources.try_upstream(provider, body.endpoint, body.body, db)

    @r.get("/{provider_id}/requests")
    async def gateway_requests(
        provider_id: str,
        hours: int = Query(default=24, description="24 | 168"),
        result: Literal["all", "ok", "error"] = "all",
        q: str = Query(default="", max_length=100),
        page: int = Query(default=1, ge=1), per_page: int = Query(default=50, ge=1, le=200),
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        if hours not in (24, 168):
            raise HTTPException(status_code=422, detail="hours phải là 24 hoặc 168")
        scope, provider = await gateway_source(provider_id, account, db)
        return await gateway_sources.list_requests(
            provider, scope, db, hours=hours, result=result, q=q, page=page, per_page=per_page,
        )

    # --- nguồn proxy: gói đang bán (pricing config) -----------------------

    @r.get("/{provider_id}/offers")
    async def offers(provider_id: str, account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session)):
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        return await proxy_sources.list_offers(provider, scope, db)

    @r.post("/{provider_id}/import-plans", status_code=201)
    async def import_plans(
        provider_id: str, body: PlanImportRequest,
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        return await proxy_sources.import_plans(
            provider, scope, [i.model_dump() for i in body.items], db,
            owner_seller_id=body.owner_seller_id if scope.is_admin else None, actor_id=account.id,
        )

    @r.patch("/{provider_id}/offers")
    async def update_offer(
        provider_id: str, body: OfferUpdate,
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        return await proxy_sources.update_offer(provider, scope, body.product_id, body.plan_key, db, price=body.price)

    @r.post("/{provider_id}/offers/remove", status_code=204)
    async def remove_offer(
        provider_id: str, body: OfferRemove,
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        await proxy_sources.remove_offer(provider, scope, body.product_id, body.plan_key, db)

    @r.post("/{provider_id}/offers/reprice")
    async def reprice_offers(
        provider_id: str, body: OfferRepriceRequest,
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        scope = scope_of(account)
        provider = await sources.get_source(provider_id, scope, db)
        return await proxy_sources.reprice_offers(provider, scope, db, margin_pct=body.margin_pct, round_to=body.round_to)

    @r.patch("/listings/{listing_id}")
    async def update_listing(
        listing_id: int, body: ListingUpdate,
        account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session),
    ):
        return await sources.update_listing(listing_id, scope_of(account), db, **body.model_dump(exclude_unset=True))

    @r.delete("/listings/{listing_id}", status_code=204)
    async def detach(listing_id: int, account: Account = Depends(require_role(role)), db: AsyncSession = Depends(get_session)):
        await sources.detach_listing(listing_id, scope_of(account), db)

    return r


# --- wizard "Thêm nguồn" (admin) — khai báo TRƯỚC /admin/sources/{provider_id}
admin_extra = APIRouter(prefix="/admin/sources")


@admin_extra.get("/kinds")
async def source_kinds(_: Account = Depends(require_role("admin"))):
    return sources.list_source_kinds()


@admin_extra.get("/sellers")
async def seller_candidates(_: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await sources.list_seller_candidates(db)


@admin_extra.post("/test")
async def test_config(body: SourceTestRequest, _: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await sources.test_source_config(body.adapter_type, body.config, db)


@admin_extra.post("/{provider_id}/test")
async def test_saved(provider_id: str, _: Account = Depends(require_role("admin")),
                     db: AsyncSession = Depends(get_session)):
    provider = await sources.get_source(provider_id, SourceScope(seller_id=None), db)
    return await sources.test_saved_source(provider, db)


@admin_extra.post("", status_code=201)
async def create_source(body: SourceCreate, admin: Account = Depends(require_role("admin")), db: AsyncSession = Depends(get_session)):
    return await sources.create_source(body.model_dump(), db, actor_id=admin.id)


router.include_router(_routes("/seller/sources", "seller"))
router.include_router(admin_extra)
router.include_router(_routes("/admin/sources", "admin"))
