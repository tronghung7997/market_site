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
from src.models.resource import Resource, ResourceStatus, resource_data_hash, salted_resource_hash
from src.models.supplier_listing import SupplierListing, SupplierPurchase

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

    # Ngưỡng cầu dao: mua lỗi liên tiếp N lần → tự tắt gói (provider config
    # `auto_pause_after_failures`, 0 = tắt cầu dao).
    DEFAULT_AUTO_PAUSE_AFTER = 3

    def auto_pause_after(self) -> int:
        try:
            raw = self.config.get("auto_pause_after_failures")
            return int(self.DEFAULT_AUTO_PAUSE_AFTER if raw in (None, "") else raw)
        except (TypeError, ValueError):
            return self.DEFAULT_AUTO_PAUSE_AFTER

    async def provision(self, order_id: int, user_config: dict) -> ProvisionResult:
        result = await self._purchase_flow(order_id, user_config)
        await self._record_outcome(order_id, user_config.get("variant_id"), result)
        await self._log_purchase(order_id, user_config, result)
        return result

    async def _log_purchase(self, order_id: int, user_config: dict, result: ProvisionResult) -> None:
        """Một dòng `supplier_purchases` cho tab "Đơn mua từ nguồn". Ghi cùng
        transaction với đơn (commit/rollback theo đơn). Giao lại từ Resource
        đã có (sweeper chạy lại) thì dòng cũ vẫn đúng — không ghi thêm."""
        if self.db is None or self.provider_id is None:
            return
        meta = result.metadata or {}
        if meta.get("redelivered"):
            return
        existing = await self.db.scalar(select(SupplierPurchase).where(SupplierPurchase.order_id == order_id))
        if existing is not None:
            return
        variant_id = user_config.get("variant_id")
        listing = None
        if variant_id is not None:
            listing = await self.db.scalar(select(SupplierListing).where(SupplierListing.variant_id == variant_id))
        self.db.add(SupplierPurchase(
            order_id=order_id, provider_id=self.provider_id, variant_id=variant_id,
            external_product_id=meta.get("external_product_id") or (listing.external_product_id if listing else None),
            quantity=int(user_config.get("quantity", 1) or 1),
            cost_total=int(meta.get("cost_total") or 0) if result.success else 0,
            trans_id=(str(meta["trans_id"])[:100] if meta.get("trans_id") else None),
            ok=bool(result.success),
            error=None if result.success else (result.error or "unknown")[:255],
        ))

    async def _record_outcome(self, order_id: int, variant_id, result: ProvisionResult) -> None:
        """Cầu dao theo GÓI: thành công → reset streak; lỗi thuộc về gói/SKU
        (hết hàng, SKU sai, tham số bị từ chối, mua mơ hồ…) → +1; đủ ngưỡng →
        tắt gói + cảnh báo. Lỗi cấp provider (hết tiền, key sai) không tính —
        orders/service đã tắt cả provider cho các ca đó."""
        if variant_id is None or self.db is None:
            return
        listing = await self.db.scalar(select(SupplierListing).where(SupplierListing.variant_id == variant_id))
        if listing is None:
            return
        if result.success:
            if listing.fail_streak:
                listing.fail_streak = 0
                listing.last_fail_reason = None
            return
        if result.provider_out_of_credit or (result.error or "").startswith("Nhà cung cấp từ chối API key"):
            return
        threshold = self.auto_pause_after()
        listing.fail_streak = (listing.fail_streak or 0) + 1
        listing.last_fail_at = datetime.now(timezone.utc)
        listing.last_fail_reason = (result.error or "unknown")[:255]
        if threshold <= 0 or listing.fail_streak < threshold or listing.auto_paused_at is not None:
            return
        variant = await self.db.get(ProductVariant, listing.variant_id)
        if variant is None:
            return
        variant.is_active = False
        listing.auto_paused_at = listing.last_fail_at
        product = await self.db.get(Product, variant.product_id)
        from src.alerts.service import fp_variant, upsert_incident
        await upsert_incident(
            self.db, fingerprint=fp_variant(variant.id, "supplier_auto_paused"), type_="supplier_auto_paused",
            severity="warning", target_type="variant", target_id=variant.id,
            message=(
                f"Gói '{variant.name}' của '{product.title if product else '?'}' đã TỰ TẮT sau "
                f"{listing.fail_streak} lần mua lỗi liên tiếp (đơn gần nhất #{order_id}): "
                f"{listing.last_fail_reason}. Kiểm tra SKU rồi bật lại ở Nguồn cung."
            ),
        )
        logger.warning("supplier_listing_auto_paused", provider_id=self.provider_id,
                       variant_id=variant.id, streak=listing.fail_streak, reason=listing.last_fail_reason)

    async def _purchase_flow(self, order_id: int, user_config: dict) -> ProvisionResult:
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
        # A supplier re-delivering a line we already hold must not fail the
        # order on the marketplace-wide unique digest: that row gets a salted
        # digest and ops get a warning so the supplier can be chased.
        hashes = {resource_data_hash(line) for line in items}
        seen = set((await self.db.execute(
            select(Resource.data_hash).where(Resource.data_hash.in_(list(hashes)))
        )).scalars())
        resources: list[Resource] = []
        for index, line in enumerate(items):
            digest = resource_data_hash(line)
            if digest in seen:
                digest = salted_resource_hash(line, f"order:{order_id}:{index}")
                logger.warning(
                    "supplier_duplicate_delivery", provider_id=self.provider_id, order_id=order_id,
                    listing_id=listing.id, external_product_id=listing.external_product_id,
                )
            r = Resource(
                variant_id=listing.variant_id,
                seller_id=seller_id,
                status=ResourceStatus.assigned,
                data=line,
                data_hash=digest,
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
