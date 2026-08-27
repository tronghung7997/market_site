# Thiết kế: Seller tự đấu nối backend + Gateway đứng giữa buyer↔seller

Ngày: 2026-07-21 — 2026-07-22
Trạng thái: **Mục 1, 2, 3 (seller self-service, gateway generic, vận hành: rotate/revoke/rate-limit/SLA sweep) đã có code chạy được** — xem "Seller self-service + gateway generic + vận hành (2026-07-22)" cuối file. Toàn bộ đã qua `pytest` với PostgreSQL/Redis thật.
Tiếp nối: `docs/superpowers/specs/2026-07-03-pricing-engine-admin-design.md` (Giai đoạn 1 đã xong, Giai đoạn 2 **chưa** triển khai — xem mục "Đối chiếu hiện trạng").

## Câu hỏi gốc

> Với source hiện tại, làm sao thiết lập sản phẩm bán proxy, task (đa dạng
> loại task), credit kiểu ScraperAPI (mình đứng giữa gọi qua mình, buyer và
> seller work được, mở rộng cho nhiều loại sản phẩm)? Và generic hoá cách
> tính tiền + cách quản lý từ admin/seller sao cho mình luôn ở vế trung
> gian, quản lý được nhưng **không cần biết nghiệp vụ seller** vẫn đấu
> nối được?

## Đối chiếu hiện trạng (đã review code thật, không suy đoán)

**Đã có, dùng được ngay:**

- 4 pricing strategy generic (`fixed/config/credit/task`,
  `src/pricing/*.py`), một điểm quote duy nhất
  `pricing/engine.py::quote_product`, không lệch giữa preview và order.
- `ProviderAdapter` contract (`adapters/base.py`): `provision / check_health
  / get_usage / revoke` — 4 adapter cụ thể (`mock/seller_pool/manual/
  real_api`), factory + fallback chain (`adapters/factory.py`).
- Compat matrix adapter↔strategy chặn cấu hình sai lúc lưu
  (`adapters/compatibility.py`), không phải chờ buyer đặt hàng mới vỡ.
- Mã hoá credential tại chỗ (`security/crypto.py`, Fernet, chỉ
  `api_key/api_secret/secret_key/token`), chỉ decrypt trong RAM lúc gọi
  provider thật (`adapters/real_api.py:34`) — **không log body** vì response
  provision mang credential giao cho buyer (`models/provider.py:38-48`).
- Ledger sử dụng (`usage/`): `OrderBalance` + `UsageRecord`, khoá row
  `FOR UPDATE`, reject khi hết hạn/hết quota — đúng nguyên lý ScraperAPI
  (mua gói request, trừ dần).
- Seller tự cấu hình `pricing_strategy`/`pricing_params` trên sản phẩm của
  mình (commit `72f8fa0`, `PUT /seller/products/{id}/pricing`), tách nhãn
  buyer thấy khỏi mã máy gửi provider.
- Escrow/ví nội bộ generic theo `Transaction` ledger, không quan tâm sản
  phẩm là gì (`wallet/`).

**Việc, dù đã có trong bản thiết kế Giai đoạn 2 (mục 6b-11 của spec
2026-07-03), thực tế **chưa viết code**:

- Strategy `metered` riêng — hiện `credit` đang gánh luôn vai trò này
  (không sai, nhưng chưa có `endpoint_rates` để 1 request khác nhau tốn
  units khác nhau).
- `ScrapeCreatorsAdapter` riêng — `adapters/factory.py:14-15` vẫn map cả
  `topproxy` lẫn `scrapecreators` về chung `RealApiAdapter`.
- `provider.config.capabilities` + `endpoint_map` — chưa tồn tại field nào
  trong `Provider.config` cho việc này.
- Golden contract test cho adapter mới.

**Việc chưa từng được thiết kế ở đâu cả (đây là khoảng trống thật sự, và
là trọng tâm câu hỏi của mày):**

1. `Provider` là tài nguyên **100% admin sở hữu, toàn nền tảng**
   (`providers/router.py` mọi endpoint `require_role("admin")`). Không có
   cột `seller_id`. Seller **không có cách nào** tự khai `base_url`/`api_key`
   backend thật của họ — chỉ admin nhập tay qua `/admin/providers`.
2. **Không có gateway/proxy thật.** `RealApiAdapter.provision()` chỉ gọi
   provider **một lần lúc tạo đơn** để lấy 1 credential/resource rồi thôi.
   Sau đó buyer cầm credential đó gọi thẳng vào provider thật — nền tảng
   đứng ngoài. Endpoint `POST /internal/usage/charge`
   (`usage/router.py:25-36`) tự nó ghi chú "chỗ để gateway thật cắm vào sau"
   — **chưa ai xây cái gateway đó**.
3. Do (1)+(2), mô hình "buyer không biết seller thật, gọi API xuyên qua
   mình" **chỉ đúng một nửa**: đúng với 2 provider admin tự curate
   (`topproxy`, `scrapecreators`) ở bước *cấp phát ban đầu*; sai hoàn toàn
   với ý "seller tự cắm backend của họ vào" và sai với ý "mọi request sau
   đó đều qua mình" (ScraperAPI thật sự tính tiền theo *từng lần gọi*, ở
   đây mới chỉ tính tiền theo *gói mua trước*).

