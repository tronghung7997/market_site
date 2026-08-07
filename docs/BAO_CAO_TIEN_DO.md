# Báo cáo chức năng đã hoàn thành

| # | Dự án | Mô tả ngắn |
|---|---|---|
| **1** | Marketplace dịch vụ số | Chợ mua bán proxy / tài khoản / API / task; ví & escrow; seller–buyer–admin |
| **2** | Đăng bài & lên lịch đa nền tảng | Soạn bài, hẹn giờ, đăng thật FB / YT / TikTok, theo dõi job, retry & dự phòng |

---

# Dự án 1 — Marketplace dịch vụ số

Marketplace đứng giữa **người mua**, **seller** và **nhà cung cấp**: catalog, thanh toán, giữ tiền (escrow), giao tài nguyên, theo dõi sử dụng và xử lý sự cố. Phù hợp proxy, tài khoản, token, API/credit, dịch vụ xử lý theo task.

## 1.1. Ba vai trò

| Vai trò | Làm gì |
|---|---|
| **Người mua** | Duyệt chợ, nạp ví, đặt hàng, nhận tài nguyên, theo dõi đơn/credit, đánh giá, khiếu nại |
| **Seller** | Đăng ký–duyệt, SP/kho, nguồn cung, xử lý đơn, rút tiền, API tự động |
| **Admin** | Duyệt seller, user/SP/đơn/tiền, khiếu nại, provider, cảnh báo, vận hành |

Phân quyền tách khu vực theo vai trò.

## 1.2. Luồng giao dịch chính

```
Đăng nhập → Nạp ví → Chọn SP/gói → Báo giá
  → Đặt hàng (giữ tiền) → Giao tài nguyên
  → Kiểm tra → Xác nhận / Khiếu nại
  → Hoàn tất (trả seller − phí) hoặc Hoàn tiền
```

| Bước | Hệ thống làm gì |
|---|---|
| Đặt hàng | Trừ số dư, **giữ tiền** trong thời gian bảo vệ |
| Giao hàng | Từ **kho** / gọi **NCC** / **seller thủ công** |
| Sau giao | Buyer xác nhận sớm **hoặc** hết hạn bảo vệ → giải phóng tiền cho seller |
| Lỗi / hủy hợp lệ | Hoàn tiền ví buyer |
| Khiếu nại | Admin: hoàn full/partial, đổi SP, gia hạn, hoặc từ chối |

**Trạng thái đơn:** chờ xử lý → đang thực hiện → đã giao → hoàn tất / đã hủy.

## 1.3. Ví, nạp, rút, escrow

- Mỗi tài khoản một **ví**: số dư khả dụng + khoản đang khóa (rút).
- **Nạp:** admin cộng tay sau đối soát, hoặc **PayOS** (chống cộng lặp, đối soát lệnh chờ).
- **Escrow:** tiền không về seller ngay; chỉ khi đơn hoàn tất.
- **Rút (seller):** khóa tiền → admin duyệt / từ chối / đánh dấu đã chuyển.
- Lịch sử đầy đủ (nạp, mua, hoàn, hoa hồng, rút) lưu DB — không mất khi restart.

## 1.4. Sản phẩm, kho, giao hàng

**Quản lý (seller/admin):** tạo–sửa–xóa SP & gói, giá, hạn giao/sử dụng, auto/manual, gắn NCC, nhập/xuất kho, tồn theo trạng thái. Admin: danh mục, tạm ngừng SP.

**Catalog:** tên, mô tả, nhóm, seller, giá & tùy chọn, tồn, đánh giá, thời gian bảo vệ. **VI / EN**. SP ngừng bán ẩn khỏi chợ.

| Cách giao | Mô tả |
|---|---|
| Từ kho | Gán tài nguyên còn trống |
| Nhà cung cấp | API ngoài (TopProxy, DProxy, gateway, webhook seller, …) |
| Thủ công | Seller nhận đơn và cập nhật kết quả |

| Trạng thái tài nguyên | Ý nghĩa |
|---|---|
| Còn hàng | Trong kho, bán được |
| Đã gán | Đã giao cho đơn |
| Hết hạn | Job tự đánh dấu hết hạn |
| Lỗi | Không bán tiếp |

Tồn thấp → cảnh báo. Cấp phát gián đoạn → retry; chờ quá lâu → hoàn tiền / cảnh báo admin.

## 1.5. Loại dịch vụ & giá

