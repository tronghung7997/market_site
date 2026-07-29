# QC — Test nạp tiền & mua proxy

> ⚠️ **Tiền thật.** Nạp bằng tài khoản ngân hàng thật, mua hàng trừ tiền thật của nhà cung cấp.
> Test đúng số tiền ghi trong tài liệu, đừng nạp/mua nhiều hơn.
>
> 🔌 Máy test phải cắm **mạng dây công ty** (site chưa mở ra internet).

Trang: **https://market.taskforces.info**

---

## Bước 1 — Tạo tài khoản mới

1. Vào trang chủ → **Mở tài khoản**.
2. Email thật của bạn (nhận thông báo), mật khẩu ≥ 8 ký tự.
3. Đăng nhập → góc phải hiện số dư **0 ₫**.

✅ Đạt: vào được trang chủ với tên tài khoản mới.

---

## Bước 2 — Nạp tiền 10.000đ

1. Bấm **Nạp tiền** (góc phải) → nhập **10000** → Tạo lệnh nạp.
2. Màn hình hiện **mã QR + số tài khoản**.
3. Mở app ngân hàng, quét QR, chuyển đúng số tiền và **giữ nguyên nội dung chuyển khoản**.
4. Chờ tiền vào ví.

✅ Đạt: số dư ví = **10.000 ₫**.

⏱ **Tiền vào chậm là bình thường ở giai đoạn này** — có thể mất **10–15 phút** (hệ thống tự đối soát định kỳ). Chỉ báo lỗi nếu **quá 20 phút** vẫn chưa vào.

❌ Báo lỗi nếu: trang trả lỗi khi tạo lệnh nạp · quét QR ra sai số tiền · sau 20 phút chưa cộng tiền · cộng sai số tiền.

---

## Bước 3 — Mua proxy (rẻ nhất: 4.000đ)

1. Chợ → tìm **“Key proxy xoay IPv4 — theo ngày”**.
2. Chọn thời hạn **24 giờ** → tổng tiền **4.000 ₫** → **Mua** → **Xác nhận mua**.
3. Vào trang **Đơn hàng** (menu tài khoản).

✅ Đạt (trong ~5 giây):
- Đơn ở trạng thái **Đã giao**, số dư ví còn **6.000 ₫**.
- Có khối **Địa chỉ proxy · cố định** dạng `160.250.x.x:10405`.
- Có cảnh báo vàng **“Chưa kích hoạt”**.

❌ Báo lỗi nếu: đơn **Đã huỷ** (chụp lại lý do huỷ) · quá 1 phút vẫn “Chờ xử lý” · trừ tiền mà không có đơn.

---

## Bước 4 — Kích hoạt proxy (khai báo IP)

1. Mở **https://api.ipify.org** trên **chính máy đang test** → copy dãy số hiện ra.
2. Ở đơn hàng, dán vào ô **IP được phép dùng** → bấm **Kích hoạt**.

✅ Đạt: hiện **“Đã kích hoạt — proxy dùng được ngay”**, dòng cảnh báo vàng biến mất, đổi thành **✓ Proxy đang mở cho IP …**

📌 Chỉ khai báo được **1 địa chỉ IP**. Nhập 2 IP phải báo lỗi rõ ràng (đây cũng là một case cần test).

---

## Bước 5 — Kiểm tra proxy chạy thật

Mở **Terminal / CMD** trên máy test, thay `HOST:PORT` bằng số ở khối “Địa chỉ proxy”:

```
curl -x http://HOST:PORT https://api.ipify.org
```

✅ Đạt: trả về một địa chỉ IP Việt Nam (khác IP máy bạn) → proxy hoạt động.

❌ Báo lỗi nếu: treo lâu rồi báo timeout (thường do khai sai IP ở bước 4 — kiểm tra lại api.ipify.org trước khi báo).

---

## Bước 6 — Đổi IP

1. Bấm **Đổi IP** trong đơn hàng.
2. Chạy lại lệnh `curl` ở bước 5.

✅ Đạt: dòng “IP đang ra” đổi sang IP khác, lệnh curl trả IP mới khớp.

⏱ Sau mỗi lần đổi phải **chờ 60 giây** mới đổi tiếp — trong lúc chờ nút hiện đếm ngược (vd `Đổi IP (45s)`) và bấm sẽ báo “Vui lòng chờ …”. **Đây là đúng thiết kế, không phải lỗi.**

---

## Bước 7 — Xác nhận đơn

1. Bấm **Xác nhận đã nhận**.

✅ Đạt: đơn chuyển **Hoàn tất**, hiện nút **Đánh giá**.

---

## Khi báo lỗi, gửi kèm

- Ảnh chụp màn hình (cả trang, thấy được **mã đơn `#…`**)
- Thời gian xảy ra
- Email tài khoản test
- Nếu lỗi proxy: IP máy bạn (api.ipify.org) + nguyên dòng lệnh curl và kết quả

---

## Tóm tắt chi phí một lượt test

| Việc | Số tiền |
|---|---|
| Nạp | 10.000 ₫ |
| Mua key xoay 24 giờ | 4.000 ₫ |
| Còn lại trong ví | 6.000 ₫ |