Kết luận: khung sườn generic (pricing archetype, adapter contract,
mã hoá, compat matrix, usage ledger) **đã đúng hướng và tái dùng được
nguyên vẹn** — không cần đập đi làm lại. Cái thiếu là 2 khối mới: **(A)
seller tự đăng ký provider của họ** và **(B) gateway proxy thật cho
per-request billing**. Đây là nội dung Giai đoạn 3 dưới đây.

## Nguyên tắc "generic hoá" — tại sao platform không cần biết nghiệp vụ seller

Đây là câu trả lời trực tiếp cho phần khó nhất của câu hỏi. Ba lớp tách
biệt, mỗi lớp chỉ nói chuyện với lớp kế qua một **contract cố định**, chưa
bao giờ đọc "ý nghĩa nghiệp vụ" của lớp kia:

```
[Buyer]  <-- tiền + quyền dùng -->  [Platform]  <-- contract cố định -->  [Seller backend]
              (archetype giá,                      (adapter interface,
               ví/escrow, quota)                     capability + config data)
```

1. **Tiền**: mọi sản phẩm, bất kể bán gì, quy về đúng 1 trong 4 archetype
   đã có (`fixed` một lần, `config` theo thời hạn/thuộc tính, `credit` mua
   gói dùng dần, `task` theo số job). Platform chỉ cần biết "đây là
   archetype nào" để tính ra một con số VND — không cần biết proxy dân cư
   khác proxy datacenter ở điểm kỹ thuật nào. Khác biệt nghiệp vụ nằm hết
   trong `pricing_params` (dữ liệu do seller nhập), không nằm trong code.
   → **Không thêm strategy mới theo từng loại seller** (đã chốt ở spec
   2026-07-03 mục 6b.6, tái khẳng định ở đây).
2. **Fulfillment**: mọi seller backend, bất kể họ code bằng gì, chỉ cần trả
   lời đúng 4 method của `ProviderAdapter` (`provision/check_health/
   get_usage/revoke`) hoặc, với gateway mới, thêm 1 method thứ 5
   `forward_request()` (mục 3 dưới). Platform gọi contract, không gọi
   nghiệp vụ. Khác biệt provider nằm trong `provider.config` (data), không
   nằm trong code adapter — **nguyên tắc "capability khai báo trong
   config"** (đã viết ở spec cũ mục 6b.3, giờ mới thật sự cần dùng).
3. **Xác nhận "hoạt động đúng" mà không đọc code seller**: dùng **golden
   contract test** (đã đề xuất, chưa viết) — một bộ test cố định platform
   tự chạy nhắm vào endpoint seller khai báo (health check, 1 lệnh
   provision thử, 1 lệnh forward thử). Seller pass bộ test này thì được
   duyệt, seller không cần tiết lộ business logic, platform không cần đọc
   hiểu nó — y hệt cách một API marketplace (RapidAPI, AWS Marketplace)
   duyệt nhà cung cấp: kiểm tra **hành vi qua contract**, không audit code.

## Kiến trúc Giai đoạn 3

### 1. Seller tự đăng ký provider của họ (self-service connector)

**Model** — mở rộng `Provider` (không tạo bảng song song, để tái dùng
100% adapter/compat/health/quality_score/call_log sẵn có):

- `providers.seller_id: int | null` (FK → `accounts.id`). `null` = provider
  do admin quản (như hiện tại, `topproxy`/`scrapecreators`...). Có giá trị
  = seller tự đăng ký, chỉ seller đó (và admin) thấy/sửa được.
- `providers.review_status: pending_review | approved | rejected | disabled`
  (mặc định `pending_review` khi seller tạo; admin-managed provider vẫn
  `approved` ngay như cũ để không phá hành vi hiện tại).
- `providers.config.capabilities: list[str]` — ví dụ
  `["proxy", "endpoint", "task"]` — dùng để lọc provider hợp lệ khi gắn vào
  product theo `service_type`, seller không tự nhận capability không đúng
  thật (validate được phần nào qua contract test, mục 3).

**Endpoint mới** (`marketplace-svc/src/providers/` mở rộng, gate theo
`require_min_seller_tier` giống `seller_api_keys`, không mở đại trà cho
seller mới):

```
POST   /seller/providers            tạo provider của chính mình (pending_review)
GET    /seller/providers            list provider của mình
PUT    /seller/providers/{id}       sửa (chỉ khi review_status != approved,
                                     sửa provider đã duyệt → về pending_review lại)
POST   /seller/providers/{id}/test  chạy golden contract test (tự phục vụ,
                                     seller thấy kết quả trước khi nộp admin duyệt)
```