| Loại | Điểm nổi bật |
|---|---|
| **Proxy** | Trạng thái/hạn, whitelist IP, xoay/đổi, đối soát NCC |
| **API / credit** | Trừ credit mỗi lần gọi; khóa Proxora (không lộ khóa seller); đổi/thu hồi |
| **Task** | Một đơn → nhiều tác vụ; chờ/đang làm/xong/lỗi; task chậm được đánh dấu |

**Giá:** cố định · theo cấu hình · theo credit · theo công việc · giảm số lượng. Báo giá trước mua; tính lại khi tạo đơn; kiểm tra khớp loại NCC.

## 1.6. Seller: đăng ký, hạng, uy tín

1. Buyer gửi hồ sơ → admin duyệt / từ chối (có lý do).
2. **Hạng** (mới / uy tín / enterprise): quyền nâng cao, phí, thời gian giữ tiền.
3. Hạng đủ → tự kết nối nguồn cung + **API key** seller.
4. Đơn hoàn tất → buyer **đánh giá** (1 lần/đơn) → điểm SP.
5. **Hồ sơ công khai:** giới thiệu, hạng, SP/đơn, điểm.

## 1.7. Nhà cung cấp

- Nhiều nguồn: kho seller, thủ công, API ngoài, DProxy, TopProxy, webhook.
- SP có nguồn chính + có thể **nguồn dự phòng**.
- Seller đăng ký nguồn → **admin duyệt** trước khi bán.
- Health: kết nối, latency, success rate; lỗi liên tiếp → tạm ngừng + cảnh báo.
- **Điểm chất lượng** để admin ưu tiên nguồn; theo dõi credit NCC trả trước.

## 1.8. Khiếu nại, affiliate, dashboard

**Khiếu nại:** buyer mở + bằng chứng → seller phản hồi → admin xử lý → cập nhật đơn/ví/lịch sử.

**Affiliate:** mã/link → track click/đăng ký → hoa hồng khi đủ điều kiện; chống click lặp; admin quản quỹ.

| Dashboard buyer | Seller | Admin |
|---|---|---|
| Đơn, chờ xác nhận | Doanh thu, đơn chờ giao | Hồ sơ seller chờ |
| Sắp hết bảo vệ / credit | Tồn thấp, khiếu nại | Khiếu nại / rút chờ |
| Phản hồi khiếu nại | Cảnh báo NCC, rút tiền | Task treo, cảnh báo HT |

## 1.9. API seller, bảo mật, vận hành

**API seller:** list/nhận đơn, giao hàng, nhập kho, cập nhật task; key 1 lần, thu hồi được; **ký request**.

**Bảo mật (tóm tắt):** phân quyền 3 vai · mã hóa/che secret NCC · không lộ khóa seller · verify webhook · rate limit · chống double-credit · retry sau restart · audit log.

**Cảnh báo:** tồn/credit thấp, NCC lỗi, cấp phát fail/chậm, seller chậm, lỗi hoàn/giải phóng, nạp lệch, sự cố lặp (gộp trùng).

**Job định kỳ:** giải phóng escrow · hoàn đơn quá hạn · retry cấp phát · hết hạn TN · health + chấm điểm NCC · cảnh báo tồn · đối soát nạp/proxy · task chậm · dọn log.

## 1.10. Giao diện (map nhanh)

| Khu vực | Nội dung |
|---|---|
| Marketplace | Trang chủ, danh mục, SP, hồ sơ seller, đặt hàng |
| Tài khoản | Đăng ký/đăng nhập, đăng ký seller |
| Ví | Số dư, nạp, lịch sử, affiliate |
| Đơn mua | Trạng thái, dữ liệu giao, dashboard dịch vụ, đánh giá, khiếu nại |
| Seller | Dashboard, SP, kho, đơn, NCC, API, rút tiền |
| Admin | User, SP, đơn, tiền, khiếu nại, provider, cảnh báo, log |

UI theo vai trò; **tiếng Việt + tiếng Anh**.

### Tóm tắt dự án 1

| Khối | Đã có |
|---|---|
| Thị trường | Catalog, danh mục, gói, i18n, hồ sơ & đánh giá seller |
| Người bán | Đăng ký–duyệt–hạng, SP/kho, NCC, API, rút tiền |
| Mua & tiền | Ví, PayOS/admin nạp, báo giá, escrow, hoàn, lịch sử |
| Giao hàng | Kho / API NCC / thủ công; vòng đời TN; retry & timeout |
| Dịch vụ | Proxy, credit/API, task; nhiều mô hình giá |
| Sau bán | Khiếu nại workflow, affiliate |
| Vận hành | Dashboard 3 vai, cảnh báo, job, health NCC, audit |
| An toàn | Phân quyền, secret, webhook ký, rate limit, chống lặp |

