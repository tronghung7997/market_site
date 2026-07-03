# Pricing Engine — Giai đoạn 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa nền pricing lúc mua: một điểm tính giá duy nhất (`quote()`), hết nhân đôi quantity/discount, order takedown theo vòng đời task, xoá cột chết `providers.pricing_strategy`, admin gắn product↔provider + sửa giá.

**Architecture:** `PricingStrategy` subclass chỉ implement `_subtotal()`; base class `quote()` áp volume discount đúng một lần và trả `Quote`. `src/pricing/engine.py` gánh 3-tier resolution và là điểm vào duy nhất cho preview endpoint lẫn order service. ManualAdapter đánh dấu `async_fulfillment` → order `processing`; admin update task cuối cùng đồng bộ trạng thái order + refund tỉ lệ.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic (marketplace-svc), Next.js app router (frontend), pytest-asyncio với Postgres test DB (`marketplace_test`).

## Global Constraints

- Spec gốc: `docs/superpowers/specs/2026-07-03-pricing-engine-admin-design.md` (Giai đoạn 1).
- Tiền luôn là VND integer; mọi phép nhân kết thúc bằng `round()`.
- Test backend chạy từ `marketplace-svc/`: `uv run pytest tests/ -x -q` (cần Postgres local, conftest tự trỏ `marketplace_test`).
- Frontend verify bằng `npm run build` (hoặc `npx tsc --noEmit`) trong `frontend/`.
- Commit message tiếng Anh, dạng `feat:`/`fix:`/`refactor:`, kết thúc bằng dòng `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- KHÔNG sửa `db/marketplace-seed.sql` (dump lịch sử; schema mới do alembic quản).

---

### Task 1: Quote + contract mới cho PricingStrategy (base + 4 strategy)

**Files:**
- Modify: `marketplace-svc/src/pricing/base.py`
- Modify: `marketplace-svc/src/pricing/fixed.py`, `config_pricing.py`, `credit.py`, `task.py`
- Test: `marketplace-svc/tests/test_pricing.py` (viết lại phần calculate → quote)

**Interfaces:**
- Produces: `Quote(amount: int, original_amount: int | None, discount_pct: float | None, quantity: int, strategy: str)` dataclass trong `src.pricing.base`; `PricingStrategy.quote(params, user_config) -> Quote`; abstract `_subtotal(params, user_config) -> tuple[int, int]`; `TaskPricing.parse_target_urls(raw: str) -> list[str]` (staticmethod). Method `calculate()` bị XOÁ.

- [ ] **Step 1: Viết test mới (failing)** — thay các test `calculate` trong `tests/test_pricing.py` bằng test `quote()`. Giữ nguyên fixtures params và TestVolumeDiscount. Điểm chính:

```python
# FixedPricing
def test_quote_basic(self):
    q = self.strategy.quote(FIXED_PARAMS, {"variant_id": "premium", "quantity": 3})
    assert (q.amount, q.quantity, q.discount_pct) == (75000, 3, None)
    assert q.original_amount is None

def test_quote_with_volume_discount_applied_once(self):
    q = self.strategy.quote(FIXED_PARAMS, {"variant_id": "premium", "quantity": 10})
    # 25000*10 = 250000, 5% off một lần = 237500 (không phải 225625)
    assert (q.amount, q.original_amount, q.discount_pct) == (237500, 250000, 0.05)

# TaskPricing — quantity tự đếm từ target_urls
TASK_URLS_3 = "https://fb.com/a\nhttps://fb.com/b\n\n https://fb.com/c \n"

def test_quote_counts_urls(self):
    q = self.strategy.quote(TASK_PARAMS, {"platform": "facebook", "target_urls": TASK_URLS_3})
    assert (q.amount, q.quantity) == (1500000, 3)  # 500000 * 1.0 * 3

def test_quote_url_discount_once(self):
    urls = "\n".join(f"https://fb.com/{i}" for i in range(5))
    q = self.strategy.quote(TASK_PARAMS, {"platform": "facebook", "target_urls": urls})
    assert (q.amount, q.original_amount, q.discount_pct) == (2375000, 2500000, 0.05)

