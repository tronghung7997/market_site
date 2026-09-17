"""Lớp chung cho nhà cung cấp kiểu CATALOG MUA-THEO-ĐƠN: một shop bán tài
khoản/key có API "xem catalog → mua N unit → nhận N dòng credential" (igbm.net
là nguồn đầu tiên; xem docs/superpowers/specs/2026-09-17-igbm-reseller-research.md).

Tách làm hai tầng cố ý:

- `CatalogSupplierAdapter` (file này) — TOÀN BỘ logic không phụ thuộc wire
  format: tra mapping SupplierListing theo variant, kiểm tra tồn/giá ngay
  trước khi mua, mua ĐÚNG MỘT attempt, đối soát bằng số dư khi kết quả mơ hồ,
  tạo Resource từng unit để dispute/hoàn tiền theo unit dùng lại nguyên luồng
  seller_pool, health check theo số dư.
- Adapter con (`adapters/igbm.py`) — CHỈ dịch wire format: 5 hàm
  `fetch_balance / fetch_listing / fetch_catalog / purchase / fetch_order`.
  Thêm nguồn thứ hai = một file như igbm.py + một entry registry.

Tại sao mua chỉ một attempt: các shop này không có Idempotency-Key, không có
webhook, không có API list đơn — retry mù sau timeout là mua trùng và mất
tiền. Kết quả mơ hồ được phân xử bằng cách so số dư trước/sau
(`_reconcile_ambiguous`): giảm đúng giá × n thì gần như chắc đã mua nhưng mất
response → alert critical để admin đối soát tay, KHÔNG BAO GIỜ tự mua lại.
"""
from __future__ import annotations

from abc import abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

import structlog
from sqlalchemy import select

from src.adapters.base import ProvisionResult
from src.adapters.real_api import RealApiAdapter
from src.models.order import Order
from src.models.product import Product, ProductVariant
from src.models.resource import Resource, ResourceStatus
from src.models.supplier_listing import SupplierListing

logger = structlog.get_logger()

# Lý do huỷ đơn white-label cho buyer — không nhắc tên nguồn.
BUYER_MSG_OUT_OF_STOCK = "Gói này vừa hết hàng, đơn đã được hoàn tiền. Vui lòng thử lại sau."
BUYER_MSG_GENERIC = "Không giao được hàng lúc này, đơn đã được hoàn tiền."


class SupplierUnavailableError(Exception):
    """Network error / 5xx / timeout — KHÔNG biết nhà cung cấp đã xử lý chưa."""


class SupplierContractError(Exception):
    """Body không đúng hợp đồng (không phải JSON, thiếu field)."""


class SupplierAuthError(SupplierUnavailableError):
    """API key sai/bị đổi — tách khỏi lỗi mạng để health check báo đúng."""


@dataclass(frozen=True)
class UpstreamListing:
    """Một SKU trong catalog thượng nguồn, đã chuẩn hoá."""

    external_id: str
    name: str
    cost_price: int
    amount: int
    min_qty: int = 1
    max_qty: int | None = None
    format_hint: str | None = None
    # Đường dẫn danh mục thượng nguồn (["Facebook", "Clone Việt…"]) — chỉ để
    # admin nhận diện, lưu vào SupplierListing.extra.
    category_path: tuple[str, ...] = ()


# Phân loại lỗi mua — adapter con map msg/mã của nguồn về đây, tầng chung
# quyết định hậu quả (tắt provider, alert, hoàn tiền…).
PURCHASE_OUT_OF_CREDIT = "out_of_credit"   # hết tiền thượng nguồn → tắt provider
PURCHASE_OUT_OF_STOCK = "out_of_stock"     # SKU hết hàng → fail thường, hoàn buyer
PURCHASE_AUTH = "auth"                     # sai/đổi API key → alert critical
PURCHASE_INVALID_SKU = "invalid_sku"       # SKU không tồn tại → mapping hỏng, alert
PURCHASE_INVALID = "invalid"               # tham số sai (số lượng…) → alert warning
PURCHASE_UNKNOWN = "unknown"               # msg lạ → fail thường + log nguyên văn


@dataclass
class PurchaseOutcome:
    ok: bool
    items: list[str] = field(default_factory=list)
    trans_id: str | None = None
    error_kind: str | None = None
    # Thông điệp NGUYÊN VĂN của nguồn — chỉ vào log/alert admin.
    raw_message: str | None = None


