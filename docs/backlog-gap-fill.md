# Backlog gap-fill so với spec (scratch_9.md)

Tài liệu theo dõi tiến độ vá các chức năng/màn hình còn thiếu so với spec thiết
kế ban đầu. Bối cảnh: so sánh code hiện tại với `scratch_9.md` phát hiện 9
nhóm thiếu, độ lớn rất chênh lệch — từ "1 trang UI gọi API có sẵn" đến "đổi cả
mô hình dữ liệu tiền" hoặc "dựng subsystem mới". Chia làm nhiều đợt, đợt 1 ưu
tiên rủi ro thấp / giá trị nhanh.

## Đợt 1 — Đã xong (commit `e8de04b`)

- [x] **Admin duyệt rút tiền** — `frontend/app/admin/withdrawals/page.tsx`
  (backend `wallet/router.py` đã có sẵn từ trước). Thêm luôn nút gửi yêu cầu
  rút tiền cho seller trên `frontend/app/wallet/page.tsx` (trước đó chưa có
  UI nào gọi `POST /wallet/withdraw`).
- [x] **Dispute: 3 kết quả xử lý mới** — hoàn tiền một phần, đổi sản phẩm,
  gia hạn bảo hành. `marketplace-svc/src/disputes/service.py` +
  `disputes/router.py` + migration `n1a2b3c4d5e6`. UI trong
  `frontend/app/admin/disputes/page.tsx` (panel chi tiết, mục "Xử lý khác").
- [x] **Trang chủ: "Người bán uy tín" + "Đơn hàng gần đây"** — module backend
  mới `marketplace-svc/src/sellers/` (`GET /sellers/top`, `GET /sellers/{id}`),
  2 section mới trong `frontend/app/page.tsx`.
- [x] **Trang hồ sơ seller công khai** — `frontend/app/sellers/[id]/page.tsx`,
  filter `seller_id` cho `GET /products`, link từ trang chủ + trang sản phẩm.
- [x] **AdminShell mobile drawer** — sidebar admin chuyển thành drawer có
  backdrop trên mobile thay vì panel cố định chiếm hết màn hình nhỏ.
