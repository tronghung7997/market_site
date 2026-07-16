Luồng cốt lõi

Người mua
↓
Trang trung gian
↓
Người bán

Nhưng để vận hành an toàn, nên triển khai thành:

Người mua
↓
Tìm kiếm / chọn sản phẩm
↓
Đặt hàng và thanh toán
↓
Trang trung gian giữ tiền
↓
Người bán giao dịch vụ
↓
Người mua kiểm tra``
↓
Xác nhận hoàn tất
↓
Trang trung gian thanh toán cho người bán

Đây là mô hình marketplace có escrow, thay vì chỉ chuyển khách hàng trực tiếp cho người bán.

⸻

1. Các vai trò

Người mua

* Tìm kiếm dịch vụ.
* So sánh người bán.
* Đặt hàng.
* Thanh toán.
* Nhận tài khoản, proxy, VPN, SSH hoặc license.
* Khiếu nại nếu sản phẩm không đúng mô tả.
* Đánh giá người bán.

Người bán

* Tạo gian hàng.
* Đăng sản phẩm.
* Quản lý tồn kho.
* Tiếp nhận đơn hàng.
* Giao hàng tự động hoặc thủ công.
* Xử lý bảo hành, đổi sản phẩm.
* Rút số dư.

Trang trung gian

* Quản lý danh mục.
* Kiểm duyệt người bán và sản phẩm.
* Thu tiền từ người mua.
* Giữ tiền chờ hoàn tất.
* Điều phối giao hàng.
* Quản lý tranh chấp.
* Thu phí nền tảng.
* Thanh toán lại cho người bán.

⸻

2. Luồng mua hàng chính

1. Người mua chọn sản phẩm
2. Chọn số lượng, thời hạn và biến thể
3. Hệ thống kiểm tra tồn kho
4. Tạo đơn hàng
5. Người mua thanh toán
6. Tiền được ghi nhận vào escrow
7. Hệ thống gửi yêu cầu giao hàng cho người bán
8. Người bán hoặc hệ thống giao sản phẩm
9. Người mua nhận và kiểm tra
10. Đơn hàng chuyển sang hoàn tất
11. Tiền được cộng vào số dư khả dụng của người bán
12. Nền tảng giữ lại phí giao dịch

Trạng thái đơn hàng

DRAFT
→ PENDING_PAYMENT
→ PAID
→ PROCESSING
→ DELIVERED
→ COMPLETED

Các nhánh ngoại lệ:

PAID → CANCELLED → REFUNDED
DELIVERED → DISPUTED
DISPUTED → REFUNDED
DISPUTED → COMPLETED

⸻

3. Hai hình thức giao hàng

Giao hàng tự động

Phù hợp với:

* Proxy.
* VPN.
* SSH.
* License key.
* Tài khoản đã được nhập sẵn.
* Mã kích hoạt.
* File cấu hình.

Luồng:

Thanh toán thành công
↓
Hệ thống lấy một item còn tồn kho
↓
Đánh dấu item đã bán
↓
Hiển thị thông tin cho người mua
↓
Bắt đầu thời gian bảo hành

Ví dụ với proxy:

host: proxy.example.com
port: 12001
username: buyer123
password: ****
expires_at: 2026-08-14

Giao hàng thủ công

Phù hợp với:

* Tài khoản cần tạo theo yêu cầu.
* Dịch vụ setup VPN riêng.
* SSH/VPS tùy chỉnh.
* License cần đăng ký thông tin khách hàng.
* Dịch vụ yêu cầu trao đổi với người bán.

Luồng:

Thanh toán thành công
↓
Tạo workspace trao đổi
↓
Người mua gửi yêu cầu
↓
Người bán chuẩn bị sản phẩm
↓
Người bán bấm “Đã giao”
↓
Người mua xác nhận

⸻

4. Trang trung gian không nên chỉ là trang listing

Nền tảng nên đứng giữa cả ba luồng:

Luồng thông tin
Người mua ↔ Nền tảng ↔ Người bán
Luồng tiền
Người mua → Nền tảng giữ tiền → Người bán
Luồng sản phẩm
Người bán → Kho hàng nền tảng → Người mua

