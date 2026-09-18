# igbm.net — Nghiên cứu API & phương án resell dưới seller nội bộ

Nguồn: https://igbm.net/document-api (tài khoản `thtm79`), probe trực tiếp API ngày 2026-09-17.
Mục tiêu: bán lại hàng (chủ yếu tài khoản MXH: Facebook/TikTok/Gmail/Telegram/Twitter…,
một ít proxy/key phần mềm) của igbm.net trên sàn, dưới **một seller nội bộ** do mình
quản lý, buyer không thấy nguồn hàng.

## 1. Mô hình chung (đã verify bằng key thật)

- **Prepaid bằng số dư VND**: nạp tiền tay trên web igbm, mọi lệnh mua trừ số dư.
  Giá niêm yết API là VND (`"price": "9800"`). Hiện số dư tài khoản = **0.00** → chưa mua
  thử được, phải nạp trước khi test end-to-end.
- **Auth**: `api_key` truyền dưới dạng **query/form param** (không Bearer). GET/POST đều được.
  Có mục "IP Whitelist" (để trống = mọi IP) và nút **đổi key** trên trang document-api.
- **Envelope** JSON: `{"status": "success"|"error", "msg": "<tiếng Việt>", ...}`.
  Lỗi KHÔNG có mã số — chỉ có `msg` text, phải match theo chuỗi:

  | Tình huống | Response thật |
  |---|---|
  | Sai/thiếu key (buy) | `{"status":"error","msg":"Vui lòng đăng nhập"}` |
  | Sai key (profile) | `{"status":"error","msg":"API Key không hợp lệ"}` |
  | Không đủ tiền | `{"status":"error","msg":"Số dư không đủ, vui lòng nạp thêm"}` |
  | Hết hàng | `{"status":"error","msg":"Số lượng còn lại trong hệ thống không đủ"}` |
  | SKU không tồn tại (buy) | `Sản phẩm không tồn tại trong hệ thống`; id không phải số: `ID sản phẩm không hợp lệ!` |
  | amount ≤ 0 | `Số lượng không hợp lệ!` |
  | Thiếu/sai `action` | `The Request Not Found` / `Request does not exist` |
  | Order không tồn tại | `{"status":"error","msg":"Đơn hàng không tồn tại"}` |
  | Product id không có (product.php) | `{"status":"success","product":[]}` (status vẫn success!) |

  Thứ tự kiểm tra khi mua: key → action → id → amount → **số dư → tồn kho** (số dư check trước tồn).
  Mua thật 1 unit SKU 145883 (2.800đ) ngày 17/09: phản hồi **0,66 s**, số dư 10.000 → 7.200, `data` 1 dòng
  `uid|pass|cookie|token|2fa|mail|user-agent|Token Live||` (dài hơn `description` ghi — giao nguyên chuỗi).

- **Không có Idempotency-Key, không webhook.** Mua = POST một lần, retry mù = mua trùng.
- Sau Cloudflare, `cache-control: no-store`, set `PHPSESSID` (bỏ qua). Không thấy header rate-limit;
  `products.php` trả **~1.5 MB** JSON một cục → không được gọi thường xuyên.

## 2. Endpoint

| Việc | Endpoint | Ghi chú |
|---|---|---|
| Số dư | `GET /api/profile.php?api_key=` | `data.money` (string, VND). **Có API xem số dư** — hơn TopProxy. |
| Toàn bộ catalog | `GET /api/products.php?api_key=` | `categories[]` phẳng (227 mục, `parent_id` tạo cây 2 tầng), mỗi mục có `products[]`. 1.5 MB. |
| Chi tiết 1 sản phẩm | `GET /api/product.php?api_key=&product=<id>` | ~2 KB, trả `product[0]` với `amount` **realtime** — dùng để check tồn kho ngay trước khi mua. |
| Chi tiết đơn | `GET /api/order.php?api_key=&order=<trans_id>` | Chưa verify được shape (chưa có đơn nào). Giả định `order` = `trans_id` từ response mua. |
| Mua | `POST /api/buy_product` form: `action=buyProduct`, `id`, `amount`, `coupon?`, `api_key` | Thành công: `{"status":"success","trans_id":"JF465f…","data":["<dòng 1>","<dòng 2>",…]}` — `data` là mảng chuỗi, mỗi phần tử 1 tài khoản, định dạng theo `description` của sản phẩm (vd `uid\|pass\|2fa\|mail\|cookie`). |

