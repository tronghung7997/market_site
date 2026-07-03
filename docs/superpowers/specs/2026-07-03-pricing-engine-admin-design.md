# Thiết kế: Pricing Engine & quản lý giá qua /admin/providers, /admin/tasks

Ngày: 2026-07-03
Trạng thái: chờ review

Tài liệu chia 2 giai đoạn, implementation plan tách riêng được:

- **Giai đoạn 1** — sửa nền pricing lúc mua (bug quantity/discount, engine,
  order↔task, admin UI). Bắt buộc làm trước.
- **Giai đoạn 2** — pricing lúc sử dụng (metered) cho nhóm Token/Endpoint,
  quota & expiry cho gói credit, vòng đời thuê bao Cloud Env, adapter
  scrapecreators thật. Phủ nốt tiêu chí "pricing linh hoạt theo loại tài
  nguyên, quota và thời gian sử dụng".

## Phạm vi nhóm dịch vụ (theo bảng tiêu chí nền tảng)

| Nhóm dịch vụ | Strategy | Giai đoạn |
|---|---|---|
| Proxy | `config` | 1 (đã có) |
| Asset | `fixed` | 1 (đã có) |
| Takedown | `task` | 1 (sửa bug) |
| Payment/Credit | `credit` + số dư gói | 1 có, số dư ở GĐ 2 |
| Token | `metered` | 2 |
| Endpoint (ScrapeCreators…) | `metered` + endpoint_rates | 2 |
| Cloud Environment | `config` + renewal/expiry | 2 |

## Bối cảnh & vấn đề

Chiến lược giá per-request/takedown đang tính sai. Review hiện trạng tìm thấy:

1. **Quantity nhân hai lần**: mọi `PricingStrategy.calculate()` đã nhân
   `quantity` bên trong (vd `src/pricing/task.py:45`), nhưng
   `create_order_with_adapter` nhân lại lần nữa
   (`src/orders/service.py:112`). Đơn takedown 5 URL bị tính 25× base price.
2. **Volume discount áp hai lần**: strategy tự áp trong `calculate()`
   (`src/pricing/task.py:47-49`), rồi cả preview endpoint
   (`src/pricing/router.py:70-77`) lẫn order service
   (`src/orders/service.py:115-117`) áp lại → discount bình phương,
   giá preview ≠ giá trừ ví.
3. **`quantity` không ràng buộc với số URL**: form takedown có cả
   `target_urls` (textarea) và `quantity` (number) riêng, không validate
   khớp. `ManualAdapter.provision` tạo 1 ServiceTask mỗi URL bất kể
   quantity → trả tiền 1 URL, tạo 10 task.
4. **`Provider.pricing_strategy` là cột chết**: model có cột, UI
   `/admin/providers` hiển thị tag, nhưng resolve giá (`_load_pricing`:
   product → pricing_configs → fixed) không bao giờ đọc nó.
5. **Order `delivered` khi task còn `pending`**: `ManualAdapter.provision`
   trả success ngay → order delivered + escrow chạy trước khi ai xử lý.
   Admin đánh dấu task completed/failed không cập nhật order.
6. **Thiếu UI admin**: tab "Sản phẩm liên kết" read-only; không gắn/tháo
   product ↔ provider, không sửa pricing product (backend
   `PUT /admin/products/{id}/operations` đã hỗ trợ, UI chưa có).

## Quyết định đã chốt

- **Nguồn giá: Product-level.** Provider chỉ là kênh fulfillment; xoá cột
  `Provider.pricing_strategy`. (Người dùng chọn.)
- **Order↔Task: task-driven.** Order takedown ở `processing` sau khi mua;
  task cuối completed → `delivered` + escrow; task failed → refund tỉ lệ.
  (Người dùng chọn.)
- **Quantity tự đếm từ `target_urls`.** Bỏ field quantity ở form takedown.
  (Chọn theo khuyến nghị — người dùng vắng mặt khi hỏi; xác nhận lại khi review.)

