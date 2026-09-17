"""Nghiệp vụ resell từ catalog thượng nguồn — không phụ thuộc nguồn nào.

- `precheck_external_purchase`: ngay trước khi trừ ví buyer, hỏi nhà cung cấp
  tồn kho/giá REALTIME của SKU (một request ~2 KB) — chặn "hết hàng" và "vừa
  tăng giá quá ngưỡng margin" trước khi tốn tiền hai bên. Cache
  `supplier_listings` được cập nhật luôn.
- `sync_provider_listings`: kéo cả catalog một lần, cập nhật mọi listing của
  provider, đánh dấu SKU bị gỡ, cảnh báo margin thấp. Job gọi định kỳ
  (src/suppliers/sync.py) và admin bấm "Đồng bộ ngay".
- `attach_listing`: gắn/gắn lại một gói vào SKU (seed, admin UI sau này).
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

import structlog
from fastapi import status
from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.factory import get_adapter, get_adapter_for_test
from src.adapters.registry import get_spec
from src.adapters.supplier import (
    CatalogSupplierAdapter,
    SupplierAuthError,
    SupplierContractError,
    SupplierUnavailableError,
    UpstreamListing,
)
from src.alerts.service import emit_incident, fp_provider, fp_variant, upsert_incident
from src.exceptions import ErrorCode, api_error
from src.models.product import Product, ProductVariant
from src.models.provider import Provider
from src.models.supplier_listing import SupplierCatalogItem, SupplierListing
from src.providers.credit import report_out_of_credit

logger = structlog.get_logger()

ALERT_LOW_MARGIN = "supplier_low_margin"
ALERT_DELISTED = "supplier_sku_delisted"
ALERT_SYNC_FAILED = "supplier_sync_failed"

# Margin tối thiểu mặc định (giá bán / giá vốn − 1). Provider ghi đè qua
# config.min_margin_pct. Dưới ngưỡng: precheck CHẶN bán (tránh bán lỗ khi
# nguồn vừa tăng giá), sync job chỉ cảnh báo để admin sửa giá.
DEFAULT_MIN_MARGIN_PCT = 10.0


def _min_margin_pct(provider: Provider) -> float:
    try:
        return float((provider.config or {}).get("min_margin_pct") or DEFAULT_MIN_MARGIN_PCT)
    except (TypeError, ValueError):
        return DEFAULT_MIN_MARGIN_PCT


def margin_ok(sell_price: int, cost_price: int, min_margin_pct: float) -> bool:
    if cost_price <= 0:
        return True
    return sell_price >= cost_price * (1 + min_margin_pct / 100)


def apply_upstream(listing: SupplierListing, up: UpstreamListing) -> None:
    listing.external_name = up.name or listing.external_name
    listing.cost_price = up.cost_price
    listing.upstream_amount = up.amount
    listing.upstream_min = up.min_qty
    listing.upstream_max = up.max_qty
    listing.format_hint = up.format_hint
    if up.category_path:
        listing.extra = {**(listing.extra or {}), "category_path": list(up.category_path)}
    listing.synced_at = datetime.now(timezone.utc)
    listing.sync_error = None


async def attach_listing(
    db: AsyncSession, *, provider_id: int, variant_id: int, external_product_id: str,
    upstream: UpstreamListing | None = None, external_name: str | None = None,
) -> SupplierListing:
    listing = await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == variant_id))
    if listing is None:
        listing = SupplierListing(provider_id=provider_id, variant_id=variant_id,
                                  external_product_id=external_product_id)
        db.add(listing)
    else:
        listing.provider_id = provider_id
        listing.external_product_id = external_product_id
        listing.sync_error = None
    if external_name:
        listing.external_name = external_name
    if upstream is not None:
        apply_upstream(listing, upstream)
    await db.flush()
    return listing


async def listing_for_variant(variant_id: int, db: AsyncSession) -> SupplierListing | None:
    return await db.scalar(select(SupplierListing).where(SupplierListing.variant_id == variant_id))


async def provider_has_external_stock(provider_id: int | None, db: AsyncSession) -> bool:
    if not provider_id:
        return False
    provider = await db.get(Provider, provider_id)
    spec = get_spec(provider.adapter_type) if provider else None
    return bool(spec and spec.external_stock)


# ----------------------------------------------------------------------
# Precheck trước khi trừ ví
# ----------------------------------------------------------------------

async def precheck_external_purchase(
    product: Product, variant_id: int | None, quantity: int, db: AsyncSession,
) -> SupplierListing:
    """Raise api_error nếu không nên nhận đơn. Trả về listing đã cập nhật.

    Không tốn tiền, không tạo side effect thượng nguồn. Nếu nhà cung cấp
    không trả lời được (mạng), KHÔNG chặn — adapter sẽ tự thất bại và hoàn
    tiền sau; chặn ở đây sẽ làm cả shop "hết hàng" mỗi khi nguồn lag."""
    if variant_id is None:
        raise api_error(ErrorCode.INVALID_PRODUCT_CONFIG, status.HTTP_400_BAD_REQUEST)
    listing = await listing_for_variant(variant_id, db)
    if listing is None:
        raise api_error(ErrorCode.PROVIDER_NOT_CONFIGURED, status.HTTP_400_BAD_REQUEST)
    variant = await db.get(ProductVariant, variant_id)
    provider = await db.get(Provider, product.provider_id)

    upstream_balance: Decimal | None = None
    try:
        adapter = await get_adapter(product.provider_id, db)
        if isinstance(adapter, CatalogSupplierAdapter):
            up = await adapter.fetch_listing(listing.external_product_id)
            if up is None:
                listing.sync_error = "delisted"
                listing.upstream_amount = 0
            else:
                apply_upstream(listing, up)
            upstream_balance = await adapter.fetch_balance()
    except (SupplierUnavailableError, SupplierContractError) as e:
        logger.warning("supplier_precheck_unavailable", provider_id=product.provider_id,
                       variant_id=variant_id, error=str(e))
    except ValueError as e:
        # provider tắt / chưa duyệt (get_adapter) — không nhận đơn
        raise api_error(ErrorCode.PROVIDER_NOT_CONFIGURED, status.HTTP_400_BAD_REQUEST, detail=str(e))

    if listing.sellable_units() < quantity:
        raise api_error(ErrorCode.RESOURCE_UNAVAILABLE, status.HTTP_409_CONFLICT)
    if upstream_balance is not None and upstream_balance < listing.cost_price * quantity:
        # Biết chắc lệnh mua sẽ bị từ chối "Số dư không đủ" → xử lý như đã
        # gặp mã hết tiền: tắt provider + alert (src/providers/credit.py),
        # buyer chưa bị trừ đồng nào. report_out_of_credit tự commit.
        await report_out_of_credit(product.provider_id, db)
        raise api_error(ErrorCode.RESOURCE_UNAVAILABLE, status.HTTP_409_CONFLICT)
    if quantity < listing.upstream_min:
        raise api_error(ErrorCode.ORDER_QUANTITY_LIMIT, status.HTTP_400_BAD_REQUEST, max=listing.upstream_min)
    if variant is not None and provider is not None and not margin_ok(
        variant.price, listing.cost_price, _min_margin_pct(provider)
    ):
        # Session này sẽ rollback theo api_error bên dưới → alert phải đi
        # session riêng (emit_incident) mới tới được admin.
        await emit_incident(
            fingerprint=fp_variant(variant_id, ALERT_LOW_MARGIN),
            type_=ALERT_LOW_MARGIN,
            severity="warning",
            target_type="variant",
            target_id=variant_id,
            message=(
                f"Gói #{variant_id} ({variant.name}) bị chặn bán: giá vốn nhà cung cấp {listing.cost_price:,}đ "
                f"đã vượt ngưỡng margin so với giá bán {variant.price:,}đ. Tăng giá bán hoặc tắt gói."
            ),
        )
        raise api_error(ErrorCode.PRODUCT_UNAVAILABLE, status.HTTP_409_CONFLICT)
    return listing


# ----------------------------------------------------------------------
# Snapshot catalog (để duyệt/nhập ở UI)
# ----------------------------------------------------------------------

def fold_text(s: str) -> str:
    """Bỏ dấu + hạ chữ — cùng quy tắc với adapters/igbm._fold."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    return s.replace("đ", "d").replace("Đ", "d").lower().strip()


