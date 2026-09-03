# Hướng dẫn vận hành nền tảng — Buyer / Seller / Admin

Tài liệu vận hành đơn giản cho 3 vai trò. Cập nhật 2026-07-03, phản ánh
luồng đã kiểm thử end-to-end (đơn takedown #33 trên môi trường dev).

## Dòng tiền — nguyên tắc chung

```
Buyer nạp ví ──> Mua hàng: trừ ví, tiền vào ký quỹ (escrow)
                    │
                    ├─ Giao thành công ──> hết hạn escrow HOẶC buyer bấm
                    │                      "Xác nhận" ──> tiền về seller
                    ├─ Task fail một phần ──> hoàn tỉ lệ về ví buyer,
                    │                          phần còn lại vẫn giao
                    └─ Thất bại / huỷ ──> hoàn 100% về ví buyer
```

- Giá luôn tính bởi **một engine duy nhất**: giá xem trước trên form mua
  = giá trừ ví, không lệch.
- 4 kiểu giá: **Cố định** (mua đứt × số lượng), **Cấu hình**
  (proxy/cloud: loại × mạng × thời hạn × số lượng), **Credit** (gói
  request), **Tác vụ** (takedown: đơn giá × hệ số nền tảng × **số URL**).

---

## 1. Buyer — người mua

1. **Đăng ký / đăng nhập** tại `/register`, `/login`.
2. **Nạp ví**: trang `/wallet` (demo: admin nạp hộ qua Wallet topup).
3. **Chọn sản phẩm**: duyệt `/` hoặc `/categories`, mở trang sản phẩm.
4. **Cấu hình đơn**: form sinh tự động theo kiểu giá của sản phẩm:
   - Takedown: chọn nền tảng (Tiktok/Youtube/Facebook…) và dán **mỗi
     dòng một URL** — không có ô số lượng, giá tính theo số URL, đủ
     ngưỡng sẽ tự áp giảm giá số lượng lớn.
   - Proxy/Cloud: chọn loại, nhà mạng, thời hạn, số lượng.
   - Account/Asset: chọn variant + số lượng.
5. **Xem giá "Tổng cộng"** (tự tính khi gõ) → **Đặt hàng** → xác nhận.
6. **Theo dõi đơn** ở `/orders`. Ý nghĩa trạng thái:
   | Trạng thái | Nghĩa | Việc cần làm |
   |---|---|---|
   | Đang xử lý (processing) | Team/hệ thống đang thực hiện (takedown chờ xử lý từng URL) | Chờ |
   | Đã giao (delivered) | Hàng đã giao, đang trong ký quỹ | Kiểm tra hàng |
   | Hoàn tất (completed) | Buyer đã xác nhận, tiền về seller | — |
   | Đã huỷ / hoàn tiền | Giao thất bại, tiền đã về ví | Kiểm tra ví |
7. **Nhận hàng**: bấm **Xác nhận** trên đơn `delivered` để kết thúc sớm,
   hoặc để escrow tự hết hạn (số ngày ghi trên sản phẩm).
   Có vấn đề → mở **Khiếu nại** trên đơn. Luồng đầy đủ (claim acc,
   seller hoàn/đổi, hai đồng hồ tự đóng, tiền remaining):
   `docs/dispute-flow.md`.
8. Takedown fail một phần: hệ thống tự hoàn tiền phần URL không xử lý
   được về ví — không cần khiếu nại.

---

## 2. Seller — người bán

1. **Đăng ký buyer** trước, rồi nộp đơn làm seller (`POST /seller/apply`
   — UI trang seller). Chờ admin duyệt.
2. **Tạo sản phẩm**: `/seller/products/new` — đặt tiêu đề, danh mục,
   `service_type`, số ngày ký quỹ, variant + giá (kiểu Cố định).
3. **Nạp kho** (hàng giao ngay): upload resource (tài khoản, key…) vào
   variant — hệ thống tự phát khi có đơn (Seller Pool).
4. **Đơn thủ công**: xem `/seller/orders`, bấm **Accept** rồi
   **Deliver** kèm dữ liệu giao.
5. **Doanh thu**: tiền vào ví seller khi buyer xác nhận hoặc escrow hết
   hạn. Đơn đang khiếu nại **không** tự trả khi hết escrow — xem
   `docs/dispute-flow.md`. Theo dõi ở `/seller` (stats) và `/wallet`.
6. Lưu ý: giá kiểu Cấu hình/Credit/Tác vụ do **admin** cấu hình ở tầng
   vận hành; seller chỉ quản variant giá cố định của mình.

---

## 3. Admin — vận hành nền tảng

### Việc hằng ngày

1. **`/admin/tasks` — xử lý takedown (quan trọng nhất)**
   - Mỗi URL của đơn takedown = 1 tác vụ. Cột "Đơn hàng" hiển thị luôn
     trạng thái đơn.
   - Nhận việc: mở tác vụ → điền "Người xử lý" → trạng thái
     `Đang xử lý`.
   - Xong 1 URL → `Hoàn thành` (+ ghi kết quả vào result_data).
     Không xử lý được → `Thất bại`.
   - **Tự động**: khi tác vụ cuối của đơn kết thúc — tất cả hoàn thành
     → đơn chuyển `Đã giao` + bắt đầu ký quỹ; fail một phần → hệ thống
     tự hoàn tiền tỉ lệ cho buyer, phần còn lại vẫn giao; fail hết →
     huỷ đơn + hoàn đủ. Có thông báo "Đơn #X chuyển sang …" ngay khi lưu.
2. **`/admin/orders`** — theo dõi đơn, xử lý khiếu nại ở `/admin/disputes`.
   Case buyer/seller im sau hạn escrow tự đóng về seller; admin chỉ vào
   khi còn tranh chấp. Chi tiết: `docs/dispute-flow.md`.
3. **`/admin/alerts`** — cảnh báo provider lỗi / backlog tác vụ cao.

### Quản lý nhà cung cấp & giá — `/admin/providers`

- Mỗi provider có **adapter** quyết định cách giao hàng:
  | Adapter | Cách giao | Dùng cho |
  |---|---|---|
  | mock | Dữ liệu giả, giao ngay | dev/demo |
  | seller_pool | Phát từ kho seller upload | account, asset |
  | manual | Tạo tác vụ cho team xử lý, đơn chờ ở `processing` | takedown |
  | topproxy / scrapecreators | API ngoài (giai đoạn 2) | proxy, endpoint |
- **Gắn sản phẩm ↔ provider**: mở provider → tab "Sản phẩm liên kết" →
  chọn sản phẩm → **Gắn** (dropdown ghi rõ sản phẩm đang thuộc provider
  nào). **Tháo** để gỡ. Sản phẩm takedown phải gắn provider adapter
  `manual` — gắn nhầm mock sẽ "giao" ngay mà không ai xử lý.
- **Sửa giá sản phẩm**: nút "Sửa giá" trên từng dòng → chọn strategy +
  sửa `pricing_params` (JSON) → **Tính thử** với config mẫu để xem giá
  trước khi **Lưu**. Ví dụ params takedown:
  ```json
  {
    "base_price": 500000,
    "platform_mult": {"Tiktok": 1.5, "Youtube": 1.5, "Facebook": 1.2},
    "volume_tiers": [{"min_qty": 5, "discount": 0.1}]
  }
  ```
- **Thứ tự ưu tiên giá**: sản phẩm có strategy riêng → dùng nó; chưa có
  → lấy mặc định theo `service_type` trong bảng `pricing_configs`;
  không có nữa → giá cố định theo variant.
- **Test provider**: nút Test trên card = kiểm tra health; provider có
  fallback sẽ tự chuyển khi tắt (`is_active = false`).

### Việc khác

- **Duyệt seller**: `/admin/accounts` + danh sách đơn xin làm seller.
- **Nạp ví hộ** (demo/hỗ trợ): Wallet topup theo account id.
- **Truy vết sự cố**: `/admin/logs` — lọc theo request_id / order_id;
  mọi bước của đơn (đặt, provision, chuyển trạng thái, hoàn tiền) đều
  có log.

---

## Checklist vận hành đơn takedown (tóm tắt 30 giây)

1. Admin: sản phẩm takedown đã gắn provider **manual** + strategy
   `task` (làm 1 lần).
2. Buyer: dán URL → thấy giá → mua → đơn `Đang xử lý`.
3. Admin: `/admin/tasks` xử lý từng URL → hoàn thành/thất bại.
4. Hệ thống: tự chuyển đơn `Đã giao` / hoàn tiền tỉ lệ / huỷ.
5. Buyer: xác nhận (hoặc chờ hết ký quỹ) → tiền về seller.

---

## Nạp ví — PayOS & USDT (NOWPayments)

- **PayOS (CKNH VND):** mặc định khi hiển thị tiền VND. Webhook
  `/webhooks/payos`; đối soát admin `/admin/deposits`.
- **USDT BEP20 (NOWPayments):** mặc định khi hiển thị USD (nếu
  `NOWPAYMENTS_ENABLED=true`). Buyer gửi đúng `pay_amount` trên mạng
  **BEP20** — không gửi ERC20/TRC20. IPN `/webhooks/nowpayments`.
- Ledger ví luôn **VND integer**; credit USDT = số VND đã chốt lúc tạo
  lệnh (sau khi payment `finished` + `actually_paid` hợp lệ).
- Outcome wallet merchant trên dashboard NOW: **USDT BEP20**.
- Rollback crypto: `NOWPAYMENTS_ENABLED=false` → chỉ còn PayOS.
- Runbook chi tiết:
  `docs/superpowers/plans/2026-08-12-nowpayments-sandbox-runbook.md`.