`GET /providers`, `PUT /admin/providers/{id}` (đổi `review_status`), và
`POST /admin/providers/{id}/test` **giữ nguyên** — admin dùng lại đúng nút
"Test kết nối / Test cấp phát" đã có trên `/admin/providers` để duyệt,
chỉ thêm hiển thị `seller_id` + badge trạng thái duyệt. **Đây là chỗ trả
lời "quản lý được mà không cần biết nghiệp vụ"**: admin bấm nút test có
sẵn, xanh thì duyệt, đỏ thì từ chối kèm log lỗi — không cần đọc code hay
hiểu seller bán gì.

Adapter mà seller được phép chọn khi tự đăng ký: **giới hạn** còn
`seller_gateway` và `seller_task_webhook` (mục 2-3) — **không** cho seller
tự nhận `mock/seller_pool/manual` (những cái đó gắn với luồng nội bộ nền
tảng, không phải backend ngoài).

### 2. Gateway/Proxy — trái tim của "mình đứng giữa gọi qua mình"

Đây là phần **hoàn toàn mới**, không có tiền lệ trong code hiện tại ngoài
chỗ chừa sẵn ở `/internal/usage/charge`.

**Contract mới**, thêm vào `adapters/base.py` bên cạnh
`ProviderAdapter` (không sửa 4 method cũ — adapter nào không hỗ trợ
per-request cứ không implement, gateway router kiểm tra
`hasattr`/adapter riêng):

```python
class GatewayAdapter(ProviderAdapter):
    async def forward_request(
        self, order: Order, endpoint: str, method: str,
        params: dict, body: bytes | None,
    ) -> GatewayResponse:  # status_code, headers (whitelist), body
        ...
```

**`SellerGatewayAdapter(GatewayAdapter)`** (`adapters/seller_gateway.py`,
mới): map `endpoint` (tên trung lập, vd `"search"`) qua
`provider.config.endpoint_map` (vd `{"search": "/v2/search"}`) thành path
thật của seller, gọi `httpx` tới `provider.config.base_url + path`, tiêm
credential đã decrypt (tái dùng y nguyên cơ chế của `RealApiAdapter`:
retry/backoff, `ProviderCallLog` không lưu body), trả response nguyên văn
(trừ header nhạy cảm) về cho router.

**Router buyer-facing** (`marketplace-svc/src/gateway/router.py`, mới):

```
ANY /gw/{order_key}/{endpoint:path}
```

- `order_key` = một token riêng phát cho buyer lúc `provision()` **thay
  vì trả credential thật của seller** — cụ thể: với product dùng
  `seller_gateway`, `provision()` không gọi seller lúc mua (giống thiết kế
  Endpoint ở Giai đoạn 2 cũ: "cấp API key nội bộ, không gọi provider lúc
  mua"), chỉ sinh 1 `order_key` (random, lưu hash giống `SellerApiKey`) và
  trả cho buyer. **Buyer không bao giờ thấy `base_url`/`api_key` thật của
  seller** — đúng yêu cầu gốc.
- Router: resolve `order_key` → `order` → `product.provider_id` →
  `SellerGatewayAdapter`. Check `OrderBalance` còn quota
  (`usage.charge_usage` **trước** khi forward, kiểu pre-auth — nếu seller
  backend lỗi thì `refund` lại unit đó, không charge oan). Forward, nhận
  response, trả buyer. Ghi `UsageRecord` với `status=ok/rejected/error`.
- Rate limit + circuit breaker mức provider: tái dùng `ProviderHealth`/
  `quality_score`/`health_check_job` đã có — tỉ lệ lỗi cao tự động
  `is_active=False`, fallback chain (`fallback_provider_id`) đã sẵn có
  chạy luôn cho gateway, không cần code mới.

**Vì sao đây trả lời được "mở rộng cho nhiều loại sản phẩm"**: gateway
router hoàn toàn không biết `endpoint` nghĩa là gì (search? scrape? proxy
session?) — nó chỉ là string tra trong `endpoint_map`. Thêm loại dịch vụ
mới = seller khai thêm entry trong `endpoint_map` + `pricing_params.
endpoint_rates` (đã thiết kế ở spec cũ mục 7), không sửa 1 dòng code
router/adapter nào.

### 3. Task đa dạng — webhook thay vì chỉ ManualAdapter

`ManualAdapter` hiện tại ép mọi `task` strategy về "người thật xử lý qua
`/admin/tasks`". Muốn seller tự động hoá xử lý nhiều loại task (dịch,
scraping job, seeding, review...) mà platform không cần hiểu từng loại:

**`SellerTaskWebhookAdapter(ProviderAdapter)`** (`adapters/seller_task_
webhook.py`, mới, `adapter_type = "seller_task_webhook"`, compat thêm vào
matrix: `{"task"}`):

- `provision()`: `POST {base_url}/tasks` với `{order_id, task_type,
  payload: user_config}` — `task_type` là string tự do seller định nghĩa
  (platform không validate ý nghĩa, chỉ validate seller đã khai nó tồn
  tại trong `provider.config.task_types` để hiện dropdown ở form mua).
  Trả `metadata["async_fulfillment"] = True` (tái dùng đúng cờ đã có,
  `orders/service.py` xử lý y hệt luồng `ManualAdapter` hiện tại — không
  sửa order lifecycle).