async def replace_catalog_snapshot(
    provider_id: int, catalog: list[UpstreamListing], db: AsyncSession,
) -> int:
    """Ghi đè toàn bộ snapshot của provider bằng catalog vừa kéo. Xoá-rồi-chèn
    thay vì upsert từng dòng: catalog ~3.000 SKU, một lượt/10 phút, và SKU bị
    gỡ phải biến mất khỏi bảng duyệt chứ không nằm lại với số cũ."""
    await db.execute(delete(SupplierCatalogItem).where(SupplierCatalogItem.provider_id == provider_id))
    now = datetime.now(timezone.utc)
    rows = [
        {
            "provider_id": provider_id,
            "external_id": up.external_id,
            "name": up.name,
            "name_norm": fold_text(up.name + " " + " ".join(up.category_path)),
            "cost_price": up.cost_price,
            "amount": up.amount,
            "min_qty": up.min_qty,
            "max_qty": up.max_qty,
            "format_hint": up.format_hint,
            "group_name": (up.category_path[0] if up.category_path else "")[:255],
            "category_path": list(up.category_path),
            "synced_at": now,
        }
        for up in catalog
    ]
    for start in range(0, len(rows), 500):
        await db.execute(insert(SupplierCatalogItem), rows[start:start + 500])
    return len(rows)


