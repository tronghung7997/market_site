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

- Không có endpoint từ chối yêu cầu rút tiền — `WithdrawStatus.rejected` có
  trong enum (`marketplace-svc/src/models/wallet.py`) nhưng
  `wallet/service.py` chỉ có `approve_withdrawal`, không có hàm reject.
- `Dispute.order_id` có `unique=True` → sau khi resolve bằng "đổi sản phẩm"
  hoặc "gia hạn bảo hành" (đưa order về lại `delivered` để buyer xác nhận
  lại), buyer **không thể mở khiếu nại lần 2** trên cùng đơn đó vì
  `create_dispute` chặn dispute trùng theo `order_id`. Buyer vẫn xác nhận
  đơn bình thường được, chỉ là không dispute lại được.
- Dispute #4 (order #24, dữ liệu demo cũ) lỗi khi tải chi tiết trong panel
  admin ("Không thể tải thông tin khiếu nại") — bug có từ trước, không liên
  quan tới thay đổi trong đợt 1, chưa điều tra nguyên nhân gốc.
- `marketplace-svc/src/providers/router.py:64` (`detail=str(e)`) vẫn có thể
  trả message tiếng Anh động — endpoint test provider, chỉ admin dùng, để
  nguyên vì message tới từ exception runtime, không phải chuỗi tĩnh.

## Checklist các đợt sau (chưa làm)

- [ ] **Mô hình số dư 3 lớp** (`pending_balance`/`available_balance`/
  `locked_balance`) thay cho `Wallet.balance` đơn — đổi cấu trúc dữ liệu
  tiền cốt lõi, cần thiết kế migration + audit kỹ, không làm chung đợt nhỏ.
- [ ] **API tích hợp seller ngoài thật** — chỉ có 3 adapter hiện tại
  (`mock`, `seller_pool`, `manual` trong `marketplace-svc/src/adapters/`),
  chưa có adapter gọi API thật (`topproxy`/`scrapecreators` mới là tên gợi ý
  trong tài liệu vận hành, chưa có file nào). Cần thêm idempotency key khi
  gọi API ngoài, và mã hoá credential trước khi lưu `Resource.data` (hiện
  lưu plaintext).
- [ ] **Phân cấp seller** (New/Verified/Trusted/Enterprise) ảnh hưởng hạn
  mức doanh thu, thời gian giữ tiền, phí, quyền API.
- [ ] **Khái niệm "gian hàng" (Store)** tách khỏi `Account` — profile riêng
  (tên, mô tả, banner), hiện seller chỉ là 1 role gắn thẳng vào account.
- [ ] **Trang nhắn tin buyer ↔ seller** — không có model `Message`, nút
  "Nhắn tin" trên trang sản phẩm hiện chưa có chức năng thật.
- [ ] **Trang khuyến mãi cho seller** (`/seller/promotions`).
- [ ] **Trang cài đặt API cho seller lớn** tự tích hợp (`/seller/api-settings`).
- [ ] **Bằng chứng tranh chấp theo loại sản phẩm** — hiện chỉ có 1 field
  `reason` dạng text tự do, chưa có bộ tiêu chí riêng theo proxy/license/...
- [ ] **Trang seller theo dõi lịch sử rút tiền của chính mình** — đợt 1 chỉ
  làm nút gửi yêu cầu, chưa có trang xem lại trạng thái từng yêu cầu.
- [ ] **Endpoint từ chối yêu cầu rút tiền** (xem mục "hạn chế đã biết" ở trên).

## Verification

Xem lại cách test thủ công từng luồng (login demo, tạo đơn test, gọi API
trực tiếp) trong lịch sử trò chuyện đã thực hiện đợt 1 — dùng tài khoản demo
`admin@dxtrade.example.com` / `seller@dxtrade.example.com` /
`buyer@dxtrade.example.com`, mật khẩu `DemoPass123!` (từ
`marketplace-svc/scripts/seed_demo.py`).