- Seller backend xử lý xong tự gọi callback:
  `POST /webhooks/providers/{provider_id}/tasks/{external_task_id}`
  (`marketplace-svc/src/gateway/webhooks.py`, mới), ký HMAC bằng
  `provider.config.webhook_secret` (per-provider, sinh lúc đăng ký, không
  dùng chung 1 secret cho mọi seller — tránh 1 seller giả mạo callback của
  seller khác). Payload `{status: completed|failed, result_data}`.
- Webhook handler map `external_task_id` → `ServiceTask` (thêm cột
  `service_tasks.external_task_id: str | null` + `provider_id`) → gọi lại
  **nguyên hàm `tasks/service.py::update_task`** đã có (đồng bộ order y
  hệt luồng admin tay hiện nay) — 0 code lifecycle mới, chỉ thêm 1 lối
  vào khác cho cùng hàm.
- Không có webhook (seller không muốn tự động hoá) → vẫn rơi về
  `ManualAdapter` như cũ, admin xử lý tay qua `/admin/tasks`. Hai adapter
  song song, seller/admin chọn theo nhu cầu.

### 4. Compat matrix + capability — cập nhật

```python
ADAPTER_STRATEGY_COMPAT = {
    "mock": None,
    "seller_pool": {"fixed"},
    "manual": {"task"},
    "seller_task_webhook": {"task"},          # mới
    "topproxy": {"config", "credit"},
    "scrapecreators": {"config", "credit"},
    "seller_gateway": {"credit"},             # mới — per-request luôn đi kèm quota/gói
}
```

`credit` strategy giữ vai trò "metered" luôn (như hiện trạng thực tế —
xem mục Đối chiếu hiện trạng), **không** đổi tên sang `metered` để tránh
migrate dữ liệu — chỉ bổ sung `pricing_params.endpoint_rates` (optional,
mặc định 1 unit/request nếu seller không khai) vào `CreditPricing` đã có.

### 5. Admin UI — thay đổi tối thiểu

- `/admin/providers`: thêm filter "Chủ sở hữu: Nền tảng / Seller", cột
  `seller_id` (tên seller) + badge `review_status`; nút Duyệt/Từ chối
  cạnh nút Test đã có (chỉ hiện khi `review_status = pending_review`).
  Không đổi layout tab General/API Connection/Products.
- `/seller/(dashboard)/`: trang mới `providers/page.tsx` — danh sách
  provider của tôi + form đăng ký (adapter_type giới hạn 2 loại mới) +
  nút "Test kết nối" tự phục vụ trước khi nộp duyệt. Operations tab của
  product (`products/[id]/page.tsx`) — phần "Nhà cung cấp" hiện admin-only
  (line 579 hiện tại) mở thêm: seller được chọn trong danh sách provider
  **của chính mình đã approved** (không thấy provider seller khác/không
  thấy provider platform trừ khi admin gán sẵn).

## Bảo mật & vận hành cần khoá chặt trước khi build

1. **Webhook secret theo từng provider**, không dùng `verify_internal_key`
   dùng chung — seller B không được giả callback thay seller A.
2. **`order_key` (gateway) là secret riêng, không phải JWT buyer** — thu
   hồi được độc lập (buyer đổi/seller đình chỉ) không ảnh hưởng phiên đăng
   nhập buyer; hash-at-rest như `SellerApiKey`.
3. **Response từ seller backend không được trust mù** — whitelist header
   forward về buyer (không forward `Set-Cookie`/header nội bộ của seller),
   cap kích thước response, timeout ngắn (seller backend chậm không được
   treo request buyer vô hạn).
4. **Pre-auth quota rồi refund nếu lỗi**, không auth sau — seller backend
   không đáng tin 100% (chưa duyệt kỹ như provider admin-curate), tính
   tiền trước khi gọi tránh buyer bị forward miễn phí nếu có bug.
5. **`ProviderCallLog` giữ nguyên nguyên tắc không log response body** —
   quan trọng hơn với gateway vì response *là* dữ liệu buyer trả tiền mua,
   không phải chỉ 1 credential như trước.
6. Mô hình tiền vẫn **prepaid** (mua gói trước, trừ dần) — **chưa** làm
   postpaid/invoice theo chu kỳ. Giữ vậy vì seller-owned backend rủi ro
   cao hơn provider platform tự curate; prepaid giới hạn thiệt hại tối đa
   = giá trị gói buyer đã mua, không phát sinh công nợ ngoài tầm kiểm soát.

## Ngoài phạm vi (Giai đoạn 3)

- Postpaid/billing theo chu kỳ (invoice cuối tháng) — cần phase riêng nếu
  sau này có seller đủ tin cậy.
- Đối soát tự động usage nội bộ ↔ seller (chỉ log lệch, như Giai đoạn 2
  cũ đã ngoài phạm vi).
- Giai đoạn 2 cũ (`metered` strategy tách riêng, `ScrapeCreatorsAdapter`
  thật, Cloud Environment renewal) — vẫn còn treo, độc lập với Giai đoạn 3,
  có thể làm trước/sau/song song tuỳ ưu tiên.