## Kiến trúc

### 1. Pricing engine — một điểm vào duy nhất

File mới `marketplace-svc/src/pricing/engine.py`:

```python
@dataclass
class Quote:
    amount: int              # tổng cuối cùng (VND)
    original_amount: int | None  # trước discount, None nếu không có discount
    discount_pct: float | None
    quantity: int            # quantity hiệu dụng (vd = số URL)
    strategy: str
    params: dict

async def quote(product_id: int, user_config: dict, db: AsyncSession) -> Quote
```

- `quote()` gánh 3-tier resolution (product.pricing_strategy/params →
  pricing_configs[service_type] → "fixed" rỗng), thay cho `_load_pricing`
  trong `pricing/router.py` và bản copy trong `orders/service.py`.
- Raise `HTTPException(404)` nếu product không tồn tại,
  `HTTPException(400)` nếu user_config không hợp lệ.

### 2. Contract mới cho PricingStrategy

`src/pricing/base.py`:

- Subclass chỉ implement:
  - `get_options(params) -> list[dict]` (giữ nguyên)
  - `_subtotal(params, user_config) -> tuple[int, int]` — trả
    (tiền chưa discount, quantity hiệu dụng)
  - `validate(params, user_config) -> bool` (giữ nguyên)
- Base class cung cấp `quote(params, user_config) -> Quote`: gọi
  `_subtotal`, áp `apply_volume_discount` đúng **một lần**, điền
  original_amount/discount_pct.
- Xoá code volume-discount lặp trong cả 4 strategy; xoá method
  `calculate()` public (callers chuyển sang `quote()`).

Thay đổi theo strategy:

- `TaskPricing._subtotal`: parse `target_urls` (mỗi dòng 1 URL, trim,
  bỏ dòng rỗng), `quantity = len(urls)`; giá = base_price × platform_mult
  × quantity. `get_options` bỏ field `quantity`. `validate` bỏ yêu cầu
  `quantity`, yêu cầu ≥1 URL hợp lệ.
- `FixedPricing`, `ConfigPricing`: quantity lấy từ `user_config["quantity"]`
  như cũ, chỉ chuyển thân `calculate` → `_subtotal` và bỏ đoạn discount.
- `CreditPricing`: quantity hiệu dụng = `package_size`.

### 3. Callers

- `POST /products/{id}/calculate` (`pricing/router.py`): gọi
  `engine.quote()`, trả amount/original_amount/discount_pct từ Quote.
  Xoá đoạn áp discount lần hai (dòng 70-77 hiện tại).
- `create_order_with_adapter` (`orders/service.py`):
  - `q = await engine.quote(...)`; `total_amount = q.amount`;
    `order.quantity = q.quantity`. Xoá `* quantity` và đoạn discount thừa.
  - Tham số `quantity` từ request bị bỏ qua cho strategy `task`
    (đếm từ URL); các strategy khác quantity vẫn nằm trong `user_config`.
- `GET /products/{id}/operations` và `GET /products/{id}/pricing-options`:
  dùng resolution của engine (một hàm helper chung
  `resolve_pricing(product, db) -> (strategy_name, params)`).

### 4. Vòng đời order ↔ task (takedown / manual)

- `ProvisionResult.metadata` thêm quy ước `{"async_fulfillment": True}`
  do `ManualAdapter` trả về.
- `create_order_with_adapter`: nếu provision success **và**
  `async_fulfillment` → `order.status = processing`, **không** set
  `escrow_expires_at`, log event `order_processing`.
  Adapter đồng bộ (mock, seller_pool) giữ nguyên → delivered ngay.