Shape sản phẩm (cả trong `products.php` và `product.php`):

```json
{"id":"137151","name":"H4. Clone Ukraine | Có Avatar + Cover | ... | FULL 2FA",
 "price":"9800","amount":211,"description":"/","flag":null,"min":"1","max":"1000000"}
```

- `amount` = tồn kho hiện tại (0 = hết). `min`/`max` = số lượng mỗi lần mua.
- `description` lẽ ra là định dạng dòng giao hàng nhưng ~75% là rác (`.`, `./`, `,.`) →
  **không parse được định dạng**, chỉ giao nguyên chuỗi cho buyer.
- Kiểu dữ liệu không nhất quán: `products.php` trả string (`"id":"137151"`, `"price":"9800"`),
  `product.php` trả int. Parser phải `int()` mọi thứ.

## 3. Catalog snapshot (2026-09-17)

3.034 sản phẩm, **1.264 còn hàng**, 20 nhóm gốc:

| Nhóm gốc | SP | Còn hàng | Nhận xét |
|---|---|---|---|
| Facebook | 1.399 | 600 | Clone/via theo quốc gia, BM, ads. Nhiều nhất, giá 5k–300k. |
| Facebook Các Loại | 617 | 186 | 124 danh mục con theo quốc gia. |
| TikTok | 367 | 170 | |
| Bm Ads Facebook | 131 | 21 | |
| GmaiL Hotmail Outlook | 129 | 58 | |
| Twitter | 75 | 60 | |
| Clone Instagram + Threads | 54 | 22 | |
| Telegram | 50 | 34 | |
| CapCut Pro / Canva / Steam / Kaspersky / Youtube | ~76 | ~57 | Key phần mềm/subscription. |
| Proxy - IP - VPN | 31 | 21 | Trùng mảng TopProxy/DProxy đang có. |
| SUPER SALE, Discord, Google Ads, Xu Trao Đổi… | còn lại | | |

Ghi chú vận hành đọc từ tên/mô tả: hàng có điều kiện bảo hành riêng theo SP
("Không bảo hành nếu nhảy location US/Japan", "Bao có nút xin tích trong 3 tiếng") →
phải copy sang `warranty_text` của SP mình, và dispute phải khớp điều kiện đó.

## 4. Mình đáp ứng được gì với hạ tầng hiện có

Đã có sẵn, dùng lại nguyên:

| Nhu cầu | Đã có | Ở đâu |
|---|---|---|
| Seller nội bộ, hàng white-label | Pattern TopProxy: seller riêng, tên provider trung tính, `_PUBLIC_ADAPTER_ALIASES` che `adapter_type` | `scripts/seed_topproxy.py`, `src/pricing/router.py` |
| Product/variant/giá cố định × số lượng, volume tiers | `pricing_strategy="fixed"` | `src/pricing/fixed.py` |
| Adapter gọi HTTP, log `provider_call_logs`, api_key mã hoá at rest, config validate | `RealApiAdapter` + `AdapterSpec` registry | `src/adapters/real_api.py`, `registry.py` |
| Provision nền (commit `pending` → task → sweeper retry), refund tự động khi fail | `provisions_over_network=True` | `src/orders/service.py` |
| Hết tiền thượng nguồn → tắt provider + alert 1 dòng | `provider_out_of_credit` → `providers/credit.py` | có sẵn |
| Lỗi vận hành (sai key, đã trừ tiền không nhận hàng) → alert admin | `operational_error` | có sẵn |
| Health check định kỳ, tự tắt sau 3 lần fail | `health_check_job` | `scheduler.py` |
| Escrow, dispute, thay thế/hoàn tiền từng unit | `Resource.refund_amount_cap`, dispute flow | có sẵn |
| Giao nhiều dòng tài khoản một đơn | `delivered_data` = text nhiều dòng (giống seller_pool) | có sẵn |

