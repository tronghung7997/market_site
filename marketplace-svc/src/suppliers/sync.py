"""Job đồng bộ catalog nhà cung cấp mua-theo-đơn (provider `external_stock`).

Mỗi 10 phút: giá vốn + tồn kho cho mọi supplier_listings, đánh dấu SKU bị
gỡ, cảnh báo margin thấp (src/suppliers/service.py). igbm trả cả catalog
~1.5 MB một cục nên không chạy dày hơn; tồn kho "tươi" cho từng đơn đã có
precheck realtime ngay trước khi trừ ví.
"""
import structlog

from src.database import SessionLocal
from src.models.provider import Provider
from src.suppliers.service import sync_provider_listings, synced_provider_ids

logger = structlog.get_logger()


async def supplier_sync_job() -> None:
    """One session and one commit per provider: a provider's catalog rewrite
    and repricing do not stay locked while the next provider is fetched, and a
    failing provider does not roll back the others."""
    async with SessionLocal() as db:
        provider_ids = await synced_provider_ids(db)
    for provider_id in provider_ids:
        async with SessionLocal() as db:
            try:
                provider = await db.get(Provider, provider_id)
                if provider is None:
                    continue
                r = await sync_provider_listings(provider, db)
                await db.commit()
            except Exception as e:  # noqa: BLE001 — job nền không được chết
                await db.rollback()
                logger.error("supplier_sync_provider_failed", provider_id=provider_id, error=str(e))
                continue
        logger.info(
            "supplier_sync", provider_id=r.provider_id, updated=r.updated,
            delisted=r.delisted, low_margin=r.low_margin, error=r.error,
        )