def test_validate_requires_urls(self):
    assert self.strategy.validate(TASK_PARAMS, {"platform": "facebook", "target_urls": ""}) is False
    assert self.strategy.validate(TASK_PARAMS, {"platform": "facebook", "target_urls": "https://x.com/1"}) is True

def test_get_options_has_no_quantity_field(self):
    names = [f["field"] for f in self.strategy.get_options(TASK_PARAMS)]
    assert "quantity" not in names and "target_urls" in names
```

ConfigPricing/CreditPricing: đổi `calculate(...) == X` thành `quote(...).amount == X`, giữ nguyên số kỳ vọng (chúng vốn đúng vì chỉ áp discount 1 lần nội bộ). Thêm `strategy` name assert: `q.strategy == "fixed"` v.v.

- [ ] **Step 2: Chạy để thấy fail** — `uv run pytest tests/test_pricing.py -q` → FAIL (`Quote` chưa tồn tại).

- [ ] **Step 3: Implement base.py**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class Quote:
    amount: int
    original_amount: int | None
    discount_pct: float | None
    quantity: int
    strategy: str


class PricingStrategy(ABC):
    """Base class. Subclass implement get_options/validate/_subtotal;
    quote() là API duy nhất để tính tiền — áp volume discount đúng một lần."""

    name: str = ""

    @abstractmethod
    def get_options(self, params: dict) -> list[dict]: ...

    @abstractmethod
    def validate(self, params: dict, user_config: dict) -> bool: ...

    @abstractmethod
    def _subtotal(self, params: dict, user_config: dict) -> tuple[int, int]:
        """Return (pre-discount amount VND, effective quantity)."""

    def quote(self, params: dict, user_config: dict) -> Quote:
        subtotal, quantity = self._subtotal(params, user_config)
        tiers = params.get("volume_tiers", [])
        amount, discount = (
            self.apply_volume_discount(subtotal, quantity, tiers) if tiers else (subtotal, None)
        )
        return Quote(
            amount=amount,
            original_amount=subtotal if discount is not None else None,
            discount_pct=discount,
            quantity=quantity,
            strategy=self.name,
        )

    # apply_volume_discount giữ nguyên như hiện tại
```

Mỗi strategy: set `name = "fixed" | "config" | "credit" | "task"`, đổi `calculate` → `_subtotal` trả `(subtotal, quantity)`, XOÁ đoạn `volume_tiers` nội bộ. Riêng `task.py`:

```python
class TaskPricing(PricingStrategy):
    name = "task"

    @staticmethod
    def parse_target_urls(raw: str) -> list[str]:
        return [u.strip() for u in (raw or "").strip().split("\n") if u.strip()]

    def _subtotal(self, params, user_config):
        urls = self.parse_target_urls(user_config.get("target_urls", ""))
        quantity = len(urls)
        mult = params["platform_mult"][user_config["platform"]]
        return round(params["base_price"] * mult * quantity), quantity

    def validate(self, params, user_config):
        if user_config.get("platform") not in params.get("platform_mult", {}):
            return False
        return len(self.parse_target_urls(user_config.get("target_urls", ""))) >= 1
```

`get_options` của task: xoá field `quantity`. Các strategy khác quantity vẫn từ `user_config` (credit: quantity hiệu dụng = `package_size`).

- [ ] **Step 4: Chạy pass** — `uv run pytest tests/test_pricing.py -q` → PASS. Grep bảo đảm không còn caller `.calculate(`: `grep -rn "\.calculate(" src/ tests/`.
- [ ] **Step 5: Commit** — `refactor: pricing strategies expose quote(), discount applied once`

---

### Task 2: PricingEngine + preview endpoint dùng engine

**Files:**
- Create: `marketplace-svc/src/pricing/engine.py`
- Modify: `marketplace-svc/src/pricing/router.py` (xoá `_load_pricing` + double discount)
- Test: `marketplace-svc/tests/test_pricing_engine.py` (mới, API-level)