**Chưa có / phải làm**:

1. **Adapter `igbm`** (mới) — mua theo `(igbm_product_id, quantity)`, map lỗi theo `msg`.
2. **Tồn kho ảo từ thượng nguồn.** Hiện `stock_state`/`max_quantity`/bộ lọc "còn hàng"
   của sản phẩm `fixed` đếm bảng `resources` (`products/service.py::_browse_price_columns`,
   `_public_stock`). SP igbm không có Resource nào → storefront báo **hết hàng** và bị lọc
   khỏi "còn hàng". Cần một nguồn tồn kho thứ hai.
3. **Mapping variant ↔ igbm product id + giá vốn.** `ProductVariant` không có cột config.
4. **Đồng bộ giá vốn/tồn kho định kỳ + cảnh báo margin âm** khi igbm tăng giá.
5. **Reconcile khi mua timeout** (không idempotency) — chưa có cách tra "đơn vừa mua" nếu
   không nhận được `trans_id`.

## 5. Thiết kế đề xuất

### 5.1 Dữ liệu: bảng `supplier_listings`

Một hàng = một variant của mình gắn với một SP igbm. Vừa là mapping, vừa là cache tồn kho/giá vốn:

```
supplier_listings
  id, provider_id FK, variant_id FK UNIQUE,
  external_product_id  (igbm id, string)
  external_name        (tên gốc — chỉ admin thấy)
  cost_price           (VND, từ igbm price, cập nhật theo sync)
  upstream_amount      (tồn kho igbm lúc sync)
  upstream_min, upstream_max
  synced_at, sync_error
```

- Không nhét vào `Product.pricing_params` vì `fixed` xây `variants` từ `ProductVariant` rows
  và JSON đó không index/join được cho stock.
- Tổng quát cho nhà cung cấp "kho ngoài" bất kỳ (sau này thêm nguồn thứ hai không phải làm lại).

### 5.2 Tồn kho: `AdapterSpec.external_stock = True`

- `_browse_price_columns` và `get_product` (stock_by_variant): với product có provider
  `external_stock`, `stock_count` = `LEAST(upstream_amount, upstream_max)` từ `supplier_listings`
  thay vì đếm Resource. Vẫn đi qua `_public_stock` → buyer chỉ thấy bucket in_stock/low/out.
- Seller inventory (`_available_stock_by_product`, low-stock) cùng nguồn — seller nội bộ thấy
  "còn 211" mà không cần biết đó là igbm.
- **Trước khi trừ ví** (`create_order_with_adapter`, sau quote): gọi `product.php` (~2 KB, nhanh)
  lấy `amount` + `price` realtime; nếu `amount < quantity` → 409 "không đủ hàng" trước khi tốn
  tiền; nếu `price > cost_price` đã cache → cập nhật cache và chặn nếu margin < ngưỡng
  (tránh bán lỗ trong lúc igbm vừa đổi giá). Ràng buộc `min ≤ quantity ≤ max` của igbm cũng check ở đây.

### 5.3 Adapter `IgbmAdapter` (kế thừa `RealApiAdapter`, pattern TopProxy)

- `provisions_over_network=True`, `provision_has_purchase_side_effect=True`.
- `config`: `base_url=https://igbm.net`, `api_key` (mã hoá), `min_margin_pct` (mặc định 20),
  `low_balance_vnd` (ngưỡng cảnh báo).