Với giao hàng tự động, người mua không nhất thiết phải biết hệ thống nội bộ của người bán.

Nền tảng có thể chuẩn hóa mọi sản phẩm thành một cấu trúc chung:

Product
├── Loại dịch vụ
├── Biến thể
├── Giá
├── Thời hạn
├── Số lượng
├── Cách giao hàng
├── Chính sách bảo hành
└── Dữ liệu sau giao hàng

⸻

5. Mô hình sản phẩm đa loại

Không nên tạo một bảng riêng hoàn toàn cho từng loại sản phẩm. Nên dùng một lõi chung và phần thuộc tính mở rộng.

Product
├── id
├── seller_id
├── category_id
├── name
├── description
├── delivery_type
├── warranty_period
├── status
└── metadata

Ví dụ metadata:

Social account

{
"platform": "Facebook",
"country": "US",
"age_days": 365,
"email_included": true,
"two_factor": false
}

Proxy

{
"protocol": ["http", "socks5"],
"country": "VN",
"network_type": "mobile",
"rotation": "static",
"bandwidth_limit": "unlimited"
}

VPN

{
"protocol": "WireGuard",
"location": "Singapore",
"traffic_limit_gb": 500,
"max_devices": 3
}

SSH

{
"country": "Germany",
"operating_system": "Ubuntu",
"cpu": 2,
"ram_gb": 4,
"duration_days": 30
}

Software license

{
"software": "Example App",
"license_type": "subscription",
"duration_days": 365,
"max_devices": 1
}

⸻

6. Cấu trúc trang chính

Trang người mua

Trang chủ
├── Thanh tìm kiếm
├── Danh mục dịch vụ
├── Sản phẩm nổi bật
├── Người bán uy tín
└── Đơn hàng gần đây

Danh mục:

Social Accounts
Proxy
VPN
SSH / VPS
Software
Licenses
Digital Services

Trang chi tiết sản phẩm:

Tên sản phẩm
Đánh giá người bán
Giá và biến thể
Tồn kho
Mô tả
Phương thức giao hàng
Thời gian giao hàng
Chính sách bảo hành
Nút mua ngay

Dashboard người bán

Tổng quan
├── Doanh thu
├── Đơn hàng mới
├── Tỷ lệ hoàn thành
├── Tỷ lệ tranh chấp
└── Số dư khả dụng
Sản phẩm
Kho hàng
Đơn hàng
Tin nhắn
Khuyến mãi
Rút tiền
Đánh giá
Cài đặt API

Trang quản trị nền tảng

Người dùng
Người bán
Sản phẩm
Đơn hàng
Thanh toán
Escrow
Tranh chấp
Rút tiền
Phí nền tảng
Kiểm duyệt
Nhật ký hệ thống

⸻

7. Luồng tiền

Ví dụ đơn hàng 100.000 VNĐ:

Người mua thanh toán: 100.000
Phí nền tảng 8%: 8.000
Người bán nhận: 92.000

Các loại số dư:

pending_balance
Tiền đang chờ đơn hàng hoàn tất
available_balance
Tiền người bán có thể rút
locked_balance
Tiền đang bị khóa do tranh chấp

Luồng:

Thanh toán
→ pending_balance
Đơn hoàn tất
→ available_balance
Có tranh chấp
→ locked_balance

Không nên cộng tiền trực tiếp vào số dư rút được ngay sau khi khách thanh toán.

⸻

8. Luồng tranh chấp

Người mua mở khiếu nại
↓
Tiền đơn hàng bị khóa
↓
Người mua gửi bằng chứng
↓
Người bán phản hồi
↓
Nền tảng xem xét

Kết quả:

Hoàn tiền toàn bộ
Hoàn tiền một phần
Đổi sản phẩm
Gia hạn bảo hành
Thanh toán cho người bán

Mỗi loại sản phẩm cần quy định bằng chứng khác nhau.

Ví dụ proxy:

* Không kết nối được.
* Sai quốc gia.
* Không đúng protocol.
* Hết hạn trước thời gian.
* IP đã bị thay đổi trái mô tả.