**Interfaces:**
- Consumes: `Quote`, `get_pricing_strategy` (Task 1)
- Produces: `async resolve_pricing(product: Product, db) -> tuple[str, dict]`; `async quote_product(product: Product, user_config: dict, db) -> Quote` (raise HTTPException 400 nếu config sai). Task 3 dùng cả hai.

- [ ] **Step 1: Test API failing** — test tạo product strategy `task` (qua fixture giống `setup_adapter_product` trong test_orders.py, set `pricing_strategy="task"`, `pricing_params=TASK_PARAMS` qua SessionLocal), rồi:

```python
resp = await client.post(f"/products/{pid}/calculate", json={"user_config": {
    "platform": "facebook",
    "target_urls": "\n".join(f"https://fb.com/{i}" for i in range(5)),
}})
data = resp.json()
assert data["amount"] == 2375000          # discount 5% đúng MỘT lần
assert data["original_amount"] == 2500000
assert data["discount_pct"] == 0.05
```

Thêm test 3-tier fallback: product không có pricing riêng → lấy từ `pricing_configs`; không có config → strategy fixed.

- [ ] **Step 2: Chạy fail** — `uv run pytest tests/test_pricing_engine.py -q` (fail vì hiện áp discount 2 lần / còn yêu cầu quantity).

- [ ] **Step 3: Implement**

```python
# src/pricing/engine.py
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.pricing_config import PricingConfig
from src.models.product import Product

from .base import Quote
from .factory import get_pricing_strategy


async def resolve_pricing(product: Product, db: AsyncSession) -> tuple[str, dict]:
    """3-tier: product-level -> pricing_configs[service_type] -> fixed."""
    if product.pricing_strategy and product.pricing_params:
        return product.pricing_strategy, product.pricing_params
    service_type = product.service_type or "other"
    result = await db.execute(
        select(PricingConfig).where(
            PricingConfig.service_type == service_type,
            PricingConfig.is_active == True,  # noqa: E712
        )
    )
    config = result.scalars().first()
    if config:
        return config.strategy, config.params
    return "fixed", {}


async def quote_product(product: Product, user_config: dict, db: AsyncSession) -> Quote:
    strategy_name, params = await resolve_pricing(product, db)
    strategy = get_pricing_strategy(strategy_name)
    if not strategy.validate(params, user_config):
        raise HTTPException(status_code=400, detail="Invalid configuration")
    return strategy.quote(params, user_config)
```

`pricing/router.py`: `_load_pricing` rút còn fetch product (404) + `resolve_pricing`. Endpoint `calculate` = fetch product + `quote_product` + trả `CalculateResponse(amount=q.amount, original_amount=q.original_amount, discount_pct=q.discount_pct)` — XOÁ block dòng 70-77 cũ. `pricing_options` và `product_operations` dùng `resolve_pricing`.

- [ ] **Step 4: Pass** — `uv run pytest tests/test_pricing_engine.py tests/test_pricing.py -q`
- [ ] **Step 5: Commit** — `feat: pricing engine as single quote entry point`

---

### Task 3: Order dùng engine — hết nhân đôi

**Files:**
- Modify: `marketplace-svc/src/orders/service.py:72-122` (`create_order_with_adapter`)
- Modify: `marketplace-svc/src/orders/router.py:24-25` (bỏ truyền quantity)
- Test: thêm vào `marketplace-svc/tests/test_orders.py`

**Interfaces:**
- Consumes: `quote_product` (Task 2)
- Produces: `create_order_with_adapter(buyer_id, product_id, user_config, db)` — signature MẤT tham số `quantity`; `order.quantity = quote.quantity`.

- [ ] **Step 1: Test failing** — trong test_orders.py, dùng `setup_adapter_product` nhưng đặt quantity trong user_config > 1 và so khớp preview:

```python
@pytest.mark.asyncio
async def test_order_total_matches_preview_quote(client):
    buyer_token, _, _, product_id = await setup_adapter_product(client)
    user_config = {"type": "residential", "network": "shared", "days": 30, "quantity": 2}
    preview = await client.post(f"/products/{product_id}/calculate", json={"user_config": user_config})
    resp = await client.post("/orders", json={
        "product_id": product_id, "user_config": user_config, "quantity": 2,
    }, headers={"Authorization": f"Bearer {buyer_token}"})
    data = resp.json()
    # 10000*1.5*1.0*1*2 = 30000 — KHÔNG phải 60000 (bug nhân đôi cũ)
    assert data["total_amount"] == 30000
    assert data["total_amount"] == preview.json()["amount"]
    assert data["quantity"] == 2
```

- [ ] **Step 2: Fail** — total_amount hiện = 60000.
- [ ] **Step 3: Implement** — thay block dòng 84-117 bằng:

```python
    q = await quote_product(product, user_config, db)
    total_amount = q.amount
```

Xoá import PricingConfig/get_pricing_strategy nếu không còn dùng; `Order(..., quantity=q.quantity, ...)`. Router: `create_order_with_adapter(account.id, body.product_id, body.user_config, db)`. (`body.quantity` chỉ còn cho flow variant cũ.)

- [ ] **Step 4: Pass** — `uv run pytest tests/test_orders.py -q` (sửa luôn test cũ nếu có test khẳng định hành vi nhân đôi).
- [ ] **Step 5: Commit** — `fix: order total uses engine quote, no double quantity/discount`

---

### Task 4: Order↔Task lifecycle (takedown)

**Files:**
- Modify: `marketplace-svc/src/adapters/manual.py` (metadata `async_fulfillment`)
- Modify: `marketplace-svc/src/orders/service.py` (processing khi async)
- Modify: `marketplace-svc/src/tasks/service.py`, `src/tasks/router.py`, `src/tasks/schemas.py`
- Test: `marketplace-svc/tests/test_task_lifecycle.py` (mới)

**Interfaces:**
- Consumes: `refund_escrow(order_id, buyer_id, amount, db)` (wallet), `ServiceTaskStatus`
- Produces: `TaskResponse.order_status: str | None`; `service.update_task(...) -> tuple[ServiceTask, str | None]`; `GET /admin/tasks` trả thêm `order_status` mỗi task.

- [ ] **Step 1: Test failing** — flow đầy đủ: product strategy `task` + provider manual; buyer mua với 4 URL:
  1. Sau mua: `order.status == "processing"`, có đúng 4 ServiceTask, ví bị trừ đúng quote.
  2. Admin PUT 3 task → completed: order vẫn processing. PUT task cuối → completed: response có `order_status == "delivered"`; GET order thấy delivered + escrow_expires_at.
  3. Case fail một phần (test riêng): 4 task, 1 failed 3 completed → refund `round(total*1/4)` về ví buyer, order delivered, `order.total_amount` giảm đi phần refund.
  4. Case fail toàn bộ → order cancelled, refund đủ.
  5. `PUT /admin/tasks/{id}` với `{"assignee": null}` xoá được assignee.

- [ ] **Step 2: Fail** — order hiện delivered ngay khi mua.
- [ ] **Step 3: Implement**
  - `manual.py` provision metadata: thêm `"async_fulfillment": True`.
  - `orders/service.py` nhánh success:

```python
    if provision_result.success:
        if (provision_result.metadata or {}).get("async_fulfillment"):
            order.status = OrderStatus.processing
            await log_event(db, "info", f"Order {order.id} awaiting manual fulfillment",
                            request_id=rid, metadata={"event": "order_processing", "order_id": order.id})
        else:
            order.status = OrderStatus.delivered
            order.delivered_data = provision_result.data
            order.escrow_expires_at = ...  # như cũ
        # log order_placed giữ nguyên cho cả hai nhánh
```

  - `tasks/service.py`:

```python
_TERMINAL = {ServiceTaskStatus.completed, ServiceTaskStatus.failed}

async def update_task(task_id, updates, db) -> tuple[ServiceTask, str | None]:
    task = await db.get(ServiceTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    for key, value in updates.items():
        setattr(task, key, value)          # cho phép set None (xoá assignee)
    order_status = await _sync_order_status(task, db)
    await db.commit()
    await db.refresh(task)
    return task, order_status


async def _sync_order_status(task, db) -> str | None:
    order = await db.get(Order, task.order_id)
    if not order:
        return None
    if order.status != OrderStatus.processing:
        return order.status.value
    result = await db.execute(select(ServiceTask).where(ServiceTask.order_id == order.id))
    tasks = list(result.scalars().all())
    if any(t.status not in _TERMINAL for t in tasks):
        return order.status.value
    failed = [t for t in tasks if t.status == ServiceTaskStatus.failed]
    if len(failed) == len(tasks):
        await refund_escrow(order.id, order.buyer_id, order.total_amount, db)
        order.status = OrderStatus.cancelled
        order.total_amount = 0
    else:
        if failed:
            refund = round(order.total_amount * len(failed) / len(tasks))
            if refund:
                await refund_escrow(order.id, order.buyer_id, refund, db)
                order.total_amount -= refund   # escrow release sau này chỉ trả phần còn lại cho seller
        order.status = OrderStatus.delivered
        product = await db.get(Product, order.product_id) if order.product_id else None
        days = product.escrow_days if product else 3
        order.escrow_expires_at = datetime.now(timezone.utc) + timedelta(days=days)
    return order.status.value
```

  - `schemas.py`: `TaskResponse` thêm `order_status: str | None = None`. Router PUT: `task, order_status = await service.update_task(...)`; build `TaskResponse.model_validate(task)` rồi gán `order_status`. Router GET list: query map `order_id -> status` một lần rồi gán vào từng response.
- [ ] **Step 4: Pass** — `uv run pytest tests/test_task_lifecycle.py tests/test_orders.py tests/test_adapters.py -q`
- [ ] **Step 5: Commit** — `feat: task-driven order lifecycle for manual fulfillment`

---

### Task 5: Xoá cột chết `providers.pricing_strategy`

**Files:**
- Create: `marketplace-svc/alembic/versions/m1a2b3c4d5e6_drop_provider_pricing_strategy.py` (down_revision `l1a2b3c4d5e6`)
- Modify: `src/models/provider.py` (xoá dòng 21), `src/providers/schemas.py` (xoá khỏi ProviderUpdateRequest + ProviderResponse), `src/providers/router.py`/`service.py` nếu có gán field này, `scripts/seed_demo.py` (bỏ pricing_strategy khỏi seed provider)
- Modify: `frontend/lib/types.ts` (Provider.pricing_strategy), `frontend/app/admin/providers/page.tsx` (bỏ `strategyLabel` + Tag ở ProviderCard, dòng 457 & 495)
- Test: cập nhật `tests/test_providers.py` nếu assert field này

- [ ] **Step 1: Migration**

```python
"""drop dead providers.pricing_strategy column"""
from alembic import op
import sqlalchemy as sa

revision = "m1a2b3c4d5e6"
down_revision = "l1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("providers", "pricing_strategy")


def downgrade():
    op.add_column("providers",
        sa.Column("pricing_strategy", sa.String(50), server_default="fixed", nullable=True))
```

- [ ] **Step 2: Gỡ mọi tham chiếu backend + frontend** — `grep -rn "pricing_strategy" src/ scripts/ ../frontend/lib/types.ts ../frontend/app/admin/providers/` chỉ còn hits của **product** (hợp lệ), không còn của provider.
- [ ] **Step 3: Chạy migration + test** — `uv run alembic upgrade head` (DB dev) và `uv run pytest tests/test_providers.py tests/ -q`.
- [ ] **Step 4: Commit** — `refactor: drop unused providers.pricing_strategy column`

---

### Task 6: API liệt kê sản phẩm liên kết đầy đủ hơn

**Files:**
- Modify: `marketplace-svc/src/pricing/router.py` (`provider_products`)
- Test: thêm case vào `tests/test_pricing_engine.py`