- Seller tự chọn `mock/seller_pool/manual` cho provider của mình — không
  cần, những adapter đó vốn đã là luồng nội bộ nền tảng.

## Câu hỏi cần chốt trước khi viết implementation plan

1. ~~Golden contract test cho seller tự đăng ký: chặn cứng hay chỉ cảnh
   báo?~~ **Đã chốt: chỉ cảnh báo** — seller tự chịu trách nhiệm, admin
   duyệt tay (nút Test có sẵn ở `/admin/providers`) là chốt chặn cuối.
   Chưa cần code gì thêm cho quyết định này — mục 1 (seller tự đăng ký
   provider qua UI riêng) vẫn chưa triển khai, xem "Ngoài phạm vi của lần
   triển khai này" bên dưới.
2. `seller_gateway`/`seller_task_webhook` có giới hạn seller tier tối
   thiểu không khi mục 1 (seller tự đăng ký) được làm? Chưa cần trả lời
   ngay — hiện tại provider (kể cả 2 adapter_type mới) vẫn 100% admin tạo
   qua `/admin/providers`, seller không tự đăng ký được gì cả.
3. ~~Ưu tiên Giai đoạn 3 hay hoàn thiện Giai đoạn 2 cũ trước?~~ **Đã chốt:
   Giai đoạn 3 trước** — phần gateway + task webhook (mục 2, 3) đã có code
   chạy được, xem bên dưới.

## Trạng thái triển khai (2026-07-21)

Đã viết và test (`pytest tests/test_gateway.py` — 9/9 pass, cộng
`uv run pytest tests/ -q` toàn bộ suite pass) phần **mục 2 (gateway) +
mục 3 (task webhook)** của thiết kế trên. Mục 1 (seller tự đăng ký
provider qua UI riêng, admin duyệt hàng chờ pending_review) **chưa làm** —
provider vẫn 100% do admin tạo qua `/admin/providers` như hiện trạng cũ,
chỉ khác là giờ admin có thể chọn 2 `adapter_type` mới trỏ vào backend của
seller thay vì backend admin tự quản.

**File đã thêm/sửa:**

- `alembic/versions/y1a2b3c4d5e6_gateway_key_and_task_webhook.py` —
  `orders.gateway_key_hash/prefix`, `service_tasks.external_task_id/provider_id`.
- `src/adapters/real_api.py` — thêm method `.call()` (per-request forward,
  dùng chung retry/idempotency/`ProviderCallLog` với `.provision()`, chỉ
  khác idempotency key sinh mới mỗi lần gọi thay vì cố định theo order).
- `src/adapters/seller_task_webhook.py` (mới) — `SellerTaskWebhookAdapter`,
  kế thừa `RealApiAdapter` để tái dùng HTTP/retry/log, ghi đè
  `provision/get_usage/revoke` để tạo `ServiceTask` (giống `ManualAdapter`)
  thay vì gọi seller mỗi request.
- `src/adapters/factory.py`, `src/adapters/compatibility.py` — đăng ký
  `seller_gateway` (→ `RealApiAdapter`) và `seller_task_webhook` (→
  `SellerTaskWebhookAdapter`), compat `seller_gateway: {credit}`,
  `seller_task_webhook: {task}`.
- `src/gateway/` (mới) — `service.py` (mint/resolve gateway key, hash tại
  chỗ như `seller_api_keys`), `router.py`:
  `ANY /gw/{gateway_key}/{endpoint}` (pre-charge quota qua
  `usage.charge_usage`, forward qua `adapter.call()`, refund nếu forward
  lỗi — xem `usage/service.py::refund_usage`, mới) và
  `POST /webhooks/providers/{provider_id}/tasks/{external_task_id}`
  (HMAC-verify bằng `provider.config.webhook_secret`, gọi thẳng
  `tasks.service.update_task()` có sẵn — 0 logic lifecycle mới).
- `src/orders/service.py::_apply_provision_result` — khi strategy=credit
  và adapter là `seller_gateway`, mint gateway key thay vì trả
  `provision_result.data` (dữ liệu thật từ seller) cho buyer.
- `src/security/crypto.py` — `webhook_secret` vào `SENSITIVE_CONFIG_KEYS`
  (mã hoá tại chỗ như `api_key`).
- `scripts/mock_seller.py` (mới) — mock seller backend độc lập (FastAPI
  riêng, port 9100 mặc định), implement đúng contract cả 2 phía: provision/
  health/usage/revoke (RealApiAdapter), `/v1/{action}` pass-through
  (gateway), `/v1/tasks` + webhook callback (task). Log ra console mọi
  request nhận được — chạy song song với marketplace-svc để thấy chuỗi gọi
  buyer → gateway → mock seller → webhook ngược lại, log cả 2 phía.
- Frontend: `lib/pricing-config.ts` (`ADAPTER_INFO`),
  `app/admin/providers/page.tsx` (`ADAPTER_OPTIONS`/`ADAPTER_DESCRIPTIONS`,
  form field cho `seller_gateway`/`seller_task_webhook` — api_key/base_url
  [+ webhook_secret cho webhook]). `/admin/products/[id]` không cần sửa —
  đã đọc compat matrix từ backend (`GET /admin/adapter-compatibility`),
  không hardcode danh sách adapter phía client.