- `provision(order_id, user_config)`:
  1. Tra `supplier_listings` theo `variant_id`.
  2. `money_before = profile.php`.
  3. `POST /api/buy_product` **đúng một attempt** (`_call_once`, không auto-retry).
  4. `status=success` → `data` join `\n` = `delivered_data`; `resource_id = trans_id`;
     `metadata = {trans_id, external_product_id, cost_total = price × n}`.
     Nếu `len(data) < quantity` (giao thiếu — chưa thấy nhưng phải phòng): refund phần thiếu
     hoặc fail + `operational_error` — bắt đầu bằng **fail + alert** cho đơn giản.
  5. `msg` chứa "Số dư không đủ" → `provider_out_of_credit=True` (tắt provider + alert).
     "Vui lòng đăng nhập" → `operational_error="API key igbm sai/bị đổi"` critical.
     Hết hàng (chưa biết msg thật — verify khi có tiền) → fail thường, `buyer_message` white-label.
  6. **Timeout/kết quả mơ hồ**: đọc lại `profile.php`. Nếu `money` giảm đúng `price × n` →
     rất có thể đã mua nhưng mất response → `operational_error` **critical** "đã trừ tiền igbm
     mà không nhận được hàng, đối soát tay đơn #…" + refund buyer. Nếu không giảm → fail thường.
     Không bao giờ tự mua lại.
- `check_health()`: `profile.php` → healthy; `money < low_balance_vnd` → `warning` "số dư còn X".
  Không có ước tính Xu như TopProxy — igbm có API số dư thật nên bỏ qua `credit_balance_xu`.
- Buyer-facing: `_PUBLIC_ADAPTER_ALIASES["igbm"] = "auto_account"`; log/`error` được nhắc igbm,
  `buyer_message` thì không.

### 5.4 Job đồng bộ `igbm_sync_job` (scheduler, mỗi 10–15 phút)

- Một lần `products.php` (1.5 MB) → index theo id → cập nhật `cost_price`, `upstream_amount`,
  `min/max`, `synced_at` cho mọi listing của provider.
- SP igbm biến mất khỏi catalog → `upstream_amount=0` + `sync_error="delisted"` → alert warning.
- `cost_price × (1 + min_margin) > variant.price` → alert warning "margin thấp" (không tự đổi giá bán
  ở phase 1; admin quyết).
- Nếu muốn stock "tươi" hơn mà không kéo 1.5 MB: chỉ dùng `product.php` cho các listing đang active
  (vd 30 SP × 2 KB, mỗi 3 phút) — chọn khi số SKU nhỏ.

### 5.5 Seller nội bộ & quy trình tạo SP

- Tạo account seller `igbm-seller@…` (tên shop trung tính, vd "AccStation"), tier đủ để escrow
  ngắn; `commission_rate` sản phẩm = 0 hoặc để nguyên (tiền vẫn là của sàn).
- Provider row `adapter_type="igbm"`, `seller_id=NULL` (hạ tầng admin-owned, chỉ admin gắn được).
- **Phase 1**: seed script `scripts/seed_igbm.py` như `seed_topproxy.py` — chọn tay 10–30 SKU đang
  còn hàng nhiều (`amount ≥ 50`) từ các nhóm dễ bán (Gmail, TikTok, Twitter, Telegram, FB clone
  quốc gia), tạo product + variant + `supplier_listings`, giá bán = `cost × 1.3` làm tròn.
  Tên/mô tả viết lại trung tính (bỏ prefix "H4.", bỏ tên igbm), copy điều kiện bảo hành.
- **Phase 2** (nếu số SKU tăng): tab admin "Nhập từ nhà cung cấp" — duyệt cây igbm, tick SP,
  đặt margin, tạo product/variant/listing một phát; nút "Đồng bộ ngay".

### 5.6 Lượng mua mỗi đơn

Khác TopProxy/DProxy (bind 1 allocation/đơn), igbm mua N trả N dòng → **không** đặt
`max_quantity_per_order=1`. `max_quantity` buyer thấy = `min(upstream_amount, upstream_max, MAX_ORDER_QUANTITY)`.

## 6. Việc cần làm ngoài code (trước go-live)

1. **Đổi API key igbm** (nút refresh trên trang document-api) — key hiện tại đã bị dán vào chat/screenshot.
   Key mới chỉ nhập vào provider config (mã hoá) — không commit, không seed cứng.