**Interfaces:**
- Produces: item của `GET /admin/providers/{id}/products` thêm `pricing_params: dict | null`, `status: str`. Frontend Task 7 dùng.

- [ ] **Step 1: Test failing** — admin gọi endpoint, assert item có `pricing_params` và `status`.
- [ ] **Step 2: Implement** — thêm 2 key vào dict items (p.pricing_params, p.status.value).
- [ ] **Step 3: Pass + Commit** — `feat: provider products endpoint returns pricing params`

---

### Task 7: Frontend /admin/providers — gắn/tháo product & sửa giá

**Files:**
- Modify: `frontend/app/admin/providers/page.tsx` (ProviderProductsTab)
- Modify: `frontend/lib/api.ts` (không cần method mới — dùng `adminProducts`, `updateProductOperations`, `calculatePrice` sẵn có), `frontend/lib/types.ts` (thêm `pricing_params` vào ProviderProduct interface local)

**Interfaces:**
- Consumes: `api.adminProducts()`, `api.updateProductOperations(productId, {provider_id | pricing_strategy | pricing_params})`, `api.calculatePrice(productId, userConfig)`, endpoint Task 6.

- [ ] **Step 1: Implement UI** trong `ProviderProductsTab`:
  - Header tab: `Select` liệt kê products từ `api.adminProducts()` chưa thuộc provider này + nút "Gắn sản phẩm" → `updateProductOperations(pid, {provider_id: providerId})` → reload list.
  - Mỗi row thêm 2 nút: "Sửa giá" và "Tháo" (`updateProductOperations(pid, {provider_id: null})`).
  - "Sửa giá" mở khối inline dưới row: `Select` strategy (fixed/config/credit/task) + `Textarea` JSON `pricing_params` (parse client, báo lỗi nếu JSON sai) + `Textarea` JSON config mẫu + nút "Tính thử" gọi `api.calculatePrice` hiển thị `amount/original_amount/discount_pct` + nút "Lưu" gọi `updateProductOperations(pid, {pricing_strategy, pricing_params})`.
  - StatCard "Sản phẩm liên kết" ở trang chính: đếm `adminProducts().filter(p => p.provider_id != null).length` thay cho "--" (fetch một lần cùng useEffect providers; types.ts AdminProduct cần `provider_id` — kiểm tra, thêm nếu thiếu).
- [ ] **Step 2: Verify** — `npm run build` pass; smoke thủ công nếu dev server sẵn.
- [ ] **Step 3: Commit** — `feat(admin): manage product-provider link and pricing from providers page`

---

### Task 8: Frontend /admin/tasks — trạng thái order

**Files:**
- Modify: `frontend/app/admin/tasks/page.tsx`, `frontend/lib/types.ts` (ServiceTask thêm `order_status?: string | null`)

- [ ] **Step 1: Implement** — thêm cột "Đơn hàng" hiển thị `#order_id` + Tag `order_status` (map màu như STATUS_TONE order: processing=iris, delivered=good, cancelled=bad). Sau `handleSave`, nếu `updated.order_status` khác task cũ → hiển thị dòng thông báo "Đơn #X chuyển sang {status}" (state banner nhỏ trên bảng, tự ẩn 5s).
- [ ] **Step 2: Verify** — `npm run build`.
- [ ] **Step 3: Commit** — `feat(admin): show order status transitions on tasks page`

---

### Task 9: Verification tổng

- [ ] `cd marketplace-svc && uv run pytest tests/ -q` — toàn bộ pass.
- [ ] `cd frontend && npm run build` — pass.
- [ ] Grep hồi quy: `grep -rn "\.calculate(" marketplace-svc/src` → 0 hit; `grep -rn "pricing_strategy" marketplace-svc/src/models/provider.py` → 0 hit.
- [ ] Chạy dev stack nếu có (docker-compose.dev.yml) và bấm thử flow takedown end-to-end (mua 2 URL → 2 task → complete → delivered).