- `tasks/service.update_task`: sau khi lưu, nếu task thuộc order
  `processing` và **mọi** task của order đã terminal
  (completed/failed):
  - Tất cả completed → order `delivered`, set `escrow_expires_at`
    (= now + product.escrow_days), log `order_delivered_by_tasks`.
  - Một phần failed → refund `round(total_amount × n_failed / n_tasks)`
    về ví buyer (dùng `refund_escrow` partial), order `delivered` cho
    phần còn lại, log kèm số task fail.
  - Tất cả failed → refund toàn bộ, order `cancelled`.
- Response của `PUT /admin/tasks/{task_id}` thêm field
  `order_status` để UI hiển thị chuyển trạng thái.
- Sửa luôn bug nhỏ trong `tasks/service.update_task`: hiện
  `if value is not None` khiến không thể xoá assignee; chuyển sang
  `exclude_unset` từ router (đã có) và set thẳng giá trị kể cả None.

### 5. Dọn cột chết + admin UI

Backend:
- Alembic migration: drop `providers.pricing_strategy`.
- `GET /admin/providers/{id}/products` bổ sung `pricing_params` tóm tắt
  (để UI hiển thị giá cơ bản) — giữ response hiện có, thêm field.

Frontend `/admin/providers`:
- Bỏ Tag chiến lược giá trên `ProviderCard` (đọc từ cột chết).
- Tab "Sản phẩm liên kết":
  - Nút "Gắn sản phẩm": chọn product chưa có provider (hoặc đổi từ
    provider khác) → `PUT /admin/products/{id}/operations`
    với `provider_id`.
  - Mỗi dòng product: nút "Sửa giá" mở form: select strategy
    (fixed/config/credit/task) + textarea JSON cho params (validate
    parse phía client; server validate bằng dry-run `strategy.validate`),
    nút "Tính thử" gọi `POST /products/{id}/calculate`
    với config mẫu, nút "Tháo liên kết" (set `provider_id = null`).
- StatCard "Sản phẩm liên kết" đang hardcode "--": điền số thật
  (tổng products có provider_id, lấy từ API).

Frontend `/admin/tasks`:
- Thêm cột trạng thái order; sau khi lưu task, nếu `order_status` đổi
  thì toast "Đơn #X → delivered/refunded...".

### 6. Testing

- Cập nhật `tests/test_pricing.py` theo contract `quote()`.
- Test hồi quy mới:
  - Cùng product + user_config: amount từ `/calculate` == total_amount
    của order tạo ra.
  - TaskPricing: 5 URL trong textarea → quantity 5, giá 5 × base × mult;
    volume discount áp đúng một lần.
  - Manual order: sau mua status = processing, không có escrow; đánh dấu
    task cuối completed → delivered + escrow; 2/5 task failed → refund
    40%, order delivered.
  - `update_task` cho phép set assignee = null.
- Test adapter giữ nguyên (`tests/test_adapters.py`) — chỉ thêm assert
  metadata `async_fulfillment` cho ManualAdapter.

---

# Giai đoạn 2: Usage-time charging (metered), quota & subscription

Bối cảnh: cả 4 strategy hiện tại chỉ tính giá **một lần lúc tạo order**.
Nhóm Token/Endpoint là metered billing — tiền tiêu khi *dùng*. Tham chiếu
ScrapeCreators (docs.scrapecreators.com): credit-based, mỗi endpoint tiêu
số credit khác nhau, hết credit trả HTTP 402, có API xem balance/lịch sử.

## 7. Strategy `metered` + số dư gói

- Strategy mới `MeteredPricing` đăng ký vào `_STRATEGIES` là `"metered"`:
  - `params`: `{"unit_price": int, "unit_label": "request"|"1k_tokens",
    "endpoint_rates": {"<endpoint>": <units>}, "default_rate": 1,
    "packages": [{"units": int, "price": int, "expires_days": int|null}],
    "markup": float}` — `endpoint_rates` quy đổi 1 lần gọi endpoint X
    thành bao nhiêu unit; giá bán = giá vốn provider × `markup` khi
    admin muốn neo theo cost.
  - Lúc mua (`_subtotal`): bán **gói units** như credit — quote như GĐ 1.
  - Lúc dùng: KHÔNG qua quote; đi qua usage ledger (mục 8).
