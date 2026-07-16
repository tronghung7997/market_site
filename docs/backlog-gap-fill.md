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

## Checklist các đợt sau (chưa làm)

- [ ] **Mã hoá `Resource.data`** — đợt 3 chỉ mã hoá `Provider.config`
  (credential nhà cung cấp thật), `Resource.data` (dữ liệu tài khoản/proxy
  giao cho buyer) vẫn plaintext. Việc này tốn công hơn vì động tới 6+ nơi
  ghi/đọc (`resources/service.py`, `SellerPoolAdapter`, `orders/service.py`
  x2, `disputes/service.py`) và không giảm nhiều rủi ro vì vẫn phải giải mã
  ngay để trả cho buyer qua `Order.delivered_data`.
- [ ] **Khái niệm "gian hàng" (Store)** tách khỏi `Account` — profile riêng
  (tên, mô tả, banner), hiện seller chỉ là 1 role gắn thẳng vào account.
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