**Cách chạy thử end-to-end:**

```
# Terminal 1 — mock seller (giả lập backend thật của một seller)
cd marketplace-svc && uv run uvicorn scripts.mock_seller:app --port 9100

# Terminal 2 — marketplace-svc như bình thường
cd marketplace-svc && uv run uvicorn src.main:app --port 8001 --reload
```

Sau đó ở `/admin/providers`: tạo provider `adapter_type=seller_gateway`,
`config={base_url: "http://localhost:9100", api_key: "mock-seller-secret"}`
— gắn vào một sản phẩm `pricing_strategy=credit`; mua thử → `delivered_data`
là "Gateway key: gwk_live_...", KHÔNG phải data thật từ mock seller. Gọi
`POST {backend_base_url}/gw/{gateway_key}/search?q=hello` — response tới
từ mock seller (thấy log ở cả 2 terminal), quota trừ dần theo gói đã mua.

Tương tự với `adapter_type=seller_task_webhook` + `webhook_secret` khớp
`MOCK_SELLER_WEBHOOK_SECRET` (mặc định `mock-webhook-secret`), sản phẩm
`pricing_strategy=task`: mua → order `processing`, mock seller tự "xử lý"
sau 2-5s rồi gọi ngược webhook → task `completed` → order `delivered`.

**Cố ý chưa làm trong lần này** (khớp "Ngoài phạm vi" đã liệt kê ở trên):

- Mục 1 (seller tự đăng ký provider, `providers.seller_id`/`review_status`,
  UI `/seller/.../providers`) — provider vẫn 100% admin tạo.

## Sửa sau code review (2026-07-21, cùng ngày)

Review độc lập tìm 5 vấn đề trên bản đầu (2 được đánh dấu chặn merge). Tất
cả đã kiểm chứng đúng với code thật và xử lý ngay — không có vấn đề nào bị
bỏ qua, kể cả 3 điểm "P2":

1. **Webhook chấp nhận callback không chữ ký khi provider thiếu
   `webhook_secret`** — sửa 2 lớp: (a) `providers/service.py` giờ **bắt
   buộc** `config.webhook_secret` ngay lúc tạo/sửa provider
   `adapter_type=seller_task_webhook` (chặn cả việc đổi sang adapter này
   thiếu secret, lẫn việc xoá secret khỏi provider đã có), (b)
   `gateway/router.py::provider_task_webhook` vẫn tự kiểm tra độc lập —
   thiếu secret thì fail closed (401), không còn nhánh "bỏ qua xác thực"
   nào. Test: `TestProviderWebhookSecretEnforced` (tạo/sửa thiếu secret bị
   400), `test_webhook_fails_closed_when_provider_has_no_secret` (giả lập
   provider cũ lọt lưới, webhook vẫn từ chối).
2. **Submit task thất bại toàn bộ → order kẹt `processing` vĩnh viễn** —
   `SellerTaskWebhookAdapter.provision()` giờ trả `success=False` khi
   `submitted == 0` (không có task nào lấy được `external_task_id`, tức
   không webhook nào có thể tới) — order chạy qua nhánh refund+cancel bình
   thường thay vì treo. Fail một phần vẫn an toàn như cũ (task fail ngay từ
   đầu đã terminal, `_sync_order_status` tính đúng khi task còn lại xong).
   Test: `test_all_submissions_failing_cancels_and_refunds_the_order`.
3. **Gateway resolve provider từ `product.provider_id` sống, không snapshot
   theo order** — thêm cột `orders.provider_id` (snapshot provider ĐÃ
   fulfill order đó, set trong `_apply_provision_result`, ưu tiên
   `adapter.provider_id` thật sau fallback thay vì `product.provider_id`
   trước khi gọi). `gateway/router.py` giờ resolve qua `order.provider_id`
   — admin đổi/tháo provider của product sau khi bán không còn redirect
   ngầm các gateway key đã bán. Test:
   `test_reassigning_the_product_provider_does_not_redirect_an_already_sold_key`.
4. **Chưa đúng tuyên bố "generic" của spec** (`endpoint_map`,
   `endpoint_rates`, provision Endpoint không gọi seller lúc mua) — **thừa
   nhận, chưa sửa**: `gateway/router.py` vẫn hardcode `/v1/{endpoint}` +
   1 unit/lần gọi; `seller_gateway` vẫn gọi `/provision` một lần lúc mua
   (không chỉ mint key nội bộ như spec Giai đoạn 2 hình dung cho nhóm
   Endpoint). Đã sửa câu docstring trong router để không còn nói sai là đã
   generic — mục `endpoint_map`/`endpoint_rates` dời sang mục "Ngoài phạm
   vi" một cách tường minh, không phải bug im lặng.