- Model mới `OrderBalance` (1-1 với order metered/credit):
  `order_id, units_total, units_used, expires_at | null`.
  Order metered/credit khi delivered → tạo balance.

## 8. Usage ledger — bảng `usage_records`

- Model `UsageRecord`: `id, order_id, request_id, endpoint, units,
  credits_charged, provider_cost | null, status(ok|rejected|error),
  created_at`. Persistent (tiêu chí: transaction/credit không mất khi
  restart; truy vết theo request/job ID).
- Service `usage.charge(order_id, endpoint, request_id, db) -> ChargeResult`:
  1. Load `OrderBalance` FOR UPDATE; hết hạn (`expires_at < now`) →
     reject `quota_expired`.
  2. `units = endpoint_rates.get(endpoint, default_rate)`;
     `units_used + units > units_total` → reject `quota_exceeded`
     (tương đương 402 phía mình).
  3. Ghi `UsageRecord`, tăng `units_used`, commit.
- Endpoint `POST /orders/{id}/usage` (auth: chủ order hoặc internal khi
  proxy request qua adapter) và `GET /orders/{id}/usage` (buyer + admin)
  trả balance + lịch sử.
- Scheduler job: quét balance có `units_used/units_total ≥ 0.9` hoặc sắp
  `expires_at` → tạo Alert "tài nguyên sắp hết" (dùng hệ alerts sẵn có).

## 6b. Nguyên tắc tích hợp provider (áp dụng cho mọi adapter mới)

Mục tiêu: kết nối provider riêng lẻ khi chưa biết đầy đủ họ cung cấp gì,
mà không đụng vào order flow / pricing / các yêu cầu nền tảng.

1. **Contract là ranh giới duy nhất.** Nền tảng chỉ phụ thuộc
   `ProviderAdapter` (provision/check_health/get_usage/revoke +
   quy ước metadata `async_fulfillment`). Mọi khác biệt giữa provider
   nằm trong `provider.config` (data), không nằm trong code gọi adapter.
2. **Golden contract test.** Bộ test dùng chung trong
   `tests/test_adapter_contract.py`, parametrize theo mọi adapter đã
   đăng ký: ProvisionResult đúng shape, lỗi trả về qua
   `success=False/error` (không raise loại lạ), `check_health.status ∈
   {healthy, warning/degraded, down}`, `revoke` idempotent. Adapter mới
   bắt buộc pass để merge.
3. **Capability khai báo trong config.** `provider.config.capabilities:
   ["endpoint"|"takedown"|"asset"|"proxy"|"cloud_env"|"token"]`.
   API gắn product↔provider (PUT /admin/products/{id}/operations)
   validate `product.service_type` khớp capability; UI lọc danh sách
   provider theo capability.
4. **Endpoint map trung lập.** `pricing_params.endpoint_rates` dùng tên
   catalog nội bộ (vd `tiktok_profile`), KHÔNG dùng path của provider.
   `provider.config.endpoint_map: {"tiktok_profile": "/v1/tiktok/profile"}`
   dịch sang provider cụ thể. Đổi provider cùng loại = đổi provider_id,
   product/pricing giữ nguyên.
5. **Mock ở tầng HTTP, không thay adapter.** Adapter cho provider thật
   viết bằng httpx như code production; dev/demo trỏ `base_url` vào
   fake server (FastAPI stub trong `scripts/fake_scrapecreators.py`,
   test dùng respx). Lên production chỉ đổi `base_url` + `api_key`
   trong config qua UI — không sửa code.
