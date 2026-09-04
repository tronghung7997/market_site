from sqlalchemy import func, select

from src.adapters.base import ProviderAdapter, ProvisionResult
from src.models.resource import Resource, ResourceStatus
from src.resources.service import claim_resources, release_resources


class SellerPoolAdapter(ProviderAdapter):
    """Wraps the existing seller resource pool (claim_resources)."""

    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        variant_id: int | None = user_config.get("variant_id")
        if variant_id is None:
            # Chỉ FixedPricing.get_options() đưa variant_id vào user_config — nếu
            # thiếu, nghĩa là sản phẩm đang gắn nhầm seller_pool cho một chiến lược
            # giá khác (vd task/config). Trả lỗi rõ ràng thay vì raise KeyError,
            # dù validation ở update_product_operations lẽ ra đã chặn trường hợp
            # này từ lúc admin lưu cấu hình.
            return ProvisionResult(
                success=False,
                error="Thiếu variant_id — provider seller_pool chỉ tương thích với chiến lược giá 'fixed'.",
            )
        quantity: int = user_config.get("quantity", 1)
        duration_days: int | None = user_config.get("duration_days")

        try:
            resources = await claim_resources(
                variant_id,
                quantity,
                self.db,
                order_id=order_id,
                duration_days=duration_days,
            )
            data = "\n".join(r.data for r in resources)
            resource_ids = [r.id for r in resources]
            return ProvisionResult(
                success=True,
                data=data,
                resource_id=",".join(str(rid) for rid in resource_ids),
                metadata={
                    "provider": "seller_pool",
                    "variant_id": variant_id,
                    "resource_ids": resource_ids,
                },
            )
        except Exception as exc:
            return ProvisionResult(success=False, error=str(exc))

    async def check_health(self) -> dict:
        variant_id = self.config.get("variant_id")
        if not variant_id:
            return {"status": "healthy", "latency_ms": 0, "message": "No variant configured"}

        count_result = await self.db.execute(
            select(func.count())
            .select_from(Resource)
            .where(
                Resource.variant_id == variant_id,
                Resource.status == ResourceStatus.available,
                Resource.order_id.is_(None),
                Resource.is_archived == False,  # noqa: E712
            )
        )
        available = count_result.scalar() or 0

        if available < 5:
            return {
                "status": "warning",
                "latency_ms": 0,
                "message": f"Low stock: {available} resources available",
            }
        return {
            "status": "healthy",
            "latency_ms": 0,
            "message": f"{available} resources available",
        }

    async def get_usage(self, resource_id: str) -> dict | None:
        return None

    async def revoke(self, resource_id: str) -> bool:
        try:
            resource_ids = [int(rid) for rid in resource_id.split(",")]
            await release_resources(resource_ids, self.db)
            return True
        except Exception:
            return False
