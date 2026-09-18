"""Job đồng bộ catalog nhà cung cấp mua-theo-đơn (provider `external_stock`).

Mỗi 10 phút: giá vốn + tồn kho cho mọi supplier_listings, đánh dấu SKU bị
gỡ, cảnh báo margin thấp (src/suppliers/service.py). igbm trả cả catalog
~1.5 MB một cục nên không chạy dày hơn; tồn kho "tươi" cho từng đơn đã có
precheck realtime ngay trước khi trừ ví.
"""
import structlog

from src.database import SessionLocal
from src.suppliers.service import sync_all_external_providers

logger = structlog.get_logger()


async def supplier_sync_job() -> None:
    async with SessionLocal() as db:
        try:
            reports = await sync_all_external_providers(db)
            await db.commit()
        except Exception as e:  # noqa: BLE001 — job nền không được chết
            await db.rollback()
            logger.error("supplier_sync_job_failed", error=str(e))
            return
    for r in reports:
        logger.info(
            "supplier_sync", provider_id=r.provider_id, updated=r.updated,
            delisted=r.delisted, low_margin=r.low_margin, error=r.error,
        )