# ----------------------------------------------------------------------
# Đồng bộ catalog
# ----------------------------------------------------------------------

@dataclass
class SyncReport:
    provider_id: int
    updated: int = 0
    delisted: int = 0
    low_margin: int = 0
    catalog_items: int = 0
    error: str | None = None


async def sync_provider_listings(provider: Provider, db: AsyncSession) -> SyncReport:
    """Một provider: kéo catalog, cập nhật mọi listing. Không commit — caller
    commit (job hoặc endpoint admin)."""
    report = SyncReport(provider_id=provider.id)
    listings = list((await db.execute(
        select(SupplierListing).where(SupplierListing.provider_id == provider.id)
    )).scalars())

    try:
        # get_adapter_for_test: không check is_active — provider bị tắt vì hết
        # tiền vẫn cần cập nhật tồn/giá để admin quyết định bật lại.
        adapter = await get_adapter_for_test(provider.id, db)
        if not isinstance(adapter, CatalogSupplierAdapter):
            report.error = f"adapter {provider.adapter_type} không phải catalog supplier"
            return report
        catalog = await adapter.fetch_catalog()
    except SupplierAuthError as e:
        report.error = f"API key bị từ chối: {e}"
    except (SupplierUnavailableError, SupplierContractError, ValueError) as e:
        report.error = str(e)
    if report.error:
        for listing in listings:
            listing.sync_error = report.error[:255]
        if not listings:
            return report
        await upsert_incident(
            db, fingerprint=fp_provider(provider.id, ALERT_SYNC_FAILED), type_=ALERT_SYNC_FAILED,
            severity="warning", target_type="provider", target_id=provider.id,
            message=f"Đồng bộ catalog nhà cung cấp '{provider.name}' thất bại: {report.error}",
        )
        return report

    by_id = {up.external_id: up for up in catalog}
    report.catalog_items = await replace_catalog_snapshot(provider.id, catalog, db)
    min_margin = _min_margin_pct(provider)
    variant_ids = [lst.variant_id for lst in listings]
    variants = {
        v.id: v for v in (await db.execute(
            select(ProductVariant).where(ProductVariant.id.in_(variant_ids))
        )).scalars()
    }
    for listing in listings:
        up = by_id.get(listing.external_product_id)
        if up is None:
            listing.upstream_amount = 0
            listing.sync_error = "delisted"
            listing.synced_at = datetime.now(timezone.utc)
            report.delisted += 1
            await upsert_incident(
                db, fingerprint=fp_variant(listing.variant_id, ALERT_DELISTED), type_=ALERT_DELISTED,
                severity="warning", target_type="variant", target_id=listing.variant_id,
                message=(
                    f"SKU {listing.external_product_id} ({listing.external_name or '?'}) không còn trong "
                    f"catalog nhà cung cấp — gói #{listing.variant_id} đang hiện hết hàng. Gắn SKU khác hoặc tắt gói."
                ),
            )
            continue
        apply_upstream(listing, up)
        report.updated += 1
        variant = variants.get(listing.variant_id)
        if variant is not None and variant.is_active and not margin_ok(variant.price, up.cost_price, min_margin):
            report.low_margin += 1
            await upsert_incident(
                db, fingerprint=fp_variant(listing.variant_id, ALERT_LOW_MARGIN), type_=ALERT_LOW_MARGIN,
                severity="warning", target_type="variant", target_id=listing.variant_id,
                message=(
                    f"Gói #{listing.variant_id} ({variant.name}): giá vốn {up.cost_price:,}đ vs giá bán "
                    f"{variant.price:,}đ — dưới ngưỡng margin {min_margin:g}%. Đơn mới sẽ bị chặn cho tới khi sửa giá."
                ),
            )
    return report


async def sync_all_external_providers(db: AsyncSession) -> list[SyncReport]:
    providers = list((await db.execute(select(Provider))).scalars())
    reports: list[SyncReport] = []
    for provider in providers:
        spec = get_spec(provider.adapter_type)
        if not spec or not spec.external_stock:
            continue
        reports.append(await sync_provider_listings(provider, db))
    return reports