- [x] **Lỗi trả về cho user dịch sang tiếng Việt** — toàn bộ `HTTPException`
  backend (~90 chỗ, 20 file: orders, disputes, wallet, resources, reviews,
  categories, auth, seller, providers, affiliate...) đổi từ tiếng Anh sang
  tiếng Việt. `ResourceUnavailable` đổi mã lỗi 404 → 409 (đúng ngữ nghĩa "hết
  hàng" hơn "không tìm thấy"). Sửa luôn 2 message lỗi mạng còn tiếng Anh trong
  `frontend/lib/api.ts` (`request()` — điểm tập trung xử lý lỗi API).
- [x] **UX hết hàng ở trang sản phẩm** — gói/variant hết hàng vẫn xem/chọn
  được đầy đủ chi tiết, chỉ nút đặt hàng tự khoá + đổi nhãn "Hết hàng"
  (`frontend/app/products/[id]/page.tsx`).

## Hạn chế đã biết, chưa fix (phát hiện trong lúc làm đợt 1)

- ~~Không có endpoint từ chối yêu cầu rút tiền~~ — đã làm ở đợt 2.
- `Dispute.order_id` có `unique=True` → sau khi resolve bằng "đổi sản phẩm"
  hoặc "gia hạn bảo hành" (đưa order về lại `delivered` để buyer xác nhận
  lại), buyer **không thể mở khiếu nại lần 2** trên cùng đơn đó vì
  `create_dispute` chặn dispute trùng theo `order_id`. Buyer vẫn xác nhận
  đơn bình thường được, chỉ là không dispute lại được.
- Dispute #4 (order #24, dữ liệu demo cũ) lỗi khi tải chi tiết trong panel
  admin ("Không thể tải thông tin khiếu nại") — bug có từ trước, không liên
  quan tới thay đổi trong đợt 1, chưa điều tra nguyên nhân gốc.
- `marketplace-svc/src/providers/router.py:54` (`detail=str(e)`, nhánh
  `get_adapter` raise `ValueError`) vẫn trả message runtime thẳng ra — đã
  soát lại ở đợt 3: các message này tĩnh/an toàn (vd "Provider X not
  found", "Unknown adapter_type"), không chứa credential, nên để nguyên.
  Nhánh còn lại (`provision_test["error"]`, có thể lộ chi tiết lỗi khi test
  provider thật) đã được redact ở đợt 3.

## Đợt 2 — Đã xong

- [x] **Endpoint từ chối yêu cầu rút tiền** — `reject_withdrawal()` trong
  `wallet/service.py` (song song `approve_withdrawal`, không đụng balance),
  route `POST /admin/withdrawals/{id}/reject`, nút "Từ chối" trong
  `frontend/app/admin/withdrawals/page.tsx`.
- [x] **Trang seller theo dõi lịch sử rút tiền của chính mình** — endpoint
  self-scoped `GET /wallet/withdrawals`, hiển thị trong
  `frontend/app/wallet/page.tsx` (card "Lịch sử yêu cầu rút tiền").
- [x] **Bằng chứng tranh chấp theo loại sản phẩm** — thêm `evidence_type` +
  `evidence` (JSONB) vào `Dispute` (migration `o1a2b3c4d5e6`), form chọn loại
  (tài khoản/proxy/server/payment/khác) với field tương ứng trong
  `DisputeModal` (`frontend/app/orders/page.tsx`), hiển thị ở cả trang buyer
  và panel admin (`frontend/lib/dispute-evidence.ts` là nơi định nghĩa dùng
  chung 2 phía).
- [x] **Phân cấp seller** (New/Verified/Trusted/Enterprise) — field
  `Account.seller_tier` (migration `p1a2b3c4d5e6`), gán thủ công qua
  `PATCH /admin/accounts/{id}/tier` (UI trong `admin/accounts/page.tsx`).
  Tier chi phối 3 điểm cụ thể (`marketplace-svc/src/sellers/tiers.py`): hạn
  mức rút tiền mỗi lần (`wallet/service.py`), % phí nền tảng được giảm
  (`scheduler.py`, `disputes/service.py`), số ngày ký quỹ được rút ngắn
  (`orders/service.py`, `disputes/service.py`). Chưa có auto-promote theo
  doanh số — tier là do admin gán tay.
- [x] **Redesign trang hồ sơ seller công khai** (theo yêu cầu UX riêng,
  không nằm trong 9 nhóm gốc) — bỏ hero nền tối `bg-ink-panel` full-bleed
  (khó đọc, tràn viền) đổi sang Card sáng dùng `aura` wash như hero trang
  chủ; tag "Ngành hàng" giờ bấm được để lọc lưới sản phẩm theo category;
  card sản phẩm thêm badge tồn kho (Còn hàng/Giao sau/Tạm hết hàng), giá
  "Chỉ từ", rating, số đã bán — `frontend/app/sellers/[id]/page.tsx`.

## Đợt 3 — Đã xong

- [x] **Mô hình số dư 3 lớp** — `Wallet.balance` tách thành `pending_balance`
  (luôn 0 đợt này — escrow vẫn track qua `Order.status` như cũ, không tái
  cấu trúc luồng escrow), `available_balance` (tương đương "balance" cũ),
  `locked_balance`. Migration `q1a2b3c4d5e6`. Sửa đúng bug thật: trước đây
  `request_withdraw` chỉ kiểm tra balance mà không khoá, nên seller gửi
  nhiều yêu cầu rút liên tiếp có thể cùng vượt qua check dù tổng vượt quá số
  dư thực (`marketplace-svc/src/wallet/service.py`). Nay khoá tiền
  (`available → locked`) ngay lúc gửi request; `approve_withdrawal` chỉ trừ
  `locked_balance`; `reject_withdrawal` trả tiền về `available_balance`
  (trước đây hàm này không đụng balance gì cả — cũng là chỗ đã sửa). Thêm
  `TransactionType.withdraw_lock`/`withdraw_unlock`. `WalletResponse` giữ
  field `balance` dạng computed (alias `available_balance`) để tương thích
  ngược. Frontend: `frontend/app/wallet/page.tsx` (số dư khả dụng + dòng
  "đang khoá"), `frontend/components/TopNav.tsx`. Test:
  `marketplace-svc/tests/test_wallet.py` (8 test, gồm test tái hiện bug cũ).
- [x] **Adapter API thật + idempotency + mã hoá credential** — thêm
  `RealApiAdapter` (`marketplace-svc/src/adapters/real_api.py`) dùng chung
  cho 2 `adapter_type` đã có sẵn UI ở `admin/providers/page.tsx` (`topproxy`,
  `scrapecreators` — chỉ khác `base_url` mỗi `Provider`), có retry (3 lần,
  backoff, chỉ retry lỗi mạng/5xx) + header `Idempotency-Key` deterministic
  theo `order_id`. Module `marketplace-svc/src/security/crypto.py` (Fernet,
  derive key từ `settings.encryption_key` có sẵn — trước đó là dead code)
  mã hoá riêng field `api_key`/`api_secret`/... trong `Provider.config`
  (partial field encryption, không mã hoá cả JSON blob) — áp dụng ở
  `providers/service.py::create_provider`/`update_provider`. Migration
  `r1a2b3c4d5e6` mã hoá credential plaintext có sẵn trong seed data. Redact
  lỗi runtime ở `test_provider` (không còn lộ chi tiết lỗi thật ra response,
  chỉ log server-side). **Chưa đụng `Resource.data`** — quyết định ưu tiên
  `Provider.config` trước (rủi ro cao hơn, độc lập hơn), để `Resource.data`
  làm đợt sau riêng. Test: `test_adapters.py` (6 test mới), `test_providers.py`
  (2 test mới).
- [x] **Trang cài đặt API cho seller lớn** (`/seller/api-settings`) — bảng
  `SellerApiKey` mới (migration `s1a2b3c4d5e6`, hash sha256 không dùng
  bcrypt — lý do ghi trong code comment), module
  `marketplace-svc/src/seller_api_keys/`. Chỉ seller tier Trusted/Enterprise
  mới tạo được key (`require_min_seller_tier` mới trong `auth/dependencies.py`).
  `/me` giờ trả thêm `seller_tier` (trước đây không có, dù đã tồn tại trên
  `Account` từ đợt 2). Frontend: `frontend/app/seller/(dashboard)/api-settings/page.tsx`
  (tạo/xem/thu hồi key, hiện plaintext đúng 1 lần lúc tạo, kèm khối tài liệu
  tra cứu nhanh — method/path/mô tả/lệnh curl mẫu cho từng thao tác, có nút
  sao chép), thêm tab "API" vào nav `seller/(dashboard)/layout.tsx`.
  Phạm vi key: 4 endpoint, tất cả qua `get_seller_account_jwt_or_api_key`
  (chấp nhận cả JWT lẫn header `X-Seller-Api-Key`) — `GET /seller/orders`,
  `POST /seller/orders/{id}/accept`, `POST /seller/orders/{id}/deliver`,
  `POST /seller/variants/{id}/resources` (nạp hàng loạt tài nguyên). 3 thao
  tác ghi sau được bổ sung sau khi seller hỏi cần gì để thao tác nhanh hơn —
  ưu tiên vì đây đúng là các thao tác seller lớn cần tự động hoá (nhận/giao
  đơn, nạp kho) chứ không chỉ đọc. Test: `test_seller_api_keys.py` (11 test,
  verify qua test suite thay vì gọi API sống vào dữ liệu demo — permission
  classifier chặn thao tác giao đơn demo thật khi test tay).

Migration chain: `p1a2b3c4d5e6` (seller_tier, đợt 2) → `q1a2b3c4d5e6` →
`r1a2b3c4d5e6` → `s1a2b3c4d5e6`. Toàn bộ 216 test backend pass sau đợt 3.

## Đợt 4 — Đã xong

Bối cảnh: rà lại luồng đấu nối provider (`scratch_9.md` §10) trước khi mở API
cho nhà cung cấp thật. Đợt này chỉ làm phần **không phụ thuộc API doc của
provider** — xem "Hạn chế đã biết" bên dưới.

- [x] **Bảng log request/response với provider** — `provider_call_logs`
  (migration `t1a2b3c4d5e6`, model trong `models/provider.py`), mỗi attempt HTTP
  ra provider ghi 1 dòng: operation/method/path/attempt/status_code/latency_ms/
  success/error/idempotency_key/order_id. Trước đó sự cố provider chỉ debug được
  qua `str(e)` trong `log_entries` — không status code, không latency, không biết
  attempt thứ mấy. Hai quyết định thiết kế:
  - Ghi bằng **session độc lập** (`adapters/call_log.py`) nên log sống sót khi
    transaction của caller rollback — chính là lúc cần nhất, vì
    `orders/service.py` refund+cancel rồi mới commit. Hệ quả: `order_id`
    **không đặt FK**, vì lúc provision order mới `flush`, chưa commit, session
    khác không nhìn thấy → FK sẽ vỡ lúc insert.
  - **Không lưu body request/response.** Response `provision` chứa credential
    giao cho buyer, `api_key` nằm trong header — lưu vào đây là tạo bản plaintext
    thứ hai (`Order.delivered_data` plaintext đã là gap đang mở). Có test assert
    credential/api_key/`user_config` đều không lọt vào log.
- [x] **Fix `Idempotency-Key` hằng số ở test provision** — `providers/router.py`
  gọi provision với `order_id=0` → key cố định `order-0-provision`, mọi lần bấm
  "test provider" dùng chung key nên provider có thể trả cache của lần test đầu.
  Nay đơn thật giữ key deterministic `order-{id}-provision` (đúng mục đích chống
  double-provision khi retry), còn `order_id=0` sinh key `test-{uuid4}-provision`
  mới mỗi lần.
- [x] **`ENCRYPTION_KEY` vào checklist deploy** — biến này trước đây không hề
  được ghi trong README. Đã thêm vào bảng env kèm cảnh báo: đổi khoá = toàn bộ
  `api_key` đã lưu không giải mã được, không có đường khôi phục ngoài nhập tay
  lại từng provider. Thêm log `insecure_default_encryption_key` lúc khởi động
  (`main.py` lifespan) khi còn dùng khoá mặc định.

Migration `t1a2b3c4d5e6` (nối sau `s1a2b3c4d5e6`). 228 test backend pass
(9 test mới trong `test_adapters.py`).

## Đợt 5 — Đã xong

- [x] **Tách call provider khỏi request đồng bộ** — `create_order_with_adapter`
  commit đơn ở `pending` + trừ tiền, rồi provision ngoài transaction; request
  không còn giữ transaction DB mở suốt thời gian gọi HTTP (~16.5s worst case).
  Migration `u1a2b3c4d5e6` thêm `Order.user_config` (JSONB) — bắt buộc, vì
  provision chạy sau khi request kết thúc nên tuỳ chọn buyer chọn phải sống lâu
  hơn request; sweeper cũng cần để replay. Chứa tuỳ chọn sản phẩm
  (`type`/`network`/`days`/`platform`...), không chứa credential.
  - **Chỉ hoãn `RealApiAdapter`.** `SellerPoolAdapter` claim tồn kho ngay trong
    transaction — hoãn thì hai buyer có thể cùng đặt món cuối cùng rồi mới phát
    hiện hết hàng. `Manual`/`Mock` thuần DB, nhanh, không có I/O mạng. Chỉ adapter
    gọi mạng mới cần hoãn.
  - Tách hàm `_apply_provision_result()` dùng chung cho cả 3 đường (inline,
    background task, sweeper) để 3 nơi không lệch nhau.
- [x] **Sweeper `provision_sweep_job`** (`scheduler.py`, chạy mỗi 2 phút) — bắt
  buộc chứ không phải tuỳ chọn: `sla_check_job` tra `order.variant_id` và bỏ qua
  đơn không có (`scheduler.py`), mà đơn adapter luôn `variant_id = None` → đơn
  adapter kẹt `pending` **không có job nào cứu**, buyer đã bị trừ tiền. Job mới
  quét đơn `pending` có `product_id`, retry sau 2 phút, quá 15 phút thì refund +
  cancel + alert. Retry an toàn nhờ key deterministic `order-{id}-provision` làm
  ở đợt 4 — đúng chỗ nó phát huy tác dụng.
- [x] **Khoá hàng khi provision (`with_for_update`)** — bug tiền phát hiện lúc
  tự review chính đợt này: background task và sweeper có thể cùng chạm một đơn,
  cả hai đọc thấy `pending`, cả hai gọi provider, và nếu provider từ chối thì
  **cả hai gọi `refund_escrow` → buyer được hoàn tiền 2 lần**. Idempotency-Key
  chỉ bảo vệ phía provider, không bảo vệ ví. Nay `provision_pending_order` load
  order với `with_for_update=True`. Có test tái hiện: gỡ lock ra thì test vỡ
  đúng (hoàn 515.000 thay vì 500.000).
- [x] **Frontend: polling + tách UI theo status** — `products/[id]/page.tsx`:
  component `Delivered` cũ hiện icon check xanh **bất kể status** và giả định
  `delivered_data` có sẵn ngay trong response POST. Thay bằng `OrderResult` phân
  biệt pending/delivered/cancelled, poll `GET /orders/{id}` mỗi 3s cho tới khi
  đơn settle (timeout 15 phút, khớp deadline của sweeper). Thêm `api.getOrder()`
  (`lib/api.ts` — backend `GET /orders/{id}` vốn đã có sẵn, chỉ thiếu wrapper).
  - Phân biệt **hai loại pending**: đơn qua provider (`product_id`) thì poll và
    báo "đang lấy từ nhà cung cấp"; đơn manual variant (`variant_id`) cũng
    `pending` nhưng chờ *seller* hàng giờ theo SLA → không poll, giữ nguyên
    thông báo cũ.
  - Sửa 2 chỗ `lib/types.ts` khai sai: `variant_id` khai non-null nhưng backend
    trả `int | None` (đơn adapter luôn null), và thiếu hẳn `product_id`.
  - Tiện tay sửa bug có sẵn: đường dynamic form gọi `Delivered` với
    `instant={false}`, mà điều kiện hiện credential là `instant && delivered_data`
    → **đơn adapter chưa bao giờ hiện credential ở trang sản phẩm**, kể cả khi đã
    delivered; buyer luôn phải tự sang `/orders`.

Migration `u1a2b3c4d5e6` (nối sau `t1a2b3c4d5e6`). 10 test mới trong
`test_orders.py`, toàn bộ 238 test backend pass. Frontend `tsc --noEmit` +
`next build` sạch.

Lưu ý khi chạy test: suite dùng chung DB `marketplace_test` và fixture
`clean_db` TRUNCATE giữa mỗi test, nên **không chạy hai tiến trình pytest song
song** — chúng giẫm lên nhau và sinh lỗi giả (`InvalidRequestError: Could not
refresh instance`, register trả 409, request trả 401) trông như bug thật.

## Đợt 6 — Đã xong (đối soát ví)

Bối cảnh: rà lại 3 con số trên trang ví (tổng vào / tổng ra / số dư khả dụng) vì
chúng không cộng ra nhau — UI hiện `17.425.000 − 3.292.106` nhưng số dư
`14.335.106`, lệch `202.212`. Tìm ra **hai nguyên nhân độc lập**.

- [x] **Bug phân loại ở frontend** — `wallet/page.tsx` định nghĩa tiền ra bằng
  **phủ định**: `!CREDIT.has(t.type)`, mà `CREDIT` chỉ liệt kê 3 loại
  (`topup`/`purchase_release`/`refund`) trong khi có 9 loại. Mọi loại quên liệt kê
  **âm thầm bị tính là tiền ra**. Ví admin có `platform_fee` = 101.106 (phí nền
  tảng thu được, backend cộng vào ví ở `wallet/service.py`) bị xếp nhầm → sai số
  đúng bằng **2 lần** (thiếu một lần cộng, thừa một lần trừ): `2 × 101.106 =
  202.212`, và `14.132.894 + 202.212 = 14.335.106` khớp tuyệt đối. Ba loại bị xếp
  nhầm: `platform_fee`, `affiliate_commission`, `withdraw_unlock`. Thêm một lỗi
  nữa: `withdraw` bị tính là tiền ra nhưng nó **không đụng `available_balance`**
  (chỉ giảm `locked`) — tiền đã trừ từ lúc `withdraw_lock` → **đếm hai lần**.
- [x] **Sửa tận gốc, không chỉ vá cái set** — nguyên nhân gốc là frontend tự suy
  diễn ngữ nghĩa tiền (thứ nó không sở hữu) bằng một mặc định phủ định; vá set thì
  loại thứ 10 sẽ dính lại y hệt. Nay backend sở hữu ngữ nghĩa:
  `models/wallet.py::TRANSACTION_DIRECTION` là nguồn sự thật duy nhất, và
  `TransactionResponse` trả thêm field `direction` (`in`/`out`/`neutral`).
  Frontend chỉ đọc `direction`, không suy diễn từ `type` nữa. Test
  `test_every_transaction_type_has_a_direction` chặn đúng loại bug này: thêm
  `TransactionType` mà quên direction là fail ngay.
  - Bất biến được khẳng định: mọi thay đổi `available_balance` đều ghi kèm một
    Transaction đúng số tiền (đã soát cả 8/8 chỗ trong `wallet/service.py`), nên
    `Σ(in) − Σ(out) == available_balance`. Có test đi trọn vòng đời ví để giữ.
- [x] **Bút toán đối soát cho lỗ hổng sổ sách** (migration `v1a2b3c4d5e6` +
  `w1a2b3c4d5e6`) — phát hiện trong lúc rà: migration `q1a2b3c4d5e6` của đợt 3
  chuyển tiền `available → locked` cho các withdraw_request đang pending **bằng
  SQL thô, không ghi giao dịch nào**. Nên với ví có lệnh rút bắc qua migration đó,
  sổ giao dịch vĩnh viễn không cộng ra được số dư — sổ mất đúng chức năng chính
  của nó. Đối soát toàn bộ ví dev: **chỉ 1 ví lệch** (seller, −9.200.000), truy
  được trọn vẹn từ 7 yêu cầu rút: 9.000.000 (request #4 pending, bị migration khoá
  không ghi sổ) + 100.000 (#1 rút kiểu cũ, `withdraw` trừ thẳng `available`) +
  100.000 (#5 bị migration khoá không ghi sổ rồi reject lại ghi sổ `withdraw_unlock`).
  - **Không chế lịch sử**: không sinh dòng `withdraw_lock` giả, vì với #1 chưa
    từng có sự kiện khoá nào. Theo cách kế toán: ghi một **bút toán điều chỉnh**
    (`adjustment_credit`/`adjustment_debit`) nói rõ chênh lệch do đâu, để sổ cộng
    đúng số dư **từ đây trở đi**.
  - Tách 2 migration vì Postgres không cho dùng giá trị enum mới trong chính
    transaction vừa thêm nó; và phải bật `transaction_per_migration=True` trong
    `alembic/env.py` vì mặc định alembic chạy cả chuỗi trong một transaction nên
    việc tách đôi vô nghĩa.

Migration chain: `u1a2b3c4d5e6` → `v1a2b3c4d5e6` → `w1a2b3c4d5e6`. 3 test mới
trong `test_wallet.py`, toàn bộ 241 test backend pass. Frontend `tsc --noEmit` +
`next build` sạch.

Cách chạy test + 2 cái bẫy môi trường (`uv run` gỡ pytest khỏi venv; không chạy
2 tiến trình pytest song song) đã ghi vào mục "Test" trong `README.md`.

## Đợt 7 — Đã xong (Kho hàng + Rút tiền cho seller)

Hai trong 5 tab seller mà spec `scratch_9.md:286-301` yêu cầu nhưng nav chỉ có 4/9.

- [x] **Backend API kho hàng** — trước đó seller **không có cách nào sửa nội dung
  tài nguyên** (chỉ xoá rồi nạp lại), và không có endpoint nào đếm tồn kho của
  chính mình (`/admin/resources/summary` là admin-only + toàn hệ thống).
  - `GET /seller/inventory/summary` — đếm available/assigned/expired/error theo
    từng gói. Dùng **outer join**: gói hết sạch hàng chính là thứ seller cần thấy
    nhất, inner join sẽ giấu nó đi.
  - `PATCH /seller/resources/{id}` — **chỉ sửa được khi `available`**.
    `Order.delivered_data` là bản sao chụp lúc giao, nên sửa tài nguyên đã giao
    không chạm được tới thứ buyer đang cầm; cho sửa sẽ khiến seller tưởng đã vá
    cho khách trong khi không. Lỗi trả về chỉ thẳng sang đường khiếu nại.
  - `DELETE /seller/resources/{id}` đã có sẵn backend từ trước nhưng **chưa client
    nào gọi** — nay nối vào UI.
- [x] **Backend trả hạn mức rút theo tier** — `WalletResponse.withdraw_policy`
  `{tier, limit_per_request}`. Trước đó FE chỉ biết hạn mức khi bị backend từ chối.
  Không hardcode bảng tier→số tiền ở FE: đó đúng là lỗi vừa sửa ở đợt 6 (client tự
  suy diễn ngữ nghĩa tiền). `null` ở trong = không giới hạn (enterprise), `null` ở
  ngoài = tài khoản không phải seller — hai nghĩa khác nhau nên không dùng chung
  một trường.
- [x] **Trang `/seller/inventory`** — mở đầu bằng cái sắp hết, không phải bảng
  chung, vì câu hỏi đầu tiên của seller luôn là "cái gì sắp hết?". Chip lọc
  hết hàng / sắp hết / có dòng lỗi. **Đơn vị giao diện là dòng**: mono, click là
  sửa tại chỗ, Enter/blur lưu, Esc huỷ — khớp mô hình trong đầu seller (một file
  text các dòng `uid|pass|...`). Viền trái mã màu trạng thái. Dòng đã bán khoá
  lại kèm số đơn.
- [x] **Trang `/seller/withdrawals`** — hạn mức theo cấp hiện **trước** khi bấm,
  "Rút tối đa" lấy min(số dư, hạn mức), giải thích tiền đang khoá, empty state.
- [x] Thêm 2 tab vào nav seller (`Rows`, `Wallet`).

Đã kiểm bằng browser trên dữ liệu thật (không chỉ build sạch) — 3 bug lộ ra và đã
sửa, xem dưới. 8 test mới trong `test_resources.py`, toàn bộ 249 test backend pass.
Frontend `tsc --noEmit` + `next build` sạch. Không migration nào (dùng bảng có sẵn).

## Đợt 8 — Đã xong (sửa biến thể + vá tràn ngang mobile)

- [x] **Sửa được biến thể** — trước đây `VariantManager` chỉ **thêm và xoá**;
  `api.updateVariant` tồn tại trong `api.ts` nhưng **chưa từng được gọi**. Muốn đổi
  giá thì phải xoá rồi tạo lại, mà biến thể đang gánh tồn kho và lịch sử đơn.
  Nay sửa tại chỗ: tên ở dòng trên, điều khoản `[Giao ngay ▾] [30] ngày [280000] ₫`
  trên một dòng, đúng cấu trúc trạng thái đọc — card chỉ nở 104→122px thay vì bật
  ra modal. Đổi giá thì hiện luôn hệ quả: "Giá mới chỉ áp dụng cho đơn đặt sau khi
  lưu".
- [x] **Nút Tắt bán / Bật bán** — `is_active` có sẵn ở API từ lâu nhưng UI chưa bao
  giờ dùng. Đây mới là việc seller cần khi gói đã có đơn; xoá là sai công cụ.
- [x] **`update_variant` xoá được `duration_days`** — service bỏ qua mọi giá trị
  `None` (`if value is not None`), nên đặt thời hạn rồi thì **không bao giờ quay
  lại "vĩnh viễn"** được. Router vốn đã lọc field không gửi (`exclude_unset`), nên
  `None` ở service là seller chủ ý xoá. Nay chỉ chấp nhận `None` cho cột nullable
  (`NULLABLE_VARIANT_FIELDS`).
- [x] **`delete_variant` chặn đúng lý do** — trước đây xoá thẳng, mà `Resource` và
  `Order` đều FK trỏ vào, nên lệnh xoá ném `ForeignKeyViolationError` thành **500**;
  frontend thì không try/catch → seller bấm Xoá và **không có gì xảy ra, không lời
  giải thích**. Nay trả 400 kèm số liệu cụ thể ("đã có 5 đơn hàng…") và chỉ sang
  Tắt bán.
- [x] **`GET /seller/products/{id}/detail`** — bug do chính đợt này tạo ra, phát
  hiện lúc test tận tay: `get_product_detail` lọc bỏ variant `is_active=false`
  (đúng cho trang mua), nhưng trang quản lý seller dùng **chung endpoint công
  khai** → tắt bán xong là gói biến mất khỏi trang sửa và **không còn đường bật
  lại**. Thêm endpoint seller-scoped kèm cả gói đã tắt.
- [x] **Vá tràn ngang mobile** (3 chỗ, đều có sẵn từ trước):
  - `TopNav` dư 3px ở 390px → `px-4 sm:px-6` + `gap-3 sm:gap-6`.
  - `/seller/products`: `<table>` rộng 561px trong Card `overflow-hidden` → bọc
    `overflow-x-auto`.
  - Trang chủ tràn 635px: grid item mặc định `min-width:auto` nên text `truncate`
    (nowrap) bên trong đẩy cả cột rộng ra thay vì bị cắt → `[&>*]:min-w-0`. Bảng
    "Toàn bộ sản phẩm" cũng bị Card cắt mất phần thừa → bọc `overflow-x-auto`.
- [x] **Nút menu mobile ra ngoài cùng bên trái**, trước logo (theo yêu cầu) — bên
  phải đã có ví + Nạp tiền + avatar, nút menu nằm lọt giữa chúng.

8 test mới trong `test_products.py`, toàn bộ 257 test backend pass. Frontend
`tsc --noEmit` + `next build` sạch. Không migration nào.

## Đợt 9 — Nối trang sản phẩm với Kho hàng

Câu hỏi đặt ra: xem/sửa kho ngay trong trang sản phẩm, hay trỏ thẳng sang Kho hàng?
Trả lời theo **việc seller đang làm ở mỗi chỗ**, và hoá ra là cả hai — mỗi nơi một
việc, không nơi nào làm cả hai:

- **Trang sản phẩm = "định nghĩa thứ mình bán, và bỏ hàng vào ngay".** Luồng thật:
  tạo gói xong thì việc kế tiếp là nạp hàng. Bắt họ nhảy sang Kho hàng, lục giữa 72
  gói, rồi quay lại là vô lý — **đợt 7 tôi đã cắt quá tay** khi bỏ hẳn ô dán hàng.
  Nay trả lại ô dán ngay tại gói đang xem: **chỉ thêm**, cố ý không liệt kê/sửa từng
  dòng, vì dựng trình sửa dòng thứ hai ở đây chỉ tạo ra hai bản và bản này dở hơn.
- **Kho hàng = "truy lỗi trên toàn bộ kho".** Việc khác hẳn: gói nào hết, dòng nào
  hỏng. Đó là nơi sửa từng dòng.
- [x] **Deep-link `?variant=<id>`** — nút cũ trỏ vào đầu danh sách 72 gói, seller
  phải tự tìm lại. Nay trỏ đúng gói: tự mở, cuộn tới giữa màn, viền iris + nền nhạt
  trong 2,2s rồi tắt (nó chỉ trả lời "mình vừa đáp xuống đâu", xong việc thì biến
  mất). Bộ lọc ép về "tất cả", nếu không gói được trỏ tới có thể không khớp bộ lọc
  hiện hành và không hiện ra. Tôn trọng `prefers-reduced-motion`.
  `useSearchParams` bọc trong `Suspense` để trang không bị ép render động — build
  vẫn giữ `/seller/inventory` ở dạng static.

Chỉ đụng frontend, không migration, không đổi API. 257 test backend vẫn pass;
`tsc --noEmit` + `next build` sạch.

## Cái bẫy đáng biết: `cn` không merge class Tailwind

`lib/cn.ts` chỉ nối chuỗi, **không dùng `tailwind-merge` dù package đã có trong
`package.json`**. Nên mọi override class cho `Input`/`Select`/`Button`… đụng class
gốc của component (`h-10 w-full`) và **thắng thua theo thứ tự CSS chứ không theo ý
người viết** — `h-8`/`w-auto` truyền vào bị nuốt im lặng. Cách né: đặt chiều rộng
ở div bọc ngoài, và dùng chiều cao gốc của design system. **Chưa sửa `cn`**: đổi nó
ảnh hưởng mọi component và có chỗ đang vô tình dựa vào hành vi hiện tại.

## Hạn chế đã biết sau đợt 7

- **Ngưỡng "sắp hết" là hằng số `LOW_STOCK = 5`** ở frontend, không theo tốc độ
  bán. Với seller demo thì 31/72 gói sắp hết + 35 hết hàng — đúng thực tế nhưng
  danh sách dài. Nếu muốn thành công cụ triage thật thì ngưỡng nên suy từ lượng
  bán gần đây, và nên để seller tự đặt theo gói.
- **`TopNav` tràn 3px trên màn 390px** (khối số dư + Nạp tiền + avatar). Có sẵn
  trên mọi trang, không phải do đợt này; chưa sửa vì nằm ngoài phạm vi.
- **Trang `/seller/products` tràn ngang trên mobile** (thẻ `<table>` không bọc
  trong `overflow-x-auto`) — cũng là lỗi có sẵn, chưa sửa.
- Kho hàng tải toàn bộ gói một lần, không phân trang. Seller demo có 72 gói nên
  vẫn ổn; vài trăm gói thì cần phân trang hoặc cuộn ảo.
- `ResourceStatus.expired` có trong enum nhưng **không code nào set** — cột
  "hết hạn" trên thanh tồn kho vì thế luôn bằng 0.

## Bug lộ ra khi xem tận mắt (build sạch không bắt được)

1. **Trùng key React (60 lỗi console)** — `seller_inventory_summary` sắp xếp theo
   `Product.title`, mà **tên sản phẩm không duy nhất**, nên variant của hai sản
   phẩm trùng tên xen kẽ nhau; frontend gom nhóm bằng cách so với cụm cuối cùng
   nên tạo ra nhiều nhóm trùng `product_id`. Sửa hai đầu: backend thêm `Product.id`
   vào khoá sắp xếp; frontend gom bằng `Map` theo `product_id`, không giả định các
   dòng cùng sản phẩm nằm liền nhau.
2. **Chip "66 sắp hết" là nhiễu** — gộp "hết hàng" (0) chung với "sắp hết" (1-5).
   Hai thứ đòi hành động khác nhau. Tách ra: 35 hết hàng / 31 sắp hết.
3. **Nav tràn ngang trên mobile** — 2 tab tôi thêm đẩy nav thành 561px trên màn
   390px, kéo cả trang trôi ngang. Nav nay tự cuộn trong `overflow-x-auto`.

## Hạn chế đã biết sau đợt 6

- **Giao dịch rút tiền không có `reference_id`** — `withdraw_lock`/`withdraw`/
  `withdraw_unlock` đều không lưu id của `WithdrawRequest` (`wallet/service.py`).
  Vì thế không map được dòng sổ ↔ yêu cầu rút, và cũng vì thế backfill trên mới
  phải dùng bút toán điều chỉnh gộp thay vì vá đúng từng request. Nên thêm.
- **Bút toán điều chỉnh chỉ đúng tại thời điểm chạy migration.** Nếu còn wallet
  nào lệch phát sinh sau này (do một đường ghi số dư mới quên ghi sổ), sẽ không có
  gì phát hiện. Đáng thêm một job đối soát định kỳ + alert, thay vì migration
  một lần.
- `pending_balance` vẫn luôn = 0 — spec `scratch_9.md:329-343` yêu cầu
  `Thanh toán → pending_balance`, escrow hiện vẫn track qua `Order.status`. Chưa
  rà xem đây là quyết định có chủ đích hay gap thật.

## Hạn chế đã biết sau đợt 5

- **Request vẫn block khi provider chậm?** Không — đơn trả về `pending` ngay,
  buyer không chờ. Nhưng background task chạy **in-process** bằng
  `asyncio.create_task`, không phải queue thật: nhiều đơn cùng lúc sẽ cùng chiếm
  event loop và connection pool của chính API. Khi lưu lượng lớn thì cần queue
  riêng (RabbitMQ đã có sẵn trong stack nhưng chưa dùng cho việc này).
- **Sweeper retry vô hạn trong 15 phút** — cứ 2 phút một lần, không có backoff và
  không đếm số lần thử (không có cột `provision_attempts`). Provider hỏng lâu sẽ
  ăn ~7 lần retry mỗi đơn trước khi refund.
- Đa số test monkeypatch `spawn_provision` để chạy `provision_pending_order` một
  cách xác định thay vì đua với orphan task; riêng
  `test_spawn_provision_actually_runs_the_real_task` chạy đường
  `asyncio.create_task` thật rồi drain `_background_tasks`. Lưu ý khi viết thêm
  test: **đừng patch `httpx.AsyncClient.request` trước khi gọi `client.post`** —
  test client cũng là một `httpx.AsyncClient` nên sẽ nuốt luôn request tạo đơn;
  patch `RealApiAdapter.provision` thay vào đó.

## Hạn chế đã biết sau đợt 4

- **Adapter chưa từng chạy với provider thật.** Docstring `real_api.py` ghi rõ
  shape request/response (`{success, data, error}`, Bearer, path `/provision`)
  là **quy ước tự đặt, chưa có API doc**. Test đều monkeypatch `httpx`. Cần lấy
  API doc thật của `topproxy`/`scrapecreators` trước khi làm tiếp §10.
- **Timeout = mất hàng.** Nếu provider provision xong nhưng response timeout,
  `real_api.py` trả `success=False` → marketplace refund + cancel, trong khi
  resource bên provider đã bị tiêu thụ. Không có gì phát hiện được: không lưu
  external order id, không có `GET /orders/{id}` để hỏi lại, không có job quét
  đơn cancelled. Xem item `provider_orders` bên dưới.
- ~~Call provider đồng bộ trong request~~ — đã sửa ở đợt 5.
- **Chưa có UI xem `provider_call_logs`** — hiện chỉ query bằng SQL.

## Checklist các đợt sau (chưa làm)

- [ ] **Bảng `provider_orders` + đối soát đơn treo** — spec `scratch_9.md:438`
  ("Marketplace tạo provider_order") và bảng `provider_integrations` (`:480`).
  Hiện không có entity nào map `order.id` ↔ id đơn phía provider, nên không đối
  soát được kịch bản "timeout = mất hàng" ở trên. Cần: model + migration, thêm
  `get_order_status()` vào `adapters/base.py`, reconcile job. **Chặn bởi API doc
  provider.**
- [ ] **Bù 3 API thiếu so với spec §10** — `GET /products/{id}/availability`
  (thiếu hẳn, nên không hỏi được tồn kho trước khi trừ tiền buyer),
  `POST /orders/{id}/replace` (thiếu, dù `DisputeStatus.resolved_replace` đã tồn
  tại → nghiệp vụ đổi hàng chưa tự động hoá được), `POST /orders/{id}/cancel`
  (đang bị thay bằng `revoke` theo `resource_id` — lệch semantics, không hủy
  được đơn pending). **Chặn bởi API doc provider.**
- [ ] **Mã hoá `Resource.data`** — đợt 3 chỉ mã hoá `Provider.config`
  (credential nhà cung cấp thật), `Resource.data` (dữ liệu tài khoản/proxy
  giao cho buyer) vẫn plaintext. Việc này tốn công hơn vì động tới 6+ nơi
  ghi/đọc (`resources/service.py`, `SellerPoolAdapter`, `orders/service.py`
  x2, `disputes/service.py`) và không giảm nhiều rủi ro vì vẫn phải giải mã
  ngay để trả cho buyer qua `Order.delivered_data`. Gộp chung với
  `Order.delivered_data` (spec `:452` yêu cầu "Marketplace lưu mã hoá", hiện là
  `Text` plaintext ở `models/order.py`).

- [ ] **Khái niệm "gian hàng" (Store)** tách khỏi `Account` — spec tách **hai**
  tầng (`scratch_9.md:462-464`, `:485-492`): `seller_profiles` (hồ sơ người bán)
  và `stores` (gian hàng, sở hữu Product). Hiện seller chỉ là 1 role trong
  `Account.roles`; "gian hàng" là view ảo ghép runtime từ Account +
  SellerApplication(approved) + Order + Product (`sellers/service.py`). Đã chốt:
  **1 seller có nhiều gian hàng**; ví/`seller_tier`/API key giữ ở tầng account,
  gian hàng chỉ là mặt tiền. Tách làm 2 item:
  - [ ] **`seller_profiles`** (nhỏ, gỡ được cái đau hiện tại) — `business_name`/
    `description` đang đọc từ đơn approved gần nhất (`sellers/service.py:49-59`,
    `:91-97`) nên seller **chỉ set được 1 lần lúc `POST /seller/apply`**, sau khi
    admin duyệt thì không sửa được (không có `PATCH /seller/profile`, không có
    trang FE). Tiện tay: tên đang fallback `email.split("@")[0]`
    (`sellers/[id]/page.tsx:112`) → lộ local-part email ra trang công khai.
  - [ ] **`stores`** (lớn) — `Product.store_id` thành khoá sở hữu, `seller_id`
    thành dẫn xuất. Cảnh báo: `seller_id` đang dùng ở **132 chỗ / 19 file**
    (`orders/`, `products/`, `resources/`, `disputes/`, `wallet/`, `sellers/`,
    `alerts/`, `scheduler.py`), và `Order`/`Resource` cũng mang `seller_id`. Spec
    `:388-406` còn cho "Tạo gian hàng" là một bước riêng trong onboarding, giữa
    "Xác minh thông tin" và "Tạo sản phẩm" — hiện không có bước này.
- [ ] **Trang nhắn tin buyer ↔ seller** — không có model `Message`, nút
  "Nhắn tin" trên trang sản phẩm hiện chưa có chức năng thật.
- [ ] **Trang khuyến mãi cho seller** (`/seller/promotions`).
- [ ] **Rate-limit cho API key seller** — thao tác ghi qua API key (accept/
  deliver/nạp tài nguyên) đã mở, nhưng CHƯA có rate-limit. Một script lỗi
  phía seller có thể spam endpoint ghi. Nên làm trước khi mở API cho seller
  thật (Redis đã có sẵn trong stack, dùng làm counter được).
- [ ] **Webhook đẩy sự kiện đơn hàng** — hiện seller phải poll
  `GET /seller/orders`. Webhook (`POST` tới URL seller khai báo khi có đơn
  mới) mới là thứ giảm độ trễ xử lý thật sự.
- [ ] **Scope/quyền hạn theo từng API key** — 1 key hiện có toàn quyền trong
  phạm vi 4 endpoint đã whitelist. Thêm scope (`read:orders`, `write:orders`,
  `write:resources`) để seller tự giới hạn quyền, giảm thiệt hại nếu key lộ.

## Verification

Xem lại cách test thủ công từng luồng (login demo, tạo đơn test, gọi API
trực tiếp) trong lịch sử trò chuyện đã thực hiện đợt 1 — dùng tài khoản demo
`admin@dxtrade.example.com` / `seller@dxtrade.example.com` /
`buyer@dxtrade.example.com`, mật khẩu `DemoPass123!` (từ
`marketplace-svc/scripts/seed_demo.py`).