2. **Nạp tiền igbm** — đang 0 đ. Nạp đủ để test mua thật ~5–10 đơn rẻ (Clone Ukraine 9.800 đ) và
   verify: shape `order.php`, `msg` khi hết hàng, hành vi khi `amount < quantity`, thời gian phản hồi
   `buy_product` (quyết timeout).
3. **IP whitelist** = IP egress của backend prod (server sau Cloudflare của mình).
4. Hỏi igbm: chính sách bảo hành/đổi hàng qua API (có endpoint report hàng lỗi không? hiện không thấy),
   giới hạn rate, có API list đơn hàng để đối soát không.
5. Đọc lại điều khoản igbm về resell (một số shop cấm bán lại giá thấp hơn niêm yết).
6. Quy trình xử lý dispute cho seller nội bộ: ai check tài khoản lỗi, thay thế bằng cách mua lại
   1 unit (tốn tiền igbm) hay refund — cần SOP vì igbm không có API bảo hành.

## 7. Rủi ro & điểm chưa verify

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Mua timeout → mất tiền không nhận hàng (không idempotency, không list đơn) | Cao | Check chênh số dư (5.3 bước 6) + alert critical + đối soát tay; timeout dài (30s) cho `buy_product`. |
| igbm đổi `msg` text → map lỗi sai | Trung bình | Match substring không dấu/không hoa thường; mọi msg lạ → fail thường + log nguyên văn. |
| igbm đổi giá/hết hàng giữa hai lần sync | Trung bình | Check `product.php` realtime ngay trước khi trừ ví. |
| Hàng lỗi (die, checkpoint) — không có API bảo hành | Cao (vận hành) | Escrow + dispute; `warranty_text` sao y điều kiện igbm; seller nội bộ giữ SOP. |
| `order.php` shape chưa biết | Thấp | Chỉ dùng để đối soát, không nằm trên đường mua. Verify sau khi nạp tiền. |
| Định dạng dòng giao hàng không chuẩn (description rác) | Thấp | Giao nguyên chuỗi; trong mô tả SP mình tự ghi định dạng sau khi mua thử. |
| 1.5 MB mỗi lần sync | Thấp | 10–15 phút/lần hoặc dùng `product.php` theo SKU. |

## 8. Lộ trình gợi ý

| Bước | Nội dung | Ước lượng |
|---|---|---|
| 0 | Đổi key, nạp tiền, mua thử tay 2–3 đơn bằng curl, ghi lại shape `order.php` + msg hết hàng | 0.5 ngày (chờ nạp) |
| 1 | Migration `supplier_listings` + `AdapterSpec.external_stock` + stock hook trong `products/service.py` | 1 ngày |
| 2 | `IgbmAdapter` + tests (mock wire format như `scripts/mock_topproxy.py`) | 1–1.5 ngày |
| 3 | Pre-purchase check (`product.php`) trong `create_order_with_adapter`, alias public, sync job + alert margin/delisted | 1 ngày |
| 4 | Seed seller nội bộ + 10–30 SKU, chạy E2E trên dev với mock, rồi 1–2 đơn thật | 0.5–1 ngày |
| 5 | (sau) Admin import UI từ catalog igbm | 2 ngày |

Tổng phase 1–4 ≈ **4–5 ngày** dev, tái dùng ~70% hạ tầng TopProxy.

## 9. Đã triển khai (2026-09-17, nhánh `feat/igbm-reseller`, cắt từ main 276b083)

Thiết kế tổng quát hơn §5 để nguồn thứ hai chỉ cần thêm 1 file adapter + 1 entry registry:

- `src/models/supplier_listing.py` + alembic `ec1a2b3c4d5e6` — bảng `supplier_listings` (mapping gói ↔ SKU,
  cache giá vốn/tồn/min/max/format_hint/`extra.category_path`, `sync_error`).