5. **Thiếu giới hạn request/response + endpoint không được validate** —
   sửa phần rẻ và quan trọng nhất: (a) `endpoint` phải khớp
   `^[A-Za-z0-9_-]{1,64}$` — chặn `..`/nhiều segment/path traversal ra
   ngoài `/v1/{action}` (vd buyer dùng gateway key gọi thẳng
   `/provision`/`/health` của seller); (b) request body cap 256KB (413 nếu
   vượt); (c) response cap 2MB — vượt thì hoàn quota + 502 thay vì forward
   nguyên khối cho buyer. **Chưa làm**: streaming thật (response vẫn buffer
   hết vào RAM trước khi so kích thước — cap chỉ chặn forward tiếp, không
   chặn seller làm marketplace-svc tốn RAM), và rate limit theo gateway
   key/provider (repo chưa có hạ tầng rate-limit nào để tái dùng — cần
   Redis-backed counter, việc riêng). Test:
   `test_path_traversal_endpoint_is_rejected`,
   `test_oversized_request_body_is_rejected`.

Đồng thời sửa luôn 1 gap nhỏ review không nêu nhưng cùng loại:
`refund_usage()` giờ ghi `UsageRecordStatus.refunded` (thêm bằng migration
`z1a2b3c4d5e6`, cùng cột `orders.provider_id` ở trên) — trước đó chỉ trừ
ngược `units_used` mà không để lại dấu vết, khiến `usage_records` không
khớp balance thật sau một lần refund.

**Chạy lại xác nhận**: `pytest tests/test_gateway.py -q` → 18/18 pass (9
cũ + 9 mới từ review), `pytest tests/ -q` toàn bộ suite pass.

## Seller self-service + gateway generic + vận hành (2026-07-22)

Làm nốt 3 phần còn thiếu mà lần trước cố ý để lại: **(1)** seller tự đăng
ký backend (Phần A, deferred từ đầu), **(2)** gateway thật sự generic
(`endpoint_map`/`endpoint_rates`, không hardcode `/v1/{endpoint}`/1-unit
nữa), **(3)** vận hành: rotate/revoke gateway key, rate limit, SLA sweep
cho task-webhook treo. `pytest tests/ -q` toàn bộ pass (PostgreSQL +
Redis thật, không mock hạ tầng).

### 1. Seller tự đăng ký backend

- Migration `aa1a2b3c4d5e6` thêm `providers.seller_id`/`review_status`/
  `review_note`; migration `dc1a2b3c4d5e6` thêm `last_tested_at` và bản tóm
  tắt `last_test_result` đã loại response data/credential.
- Seller integration đi theo state thật:
  `draft → tested|test_failed → pending_review → approved|rejected`.
  `POST /seller/providers/{id}/submit` chỉ nhận `tested`; lưu credential
  không tự tạo việc cho admin. Seller chỉ được dùng
  `{seller_gateway, seller_task_webhook}` và vẫn bị ownership check.
- Tích hợp `approved` không cho seller sửa config tại chỗ. Seller tạo tích
  hợp mới, test, gửi duyệt rồi mới chuyển sản phẩm; nhờ vậy sản phẩm và
  gateway key đang chạy không bị trỏ sang credential chưa duyệt.
- `products/service.py::_validate_provider_assignment` (dùng chung cho cả
  admin lẫn seller path): chỉ provider `approved` mới gắn được; provider
  có `seller_id` chỉ gắn được vào **đúng sản phẩm của seller đó** — áp
  dụng kể cả khi ADMIN là người gắn (admin không tự ý gắn backend riêng
  của seller A vào sản phẩm seller B).
- `PUT /seller/products/{id}/pricing` (schema `SellerPricingUpdate`) giờ
  nhận thêm `provider_id` — seller tự gắn được provider **của chính họ**
  đã duyệt, không gắn được provider dùng chung hay của seller khác (check
  riêng trong `update_seller_pricing`, không chỉ dựa vào
  `_validate_provider_assignment`).
- Router: `POST/GET /seller/providers`, `GET/PUT /seller/providers/{id}`,
  `POST /seller/providers/{id}/test|submit` (gate
  `require_min_seller_tier("trusted")`) + `POST /admin/providers/
  {id}/approve|reject`. Admin chỉ quyết định provider seller đã chủ động
  đưa vào `pending_review`.
- Frontend gọi khái niệm này là **Tích hợp API**, trình bày hai contract cụ
  thể (API quota hoặc task callback) và chuỗi hành động
  `Lưu bản nháp → Test contract → Gửi duyệt`. Trang tạo sản phẩm hỏi buyer
  nhận kho/API/task, tự map API→`credit+seller_gateway` và
  task→`task+seller_task_webhook`; seller không còn chọn tổ hợp kỹ thuật sai.
- Test: `tests/test_seller_self_service.py` (12 test) — tier gate, mặc
  định pending_review, chặn adapter_type sai, cô lập seller A/B (403),
  chặn gắn provider chưa duyệt/không phải của mình, **admin cũng bị chặn**
  gắn provider seller A vào sản phẩm seller B, sửa config rớt về
  pending_review, reject lưu note.

### 2. Gateway generic thật — endpoint_map + endpoint_rates