class CatalogSupplierAdapter(RealApiAdapter):
    """Kế thừa RealApiAdapter chỉ để lấy hạ tầng chung (base_url, api_key mã
    hoá at rest, timeout). Không dùng `_request_with_retry` cho lệnh mua."""

    provisions_over_network = True
    provision_has_purchase_side_effect = True

    # Ngưỡng cảnh báo số dư thấp mặc định (VND) — admin ghi đè qua
    # config.low_balance_vnd.
    DEFAULT_LOW_BALANCE = 200_000

    # ------------------------------------------------------------------
    # Wire format — adapter con implement
    # ------------------------------------------------------------------

    @abstractmethod
    async def fetch_balance(self) -> Decimal:
        """Số dư prepaid hiện tại (VND). Raise SupplierUnavailableError /
        SupplierContractError; sai key → raise SupplierAuthError."""

    @abstractmethod
    async def fetch_listing(self, external_id: str) -> UpstreamListing | None:
        """Một SKU với tồn kho/giá REALTIME. None = SKU không tồn tại."""

    @abstractmethod
    async def fetch_catalog(self) -> list[UpstreamListing]:
        """Toàn bộ catalog (dùng cho job đồng bộ)."""

    @abstractmethod
    async def purchase(self, external_id: str, quantity: int, *, order_id: int) -> PurchaseOutcome:
        """ĐÚNG MỘT request mua. Raise SupplierUnavailableError khi không rõ
        kết quả (timeout/5xx) — tầng chung sẽ đối soát bằng số dư."""

    @abstractmethod
    async def fetch_order(self, trans_id: str) -> list[str] | None:
        """Tra lại các dòng đã giao của một giao dịch. None = không tồn tại."""

    # ------------------------------------------------------------------
    # Provision — dùng chung
    # ------------------------------------------------------------------

    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        variant_id = user_config.get("variant_id")
        quantity = int(user_config.get("quantity", 1) or 1)
        if variant_id is None:
            return ProvisionResult(
                success=False,
                error="Thiếu variant_id — adapter catalog chỉ tương thích với chiến lược giá 'fixed'.",
            )

        listing = await self.db.scalar(
            select(SupplierListing).where(SupplierListing.variant_id == variant_id)
        )
        if listing is None:
            return ProvisionResult(
                success=False,
                error=f"Gói #{variant_id} chưa gắn SKU nhà cung cấp (supplier_listings).",
                operational_error=f"Gói #{variant_id} bán qua provider #{self.provider_id} nhưng chưa có mapping SKU.",
                operational_severity="warning",
            )

        # Đơn đã mua rồi (sweeper chạy lại sau khi commit hỏng) → giao lại từ
        # Resource đã tạo, tuyệt đối không mua lần hai.
        existing = list((await self.db.execute(
            select(Resource).where(Resource.order_id == order_id).order_by(Resource.id)
        )).scalars())
        if existing:
            return ProvisionResult(
                success=True,
                data="\n".join(r.data for r in existing),
                resource_id=",".join(str(r.id) for r in existing),
                metadata={"redelivered": True, "resource_ids": [r.id for r in existing]},
            )

        # Số dư trước khi mua — mốc để đối soát nếu lệnh mua timeout. Không
        # lấy được thì vẫn mua (mất khả năng đối soát tự động, có log).
        balance_before: Decimal | None = None
        try:
            balance_before = await self.fetch_balance()
        except Exception as e:  # noqa: BLE001 — chỉ mất mốc đối soát
            logger.warning("supplier_balance_before_failed", provider_id=self.provider_id,
                           order_id=order_id, error=str(e))

        try:
            outcome = await self.purchase(listing.external_product_id, quantity, order_id=order_id)
        except SupplierUnavailableError as e:
            return await self._reconcile_ambiguous(
                order_id, listing, quantity, balance_before, reason=str(e),
            )
        except SupplierContractError as e:
            # Body lạ SAU khi request đã tới nơi — cũng là kết quả mơ hồ.
            return await self._reconcile_ambiguous(
                order_id, listing, quantity, balance_before, reason=f"contract: {e}",
            )

        if not outcome.ok:
            return self._failure(outcome, listing, quantity)

        if len(outcome.items) < quantity:
            # Chưa quan sát thấy igbm giao thiếu, nhưng nếu có thì đây là tiền
            # đã tiêu mà buyer không nhận đủ — đừng giao thiếu âm thầm.
            return ProvisionResult(
                success=False,
                error=f"Nhà cung cấp giao {len(outcome.items)}/{quantity} unit (trans {outcome.trans_id}).",
                buyer_message=BUYER_MSG_GENERIC,
                operational_error=(
                    f"Đơn #{order_id}: nhà cung cấp giao thiếu {len(outcome.items)}/{quantity} unit "
                    f"(trans_id={outcome.trans_id}), buyer đã được hoàn tiền — đối soát tay."
                ),
            )

        resources = await self._create_resources(order_id, listing, outcome.items[:quantity])
        # Cập nhật cache tồn kho ngay: bớt đi số vừa mua, đợi job sync sửa lại.
        listing.upstream_amount = max(listing.upstream_amount - quantity, 0)
        return ProvisionResult(
            success=True,
            data="\n".join(r.data for r in resources),
            resource_id=outcome.trans_id,
            metadata={
                "trans_id": outcome.trans_id,
                "external_product_id": listing.external_product_id,
                "cost_total": listing.cost_price * quantity,
                "resource_ids": [r.id for r in resources],
            },
        )

    def _failure(self, outcome: PurchaseOutcome, listing: SupplierListing, quantity: int) -> ProvisionResult:
        kind = outcome.error_kind or PURCHASE_UNKNOWN
        raw = outcome.raw_message or ""
        if kind == PURCHASE_OUT_OF_CREDIT:
            return ProvisionResult(
                success=False,
                error=f"Nhà cung cấp báo hết tiền: {raw}",
                buyer_message=BUYER_MSG_GENERIC,
                provider_out_of_credit=True,
            )
        if kind == PURCHASE_OUT_OF_STOCK:
            listing.upstream_amount = 0
            return ProvisionResult(
                success=False,
                error=f"SKU {listing.external_product_id} hết hàng: {raw}",
                buyer_message=BUYER_MSG_OUT_OF_STOCK,
            )
        if kind == PURCHASE_AUTH:
            return ProvisionResult(
                success=False,
                error=f"Nhà cung cấp từ chối API key: {raw}",
                buyer_message=BUYER_MSG_GENERIC,
                operational_error=f"Provider #{self.provider_id}: API key bị từ chối ({raw}). Mọi đơn tiếp theo sẽ fail.",
                operational_severity="critical",
            )
        if kind == PURCHASE_INVALID_SKU:
            listing.sync_error = "delisted"
            listing.upstream_amount = 0
            return ProvisionResult(
                success=False,
                error=f"SKU {listing.external_product_id} không tồn tại phía nhà cung cấp: {raw}",
                buyer_message=BUYER_MSG_OUT_OF_STOCK,
                operational_error=(
                    f"Gói #{listing.variant_id} trỏ SKU {listing.external_product_id} không còn tồn tại "
                    f"phía nhà cung cấp — cần gắn lại hoặc tắt gói."
                ),
                operational_severity="warning",
            )
        severity = "warning" if kind == PURCHASE_INVALID else None
        return ProvisionResult(
            success=False,
            error=f"Mua thất bại ({kind}): {raw}",
            buyer_message=BUYER_MSG_GENERIC,
            operational_error=(
                f"Provider #{self.provider_id} từ chối tham số mua (qty={quantity}): {raw}"
                if severity else None
            ),
            operational_severity=severity or "critical",
        )

    async def _reconcile_ambiguous(
        self, order_id: int, listing: SupplierListing, quantity: int,
        balance_before: Decimal | None, *, reason: str,
    ) -> ProvisionResult:
        """Lệnh mua không rõ kết quả. So số dư: giảm ≥ giá × n → gần như chắc
        đã mua mà mất response → critical (tiền đã tiêu, hàng chưa giao). Không
        giảm → fail thường. Không so được → warning để admin tự kiểm."""
        expected = Decimal(listing.cost_price * quantity)
        balance_after: Decimal | None = None
        try:
            balance_after = await self.fetch_balance()
        except Exception as e:  # noqa: BLE001
            logger.warning("supplier_balance_after_failed", provider_id=self.provider_id,
                           order_id=order_id, error=str(e))

        if balance_before is not None and balance_after is not None:
            dropped = balance_before - balance_after
            if dropped >= expected and expected > 0:
                return ProvisionResult(
                    success=False,
                    error=f"Mua không rõ kết quả ({reason}); số dư giảm {dropped} ≈ {expected} → có thể đã mua.",
                    buyer_message=BUYER_MSG_GENERIC,
                    operational_error=(
                        f"Đơn #{order_id}: lệnh mua SKU {listing.external_product_id} x{quantity} timeout nhưng "
                        f"số dư nhà cung cấp giảm {dropped:,.0f}đ (≈ giá vốn {expected:,.0f}đ). Buyer đã được "
                        f"hoàn tiền — ĐỐI SOÁT TAY lịch sử đơn phía nhà cung cấp, hàng có thể đã xuất."
                    ),
                    operational_severity="critical",
                )
            return ProvisionResult(
                success=False,
                error=f"Mua không rõ kết quả ({reason}); số dư không đổi → coi như chưa mua.",
                buyer_message=BUYER_MSG_GENERIC,
            )
        return ProvisionResult(
            success=False,
            error=f"Mua không rõ kết quả ({reason}); không so được số dư.",
            buyer_message=BUYER_MSG_GENERIC,
            operational_error=(
                f"Đơn #{order_id}: lệnh mua SKU {listing.external_product_id} x{quantity} không rõ kết quả "
                f"({reason}) và không đọc được số dư để đối soát. Kiểm tra tay phía nhà cung cấp."
            ),
            operational_severity="warning",
        )

    async def _create_resources(
        self, order_id: int, listing: SupplierListing, items: list[str],
    ) -> list[Resource]:
        """Mỗi dòng giao hàng = một Resource đã gán cho đơn, y hệt seller_pool
        sau claim_resources — nhờ vậy dispute/hoàn tiền theo unit
        (refund_amount_cap) chạy nguyên luồng cũ, không cần nhánh riêng."""
        order = await self.db.get(Order, order_id)
        variant = await self.db.get(ProductVariant, listing.variant_id)
        product = await self.db.get(Product, variant.product_id) if variant else None
        seller_id = product.seller_id if product else (order.seller_id if order else None)
        total = order.total_amount if order else 0
        refund_base, refund_remainder = divmod(total, len(items))
        now = datetime.now(timezone.utc)
        resources: list[Resource] = []
        for index, line in enumerate(items):
            r = Resource(
                variant_id=listing.variant_id,
                seller_id=seller_id,
                status=ResourceStatus.assigned,
                data=line,
                order_id=order_id,
                assigned_at=now,
                provider_id=self.provider_id,
                refund_amount_cap=refund_base + (1 if index < refund_remainder else 0),
            )
            self.db.add(r)
            resources.append(r)
        await self.db.flush()
        return resources

    # ------------------------------------------------------------------
    # Health / usage / revoke
    # ------------------------------------------------------------------

    def low_balance_threshold(self) -> int:
        try:
            return int(self.config.get("low_balance_vnd") or self.DEFAULT_LOW_BALANCE)
        except (TypeError, ValueError):
            return self.DEFAULT_LOW_BALANCE

    async def check_health(self) -> dict:
        """Read-only, không tốn tiền: đọc số dư. Thấp hơn ngưỡng → warning
        (health_check_job chỉ tắt provider khi unhealthy, warning chỉ hiện)."""
        try:
            balance = await self.fetch_balance()
        except SupplierAuthError as e:
            return {"status": "unhealthy", "message": f"API key bị từ chối: {e}"}
        except (SupplierUnavailableError, SupplierContractError) as e:
            return {"status": "unhealthy", "message": f"Không kết nối được nhà cung cấp: {e}"}
        threshold = self.low_balance_threshold()
        if balance < threshold:
            return {
                "status": "warning",
                "balance_vnd": int(balance),
                "message": f"Số dư nhà cung cấp còn {int(balance):,}đ (dưới ngưỡng {threshold:,}đ)",
            }
        return {"status": "healthy", "balance_vnd": int(balance), "message": f"Số dư {int(balance):,}đ"}

    async def get_usage(self, resource_id: str) -> dict | None:
        return None

    async def revoke(self, resource_id: str) -> bool:
        return False  # không có API huỷ/hoàn phía nhà cung cấp
