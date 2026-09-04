# Luồng khiếu nại (đơn giản)

Tiền mua hàng nằm trong **ký quỹ (escrow)** cho đến khi đơn hoàn tất. Khiếu nại **không đổi trạng thái đơn** (`delivered` vẫn là `delivered`); nó chỉ **tạm dừng** việc tự trả tiền cho seller.

Hàng digital đã giao rồi thì buyer **đã cầm** acc/proxy. Khiếu nại là giữ tiền, không phải tự hoàn.

Chi tiết invariant: `marketplace-svc/ARCHITECTURE.md` (Dispute settlement). Checklist: `WARRANTY.md`.

## 1. Mở case

Buyer chỉ mở được khi đơn **đã giao** và **còn trong hạn escrow**.

- Chọn **acc cụ thể** (ví dụ 99/100): mỗi acc chỉ claim một lần; có thể thêm batch sau.
- Không chọn acc: khiếu nại **cả gói** (proxy/task hoặc toàn đơn).

Một đơn chỉ có **một case đang mở**.

## 2. Trong lúc case mở

| Việc | Kết quả |
|---|---|
| Buyer xác nhận đơn / job hết hạn escrow | **Không chạy** — tiền vẫn trong escrow |
| Seller hoàn từng acc | Tiền acc đó về buyer ngay. Acc đánh dấu `error` |
| Seller đổi acc | Acc mới gán vào đơn; **không** trừ escrow |
| Seller chỉ nhắn | Timeline có reply. **Không** tự chia tiền |
| Buyer nhắn | Case tiếp tục. **Không** xóa đồng hồ A, không gia hạn đồng hồ B |
| Buyer claim acc bảo hành (gen 1) | Case tiếp tục; xóa đồng hồ A; seller phải xử lý acc mới |
| Buyer claim acc thay thế lần 2 | Từ chối — Accept hoặc chat Marketplace |
| Chat Marketplace | Ghi chú bắt buộc + idempotency. Pause đồng hồ A/B (`review_requested_at`). Admin chốt tiền trên `/admin/disputes` (tab Chờ review); chat tại `/admin/support`. Không tự hoàn |
| Buyer rút case (chưa có remedy acc) | Case đóng. Escrow chưa hết → đơn vẫn `delivered`. Escrow đã hết → trả remaining cho seller ngay |
| Admin reject / refund / partial / replace | Admin chốt, settle remaining |

Seller **không** hoàn/đổi acc chưa được claim.

## 3. Hai đồng hồ tự đóng

### A. Seller đã xử lý xong — chờ buyer

Bật khi:

- Instant: **mọi** acc đã claim đều đã hoàn hoặc đổi, hoặc
- Case không có acc: seller đã **nhắn** (proxy/task / cả gói)

Buyer có `DISPUTE_RESOLUTION_TIMEOUT_HOURS` (mặc định 24h). Hết hạn mà buyer không accept / không claim acc bảo hành / không mở chat Marketplace → `resolved_timeout`, **phần escrow còn lại về seller**.

Chỉ claim batch mới tắt đồng hồ A. Chat case không tắt. Chat Marketplace pause cả hai đồng hồ đến khi admin chốt.

Hoàn **hết** số tiền đơn → đóng ngay `resolved_refund`, không chờ buyer.

### B. Không ai xử lý acc — buyer bỏ cuộc

Bật khi case **còn mở**, **chưa** có hoàn/đổi acc, **chưa** bật đồng hồ A.

Mốc: `max(hết hạn escrow, lần buyer mở case/claim batch cuối) + DISPUTE_ABANDON_GRACE_HOURS` (mặc định 24h). Chat không đổi mốc này.

Hết mốc → `resolved_abandoned`, **cả remaining escrow về seller**. Claim 99/100 rồi im **không** tự hoàn 99.

Seller chỉ chat **không** chặn đồng hồ này. Buyer chat sau hạn escrow cũng không cộng thêm thời gian; chỉ claim batch mới mới cộng thêm 24h. Vì mỗi acc chỉ claim một lần trong case, không thể giữ escrow vô hạn bằng chat.

Có hoàn/đổi acc rồi thì dùng đồng hồ A hoặc admin, không dùng B.

## 4. Tiền lúc đóng

Luôn: **seller nhận `total_amount - refunded_amount`** (trừ phí nền tảng). Buyer chỉ nhận phần đã refund từng acc hoặc admin hoàn.

Ví dụ đơn 100 acc, giá đều:

| Việc đã xảy ra | Buyer | Seller |
|---|---|---|
| Claim 99, không ai làm, hết đồng hồ B | 0 hoàn | 100 |
| Seller hoàn 99, buyer im hết đồng hồ A | 99 | 1 |
| Seller đổi 99, buyer im hết đồng hồ A | 0 hoàn | 100 (seller đã tốn 99 acc kho) |
| Buyer rút trước khi seller remedy, escrow còn hạn | 0 hoàn | chờ hết escrow như đơn thường |
| Admin reject | 0 hoàn | remaining |
| Admin hoàn hết | remaining về buyer | 0 |

## 5. Việc từng vai

**Buyer:** mở đúng acc hỏng; nếu seller đã đổi acc thì Accept hoặc claim acc mới trước hạn A; chat case không gia hạn. Acc gen 2 hoặc seller im: chat Marketplace. Rút khi seller chưa remedy.

**Seller:** trong tab xử lý acc, search / chọn / chọn tất cả kết quả (kể cả ~1k acc, 100 dòng/trang). Acc đã hoàn/đổi hiện badge (kèm acc thay) và không chọn lại được. Đổi acc: lấy ngẫu nhiên từ kho, hoặc tự chọn đúng số acc kho. Hoàn tiền chỉ acc đã chọn. Mỗi lần hoàn/đổi, buyer và seller nhận thông báo; bấm vào mở dữ liệu bàn giao và highlight đúng acc. Đừng chỉ chat nếu muốn khóa đồng hồ B; xong hết acc claimed thì chờ buyer 24h. Timeline seller cùng dữ liệu với buyer: khi admin chốt, seller thấy remaining về mình hay phần nào đã hoàn cho buyer.

**Dữ liệu bàn giao:** acc đã hoàn / đã đổi / acc thay thế được gắn nhãn trên danh sách. `delivered_data` (sao chép/tải) chỉ còn acc đang assigned.

**Admin (`/admin/disputes`):** tab **Chờ review** khi `review_requested_at` đã set. Vào khi hai bên còn tranh, seller im mà buyer vẫn bám, hoặc đã có remedy dở. Hoàn / từ chối / hoàn một phần / đổi / gia hạn. Timeline buyer hiện đúng outcome (kèm số tiền hoàn), không hiện “chờ seller” sau khi case đã đóng. Chat các bên ở `/admin/support`. Không hoàn 99 chỉ vì seller chậm nếu không có evidence.

## 6. Việc hệ thống không làm

- Không tự hoàn phần đã claim khi hết escrow.
- Không trả 1 acc chưa claim trong khi 99 còn dispute (một case mở = chưa release escrow đơn).
- Không cho buyer accept khi còn acc claimed chưa remedy.
- Không cho buyer rút sau khi seller đã hoàn/đổi acc.
