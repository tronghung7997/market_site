---
slug: nuoi-via-facebook-proxy-ipv6
category: guide
tags: facebook, via facebook, proxy ipv6, checkpoint, nuôi tài khoản
title: Nuôi via Facebook bằng proxy IPv6: cách thiết lập để hạn chế checkpoint
excerpt: Proxy IPv6 rẻ và nhiều IP, nhưng dùng sai thì cả loạt via dính checkpoint cùng lúc. Bài này giải thích IPv6 khác IPv4 thế nào với Facebook, cách chia IP, dựng hồ sơ trình duyệt và lịch nuôi cho vài chục đến cả trăm tài khoản.
meta_title: Nuôi via Facebook bằng proxy IPv6 – hạn chế checkpoint
meta_description: Dùng proxy IPv6 nuôi nhiều via Facebook: chia IP theo subnet, một via một IP cố định, hồ sơ trình duyệt riêng, lịch nuôi và cách xử lý checkpoint.
---

Proxy IPv6 hấp dẫn vì **giá rẻ và số lượng IP gần như không giới hạn**, rất hợp khi bạn quản lý vài chục đến cả trăm tài khoản Facebook. Nhưng cũng chính vì IPv6 rẻ, nhiều người mua một dải IP rồi gán cho 100 via và nhận về… 100 checkpoint.

Không có cách nào đảm bảo via **không bao giờ** bị checkpoint — Facebook kiểm tra cả IP, thiết bị lẫn hành vi. Mục tiêu thực tế là giảm rủi ro xuống mức thấp nhất và khi có checkpoint thì xử lý được. Hãy chỉ quản lý những tài khoản bạn có quyền sử dụng và tuân thủ chính sách của Meta.

## IPv6 khác IPv4 thế nào trong mắt Facebook?

- **Facebook hỗ trợ IPv6 đầy đủ**, nên truy cập facebook.com qua proxy IPv6 hoạt động bình thường. Một số website khác (trang kiểm tra IP, email, công cụ bên thứ ba) chưa có IPv6 — khi đó cần gói proxy hỗ trợ cả IPv4.
- Nhà mạng thường cấp cho **một khách hàng cả một dải /64** (hàng tỉ địa chỉ). Vì vậy các hệ thống chống spam hay đánh giá IPv6 **theo cả dải**, không chỉ theo từng địa chỉ. 100 IP cùng một /64 có thể bị xem như *một* mạng duy nhất.
- Phần lớn proxy IPv6 giá rẻ là IP **datacenter**, độ tin cậy thấp hơn IP dân cư. Định vị (GeoIP) của IPv6 cũng kém chính xác hơn IPv4.

Kết luận: IPv6 dùng tốt cho việc nuôi số lượng lớn **nếu bạn chia IP đúng cách**; với các tài khoản giá trị cao (chạy quảng cáo, quản trị BM), nên cân nhắc [proxy IPv4](/vi/categories/ipv4-proxy) hoặc proxy dân cư.

## Thiết lập cho 100 via

### 1. Chia IP theo subnet, không chỉ theo địa chỉ

- Mua IP từ **nhiều dải /64 khác nhau** (hỏi rõ shop gói có trải nhiều subnet hay không), lý tưởng là từ vài nhà cung cấp.
- Chia via thành nhóm nhỏ, ví dụ 10–20 via một nhóm, mỗi nhóm một dải riêng. Nếu một dải bị đánh dấu, chỉ một nhóm chịu ảnh hưởng.

### 2. Một via, một IP cố định

- Dùng [proxy tĩnh](/vi/categories/static-proxy) (sticky), **không xoay IP** giữa các phiên đăng nhập của cùng một via.
- Không để hai via dùng chung một IP, cũng không đăng nhập một via từ nhiều IP khác nhau.
- Chọn IP **cùng quốc gia** với via; via Việt dùng IP Việt Nam, via ngoại dùng IP đúng nước tạo tài khoản.

### 3. Mỗi via một hồ sơ trình duyệt

- Dùng trình duyệt antidetect hoặc hồ sơ trình duyệt riêng cho từng via: cookie, bộ nhớ đệm và dấu vân tay thiết bị tách biệt.
- Đặt **múi giờ, ngôn ngữ** của hồ sơ khớp với vị trí IP.
- Tắt hoặc định tuyến **WebRTC** qua proxy để không lộ IP thật.
- Kiểm tra IP hiển thị trên 2–3 trang kiểm tra trước lần đăng nhập đầu tiên.

### 4. Lịch nuôi tăng dần

| Giai đoạn | Việc nên làm |
|---|---|
| Ngày 1–3 | Đăng nhập, lướt bảng tin, xem video, vài lượt thích. Không sửa thông tin. |
| Ngày 4–7 | Bật xác thực 2 lớp, cập nhật email khôi phục, tương tác nhẹ với nhóm và trang. |
| Tuần 2 | Đăng bài cá nhân, kết bạn từ từ (vài người mỗi ngày), tham gia nhóm đúng chủ đề. |
| Sau tuần 2 | Mới dùng cho việc chính (quản trị trang, quảng cáo), tăng dần khối lượng. |

Nguyên tắc: **thay đổi từ từ**. Đổi tên, ngày sinh, mật khẩu, email và đăng nhập ở thiết bị mới trong cùng một ngày là cách nhanh nhất để gặp checkpoint.

### 5. Giữ phiên đăng nhập

- Lưu cookie trong hồ sơ trình duyệt thay vì đăng nhập lại bằng mật khẩu mỗi lần.
- Gia hạn proxy **trước khi hết hạn** để giữ đúng IP cũ; mất IP giữa chừng là lý do phổ biến khiến via đang ổn bị checkpoint.

## Khi via bị checkpoint

1. **Không đổi IP hay hồ sơ** — giải checkpoint từ đúng IP và hồ sơ quen thuộc của via.
2. Làm theo yêu cầu xác minh của Facebook (mã qua email/số điện thoại, ảnh, xác nhận thiết bị).
3. Tạm dừng các via khác **cùng dải IP** vài ngày để xem dải đó có bị đánh dấu không.
4. Ghi lại via nào, IP nào, làm gì trước khi dính để tìm ra quy luật.

## Chi phí tham khảo

Với 100 via, IPv6 rẻ hơn đáng kể so với 100 proxy IPv4 riêng. Một cách cân bằng phổ biến: via quan trọng dùng IPv4 hoặc proxy dân cư, phần còn lại dùng IPv6 chia nhiều subnet. Xem các gói trong danh mục [Proxy](/vi/categories/proxies) và [via Facebook](/vi/categories/via-facebook) để so sánh giá và bảo hành giữa các shop.

## Tóm tắt

- IPv6 được đánh giá **theo dải /64**: hãy trải IP trên nhiều dải.
- **Một via – một IP cố định – một hồ sơ trình duyệt**, cùng quốc gia.
- Nuôi tăng dần, thay đổi từ từ, giữ IP khi gia hạn.
- Không có công thức "không bao giờ checkpoint"; hãy theo dõi và điều chỉnh theo từng nhóm.