---

# Dự án 2 — Hệ thống đăng bài & lên lịch đa nền tảng

## 2.1. Đăng bài lên mạng xã hội

- Đăng bài lên **Facebook, YouTube và TikTok** từ một hệ thống chung.
- Hỗ trợ đăng bằng tài khoản/API của từng nền tảng, hoặc đăng qua trình duyệt đã đăng nhập sẵn.
- Đăng **ngay** hoặc **hẹn giờ** (chọn ngày giờ và múi giờ).
- Một bài có thể gửi lên **nhiều kênh cùng lúc**.
- Đính kèm ảnh/video khi soạn bài.
- Đã đăng thử thành công thật lên cả ba nền tảng.

## 2.2. Lên lịch đăng bài

- Đặt lịch theo giờ cụ thể, có hỗ trợ múi giờ.
- Xem toàn bộ bài đã lên lịch trên **lịch tổng quan** (calendar).
- Đến giờ hệ thống tự đăng, không cần thao tác lại.

## 2.3. Theo dõi trạng thái đăng

- Mỗi lần đăng tạo một **job** với trạng thái: đang chờ, đang xử lý, thành công, thất bại, đang thử lại.
- Theo dõi từng bước trên UI, **tự cập nhật** (không cần reload).
- Thử lại thủ công nếu job nằm trong danh sách lỗi.
- Xem log / lịch sử; tra theo bài hoặc theo kênh.

## 2.4. Xử lý khi đăng bị lỗi

- **Tự thử lại** vài lần nếu đăng lỗi (backoff tăng dần).
- Sau nhiều lần vẫn lỗi: giữ job để kiểm tra, có cảnh báo.
- API nền tảng lỗi → **tự chuyển dịch vụ dự phòng** để vẫn cố đăng được.
- Có màn hình theo dõi khi đang dùng kênh/dịch vụ dự phòng.

## 2.5. Quản lý kênh kết nối

- Thêm, xem, xoá kênh Facebook / YouTube / TikTok.
- Kiểm tra kết nối kênh còn sống hay không.
- Biết kênh nào đang dùng đường đăng dự phòng.

## 2.6. Giao diện quản trị

| Màn hình | Làm được gì |
|---|---|
| Danh sách bài viết | Xem, lọc theo kênh / trạng thái / thời gian |
| Soạn & sửa bài | Nội dung, media, chọn kênh, đăng ngay hoặc hẹn giờ |
| Lịch tổng quan | Toàn bộ bài đã lên lịch theo ngày |
| Theo dõi job | Tiến trình đăng từng kênh, realtime |
| Quản lý kênh | Kết nối và kiểm tra tài khoản MXH |
| Log & lịch sử | Tra cứu xử lý theo bài / kênh |
| Giám sát dự phòng | Biết khi hệ thống đang dùng đường đăng thay thế |

**Luồng chính E2E:** tạo bài → lên lịch hoặc đăng ngay → theo dõi kết quả.

## 2.7. Phần comment (chưa có backend thật)

- Có màn **quản lý comment** đa nền tảng (demo UI): danh sách, duyệt, ẩn, trả lời theo kịch bản.
- Chưa đồng bộ comment thật từ FB / YT / TikTok; chưa tự trả lời trên nền tảng.

### Tóm tắt dự án 2

Đã có: **soạn bài, hẹn giờ, đăng thật 3 nền tảng, job realtime, retry + fallback, quản lý kênh, lịch sử** — qua web UI.  
Chưa có: mạng lưới comment / tương tác thật (mới UI minh họa).

---

# Tóm tắt chung hai dự án

| | Dự án 1 — Marketplace | Dự án 2 — Publishing |
|---|---|---|
| **Người dùng** | Buyer · Seller · Admin | Người vận hành đăng bài đa kênh |
| **Giá trị cốt lõi** | Mua bán dịch vụ số an toàn (escrow) | Soạn–lịch–đăng–theo dõi 1 chỗ |
| **Đã chạy thật** | Luồng marketplace end-to-end (ví, đơn, giao, hoàn) | Đăng FB / YT / TikTok |
| **Tự động hóa** | Job định kỳ, health NCC, retry cấp phát | Scheduler, retry, fallback |
| **Còn mở** | (tuỳ giai đoạn tiếp theo theo backlog sản phẩm) | Comment/tương tác thật |