- `src/adapters/supplier.py::CatalogSupplierAdapter` — toàn bộ logic chung: tra listing, mua ĐÚNG 1 attempt,
  phân loại lỗi (`PURCHASE_*`), đối soát số dư trước/sau khi kết quả mơ hồ (critical alert nếu tiền đã đi),
  tạo `Resource` từng unit (status assigned, `refund_amount_cap` chia đều) → dispute/hoàn tiền theo unit dùng
  nguyên luồng seller_pool, giao lại từ Resource nếu sweeper chạy lại (không mua hai lần), health = số dư.
  Adapter con chỉ implement 5 hàm wire: `fetch_balance / fetch_listing / fetch_catalog / purchase / fetch_order`.
- `src/adapters/igbm.py::IgbmAdapter` — wire format igbm, match `msg` không dấu (`classify_error`), ép kiểu
  string/int, `flatten_catalog` (cây parent_id → category_path), `validate_igbm_config`. Timeout mặc định 30 s.
- `src/adapters/registry.py` — `AdapterSpec.external_stock`; entry `igbm` (strategies={fixed}).
- `src/suppliers/stock.py::sellable_stock_by_variant()` — MỘT subquery tồn kho bán được (Resource available +
  listing) thay cho 4 chỗ đếm Resource trong `products/service.py` (storefront list/detail, seller inventory,
  catalog summary). Buyer vẫn chỉ thấy bucket in_stock/low/out.
- `src/suppliers/service.py` — `precheck_external_purchase` (trước khi trừ ví: `product.php` realtime → hết hàng
  409 RESOURCE_UNAVAILABLE; số dư nhà cung cấp < giá vốn×n → `report_out_of_credit` tắt provider + alert, 409;
  margin < `config.min_margin_pct` (mặc định 10%) → 409 PRODUCT_UNAVAILABLE + alert `supplier_low_margin`),
  `sync_provider_listings` (delisted → tồn 0 + alert `supplier_sku_delisted`; margin thấp → alert), `attach_listing`.
- `src/suppliers/sync.py::supplier_sync_job` — mỗi 10 phút (main.py). Admin: `POST /admin/providers/{id}/sync-catalog`.
- `src/orders/service.py` — `create_order` (flow `fixed` của storefront, `POST /orders {variant_id}`) rẽ sang
  `create_order_with_adapter` khi provider `external_stock`; adapter path ghi `variant_id` lên Order.
- `src/pricing/engine.py::resolve_pricing` — `fixed` giờ tự nạp `params.variants` (trước đây rỗng → mọi quote
  fixed qua engine rớt INVALID_PRODUCT_CONFIG, tức luồng adapter cho fixed chưa từng chạy được).
- `src/providers/credit.py` — thông điệp hết tiền không còn ghi cứng "nạp Xu trên topproxy.vn" cho adapter khác.
- Public alias `igbm → "auto_account"` (`pricing/router.py`); admin UI (providers page, pricing-config, i18n) biết `igbm`.
- `scripts/mock_igbm.py` (:9400, đúng wire format + `POST /__mock/state` để diễn hết tiền/hết hàng/timeout),
  `scripts/seed_igbm.py` (seller `accstation-seller@…`, provider "Acc Station — tài khoản", 10 SKU đã chọn, `--sync`).
- Tests: `tests/test_igbm_adapter.py` (unit wire format qua ASGI mock + integration: stock storefront, đặt hàng
  → delivered + Resource, precheck hết hàng/hết tiền/margin, out-of-credit lúc provision, 5xx đối soát số dư,
  sync job, endpoint admin).

E2E trên dev (:8007/:3006, mock :9400): mua 1 gói → đơn delivered, ví −4.000đ, mock −2.800đ, 1 Resource;
mock tồn=0 → "Sản phẩm này tạm hết hàng", ví không đổi; mock số dư=100 → 409, provider tắt, alert critical.

### Còn lại trước go-live
1. Đổi API key igbm (đã lộ trong chat), nhập qua env khi seed thật; IP whitelist = IP egress prod.
2. Thay thế hàng lỗi qua dispute: `claim_resources` cho gói igbm không có pool → seller chỉ chọn hoàn tiền;
   muốn "đổi hàng" phải mua lại 1 unit từ nguồn (chưa làm).
3. Phase 2: admin UI duyệt catalog igbm → tạo product/variant/listing (hiện dùng seed script + Catalog Picker).