Ví dụ license:

* Key không kích hoạt được.
* Sai phiên bản.
* Key đã được sử dụng.
* Thời hạn không đúng.

⸻

9. Luồng người bán đăng sản phẩm

Đăng ký tài khoản
↓
Đăng ký trở thành người bán
↓
Xác minh thông tin
↓
Tạo gian hàng
↓
Tạo sản phẩm
↓
Chọn hình thức giao hàng
↓
Nhập tồn kho hoặc kết nối API
↓
Gửi duyệt
↓
Sản phẩm được mở bán

Nên có các cấp người bán:

New Seller
Verified Seller
Trusted Seller
Enterprise Seller

Cấp người bán có thể ảnh hưởng đến:

* Hạn mức doanh thu.
* Thời gian giữ tiền.
* Phí nền tảng.
* Quyền dùng API.
* Số lượng sản phẩm.
* Tần suất rút tiền.

⸻

10. API giữa trang trung gian và người bán

Với người bán lớn, không nên bắt họ nhập kho thủ công.

Trang trung gian
↓ API
Hệ thống người bán

Các API chính:

GET /products/{id}/availability
POST /orders
GET /orders/{id}
POST /orders/{id}/cancel
POST /orders/{id}/replace

Luồng:

Người mua thanh toán
↓
Marketplace tạo provider_order
↓
Gọi API người bán
↓
Người bán trả về credential
↓
Marketplace lưu mã hóa
↓
Hiển thị cho người mua

Cần dùng idempotency key để tránh hệ thống mua sản phẩm hai lần khi request bị retry.

⸻

11. Cấu trúc dữ liệu cốt lõi

users
seller_profiles
stores
categories
products
product_variants
inventory_items
orders
order_items
deliveries
payments
escrow_transactions
wallets
wallet_transactions
withdrawals
disputes
reviews
messages
provider_integrations
audit_logs

Quan hệ chính:

User
├── có thể là Buyer
└── có thể có SellerProfile
SellerProfile
└── Store
└── Product
└── ProductVariant
└── InventoryItem
Order
├── Buyer
├── Seller
├── OrderItems
├── Payment
├── Delivery
└── Dispute

⸻

12. Luồng MVP nên làm trước

Giai đoạn đầu không nên triển khai tất cả loại dịch vụ cùng lúc.

Nên bắt đầu với:

1. Proxy
2. VPN
3. SSH
4. Software license

Luồng MVP:

Người bán đăng sản phẩm
→ Nhập tồn kho
→ Người mua đặt hàng
→ Thanh toán bằng số dư
→ Hệ thống giao tự động
→ Người mua xác nhận
→ Người bán nhận tiền
→ Có hệ thống dispute cơ bản

Social account nên đưa vào sau vì thường phức tạp hơn về:

* Kiểm tra chất lượng.
* Định nghĩa bảo hành.
* Quyền sở hữu tài khoản.
* Tranh chấp sau giao hàng.
* Điều khoản của từng nền tảng.

Sơ đồ tổng thể đề xuất

┌───────────────────┐
│ Người mua │
└─────────┬─────────┘
│
Tìm kiếm / đặt hàng
│
┌─────────▼─────────┐
│ Marketplace UI │
└─────────┬─────────┘
│
┌─────────▼─────────┐
│ Order Management │
├───────────────────┤
│ Payment / Escrow │
├───────────────────┤
│ Delivery Engine │
├───────────────────┤
│ Dispute System │
└──────┬───────┬────┘
│ │
Kho nội bộ │ │ API người bán
│ │
┌─────────▼─┐ ┌─▼──────────────┐
│ Inventory │ │ Hệ thống seller │
└───────────┘
└──────┬─────────┘
│
┌───────▼───────┐
│ Người bán │
└───────────────┘

Điểm quan trọng nhất: trang trung gian phải làm chủ đơn hàng, dòng tiền, trạng thái giao hàng và tranh chấp. Người bán chỉ cung cấp sản phẩm; không nên để toàn bộ giao dịch diễn ra bên ngoài nền tảng