- Migration `ab1a2b3c4d5e6` — `order_balances.endpoint_rates`
  (JSONB)/`default_rate` — **chốt lúc giao hàng** từ `pricing_params`
  (giống nguyên tắc `units_total`), không đọc `pricing_params` sống của
  product sau này.
- `provider.config.endpoint_map: {"search": "/api/v2/search"}` — đọc SỐNG
  (giống `base_url`/`api_key`, không chốt — đây là chi tiết tích hợp của
  seller, không phải điều khoản buyer đã mua). Không cấu hình →
  fallback `/v1/{endpoint}` (hành vi cũ, không breaking). Có cấu hình mà
  endpoint không có trong map → 404 tường minh, không đoán.
- `usage/service.py::resolve_endpoint_units(balance, endpoint)` — tra
  `endpoint_rates`, fallback `default_rate`, fallback cuối = 1.
- **Bug tự bắt được lúc build**: ban đầu router đọc `OrderBalance` KHÔNG
  khoá riêng (để tính units) NGAY TRƯỚC KHI gọi `charge_usage()` (khoá
  `FOR UPDATE`) — tưởng vô hại nhưng phá mất tính đúng của khoá, 2 request
  đồng thời trên 1 unit cùng thắng (bắt được nhờ test concurrency có sẵn
  từ vòng review trước). Sửa: `charge_usage(units=None, ...)` tự tính
  units từ balance **sau khi đã khoá**, gộp làm một lần đọc duy nhất —
  không tách riêng một lệnh đọc không khoá trước một lệnh `FOR UPDATE`
  trên cùng hàng trong cùng transaction, bài học ghi thẳng trong docstring.
- Test `TestGatewayGenericity` (4 test) — CHỨNG MINH bằng 1 backend giả thứ
  2 có path hoàn toàn khác `/v1/*` (`/api/v2/tiktok/profile-search`) chỉ
  qua `provider.config`, router/adapter không đổi 1 dòng; endpoint ngoài
  map bị từ chối không đoán; 2 endpoint tính giá khác nhau đúng theo
  `endpoint_rates` + `default_rate` cho endpoint không liệt kê.

### 3. Vận hành — rotate/revoke key, rate limit, SLA sweep

- `src/rate_limit.py` (mới) — Redis fixed-window (`INCR`+`EXPIRE`), **fail
  open** nếu Redis lỗi (rate limit là abuse-guard best-effort, không phải
  boundary bảo mật — Redis sập không nên kéo sập cả gateway). Áp vào
  `gateway_forward`: 60 request/60s theo từng gateway key (hằng số, chưa
  cấu hình theo provider).
- `POST /orders/{id}/gateway-key/rotate` (buyer, chủ đơn) — key cũ ngừng
  hoạt động ngay (lookup theo hash, ghi đè là đủ, không cần danh sách thu
  hồi riêng). `POST /admin/orders/{id}/gateway-key/revoke` (admin,
  KHÔNG cấp lại — dùng khi có abuse, khác rotate là hành động thường
  ngày của buyer).
- `scheduler.py::task_webhook_sla_job` (job mới, 30 phút/lần, hằng số
  `TASK_WEBHOOK_SLA_SECONDS = 48h`) — order `seller_task_webhook` kẹt
  `processing` quá hạn: đẩy các task còn pending qua ĐÚNG
  `update_task()`/`_sync_order_status()` mà một webhook thật sẽ gọi (đánh
  `failed` kèm lý do timeout) — tái dùng nguyên logic refund toàn phần/một
  phần đã có, không viết logic hoàn tiền riêng. Không đụng tới
  `ManualAdapter` (vẫn không có timeout, như từ trước — admin tự nhận ra
  qua `/admin/tasks`).
- **Lỗi tự gây ra rồi tự bắt lúc build**: chèn job mới vào giữa file làm
  orphan một dòng `logger.info(...)` thuộc `provider_scoring_job`, gây
  `NameError` khi chạy — bắt được ngay nhờ chạy test job mới, không lọt
  qua compile check (compile check không phát hiện được vì lỗi chỉ nổ ra
  lúc RUNTIME, không phải syntax).
- Test: `TestGatewayKeyLifecycle` (4), `TestGatewayRateLimit` (1),
  `TestTaskWebhookSlaSweep` (3) trong `tests/test_gateway.py`.

### Vẫn còn thiếu (thành thật, không phóng đại)

- Rate limit hằng số cứng (60/60s mọi provider) — chưa cấu hình được theo
  từng provider/gói.
- Response gateway vẫn buffer hết vào RAM trước khi so kích thước — chưa
  streaming thật.
- `task_webhook_sla_job` timeout cố định 48h — chưa cấu hình theo sản
  phẩm/provider.
- Chưa test 3 backend THẬT chạy riêng biệt (chỉ mock qua monkeypatch) —
  `scripts/mock_seller.py` vẫn là 1 process duy nhất đóng nhiều vai; sống
  còn 1 lần curl smoke-test từ trước, chưa mở rộng thành 3 process khác
  contract chạy song song.