6. **4 archetype giá — không thêm strategy theo provider.**
   one-off=`fixed`, per-task=`task`, time-based=`config`,
   metered=`metered`. Provider mới chọn archetype + điền params.
   `credit` coi là alias legacy của metered; sản phẩm mới dùng
   `metered` để tránh chuyển đổi về sau.

## 9. Adapter `scrapecreators` (mẫu cho nhóm Endpoint)

- Class `ScrapeCreatorsAdapter(ProviderAdapter)`, đăng ký `ADAPTER_MAP`
  (UI /admin/providers đã có option nhưng hiện chọn là lỗi
  "Unknown adapter_type" — sửa gap này).
  - `config`: `{api_key, base_url, low_credit_threshold}`.
  - `provision`: với dịch vụ Endpoint, provision = cấp API key nội bộ /
    scoped token cho buyer (không gọi provider lúc mua).
  - `check_health`: gọi API balance của ScrapeCreators; trả `degraded`
    khi balance < threshold, kèm message số credit còn lại → scheduler
    health-check sẵn có tự bắn alert (tiêu chí "provider lỗi/sắp hết").
  - `get_usage(resource_id)`: đọc request history từ provider để đối
    soát với `usage_records` (lệch → log warning).
- `manual`/`mock`/`seller_pool` không đổi. Adapter `topproxy` ngoài scope
  (làm tương tự khi có tài khoản).

## 10. Cloud Environment — renewal & expiry

- Dùng `config` strategy (days/30) như hiện tại cho giá mua.
- Model resource đã có trạng thái available/assigned/expired/error:
  thêm `expires_at` set lúc provision = now + days.
- Scheduler job `resource_expiry_job`: resource `assigned` quá
  `expires_at` → chuyển `expired`, gọi `adapter.revoke()`, tạo Alert
  cho buyer trước hạn 3 ngày.
- Gia hạn = **order mới** loại `renewal` tham chiếu order gốc
  (`parent_order_id` trên Order, nullable): giá = quote với days mới;
  thành công → dời `expires_at`. Không mutate order cũ, không proration
  (nâng cấp spec giữa kỳ = ngoài phạm vi).

## 11. Admin UI bổ sung (GĐ 2)

- `/admin/providers`: card provider scrapecreators hiển thị credit
  balance từ health mới nhất; form config có `low_credit_threshold`.
- Trang chi tiết order (admin + buyer): tab "Sử dụng" hiển thị balance,
  progress quota, bảng usage_records (endpoint, units, thời gian,
  request_id).

## 12. Testing GĐ 2

- `usage.charge`: trừ đúng theo endpoint_rates; reject khi vượt quota /
  hết hạn; concurrent charge không âm số dư (test 2 charge song song).
- MeteredPricing quote gói == giá gói khai báo.
- ScrapeCreatorsAdapter: mock HTTP — health degraded dưới threshold;
  402 từ provider map thành lỗi rõ ràng.
- Expiry job: resource quá hạn → expired + revoke gọi đúng; renewal
  order dời expires_at.

## Ngoài phạm vi

- Adapter topproxy (làm theo mẫu scrapecreators khi có credentials).
- Partial delivery theo từng URL với escrow riêng từng dòng.
- Proration khi nâng cấp spec Cloud Env giữa kỳ.
- Đối soát tự động usage nội bộ ↔ provider (chỉ log warning khi lệch).
- Sửa dữ liệu order lịch sử đã tính giá sai.

## Rủi ro & di trú

- Đổi contract `calculate()` → `quote()` là breaking với mọi caller
  nội bộ; grep toàn repo trước khi xoá method cũ.
- Orders cũ đã tạo với giá sai: không sửa dữ liệu lịch sử trong scope
  này; nếu cần, viết script đối soát riêng.
- Migration drop cột chạy sau khi code ngừng đọc cột (deploy backend
  trước, migration sau hoặc cùng release vì cột không được đọc ở
  runtime path nào ngoài response model — cần bỏ field khỏi
  `providers/schemas.py` cùng lúc).
