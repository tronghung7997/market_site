# TopProxy.vn — Danh mục & API đầy đủ (bản tra cứu)

> Tổng hợp từ tài liệu chính thức `?home=apiv2`, `?home=apixoay` và dump toàn bộ
> `<select>` của mọi trang mua (muaproxy, muaproxy4g, combo, proxyxoay) —
> kiểm tra 2026-07-24. Dùng file này để đối chiếu khi cấu hình sản phẩm reseller.

---

## 1. Cách TopProxy vận hành (đọc trước)

- **Prepaid bằng "Xu"** (1 Xu ≈ 1 VND): nạp Xu vào tài khoản topproxy.vn, mọi lệnh
  mua/gia hạn qua API đều trừ Xu. Không có API xem số dư — hết Xu thì lệnh mua trả `102`.
- **Hai hệ API TÁCH BIỆT:**
  - **Proxy tĩnh** — mọi thứ ở `https://topproxy.vn/apiv2/*.php`
  - **Proxy xoay** — MUA/gia hạn key ở `https://topproxy.vn/proxyxoay/*.php`, còn
    LẤY proxy bằng key ở **domain khác**: `https://proxyxoay.shop/api/get.php`
- **Xác thực:** tham số `key=<API key>` truyền qua **query hoặc form** (KHÔNG phải Bearer header). GET hoặc POST đều được.
- **Envelope:** JSON có `status` là SỐ. `100` = thành công. (Xem bảng mã lỗi §5.)
- **Không có** Idempotency-Key, **không có** webhook. Trạng thái chỉ lấy được bằng cách
  gọi lại `listproxy.php` / `apigetkeyxoay.php`.

---

## 2. Toàn bộ sản phẩm TopProxy bán

Cột **Giá trị API (`loaiproxy`)** là thứ phải gửi cho `apiv2/muaproxy.php` — đây là
key máy quan trọng nhất khi map sản phẩm. Cột **Web hiển thị** chỉ là nhãn/URL nội bộ
của web bán lẻ (không dùng cho reseller API).

### 2A. Proxy tĩnh — dân cư (trang `?home=muaproxy`)

| Sản phẩm | Chọn nhà mạng (select) | Giá trị API `loaiproxy` | Giá vốn 30 ngày |
|---|---|---|---|
| Dân cư tĩnh share (share 3) | `Viettel` / `FPT` / `VNPT` | `Viettel` / `FPT` / `VNPT` | 14.400 Xu |

- Type (mọi card tĩnh): select `HTTP` / `SOCKS5` → tham số `type`.
- User/Password: text, mặc định `Random` (để TopProxy tự sinh).
- Ngày sử dụng + Số lượng: ô số.

### 2B. Proxy tĩnh — Datacenter VN

| Web hiển thị (select `chon2`) | Giá trị web | Giá trị API `loaiproxy` (suy đoán) | Giá vốn 30 ngày |
|---|---|---|---|
| Dùng riêng | `Private` | `DatacenterA` | ~48.000 Xu |
| Share 1 | `Share1` | `DatacenterB` | ~14.400 Xu |
| Share 3 | `Share3` | `DatacenterC` | 9.600 Xu |

⚠️ **CẦN VERIFY:** web dùng `Private/Share1/Share3` qua endpoint riêng `/ipv4tinh/apimua.php`;
API reseller dùng `DatacenterA/B/C`. Mapping A=riêng, B=Share1, C=Share3 là **suy từ bậc giá**,
phải mua thử 1 ngày `DatacenterA` bằng key thật để xác nhận trước khi mở bán.

### 2C. Proxy tĩnh — US & Private

| Sản phẩm | Select | Giá trị API `loaiproxy` | Giá vốn 30 ngày |
|---|---|---|---|
| US (Mỹ) datacenter | Khu vực: chỉ 1 giá trị `1` = "City San Jose, Bang Califonia, usa" | `US` | 4.800 Xu |
| Dân cư tĩnh Private (chọn IP) | Chọn IP: `--Random--` + list IP cụ thể | **KHÔNG có trong apiv2** (web dùng `loai='PRIVATEA'`) | 78.000 Xu |

⚠️ "Dân cư tĩnh Private" (chọn IP cụ thể) **không resell được qua API** — bỏ qua.

### 2D. 4G Mobile (trang `?home=muaproxy4g`)

| Sản phẩm | Select | Giá trị API `loaiproxy` | Giá vốn 30 ngày |
|---|---|---|---|
| 4G Vinaphone (SIM thật, 4GB/ngày) | KHÔNG có select nhà mạng; chỉ type HTTP/SOCKS5 | `4Gvinaphone` | 15.000 Xu (đang -50%) |

### 2E. Gói số lượng lớn (trang `?home=combo`)

Mỗi gói là 1 card cố định (KHÔNG chọn nhà mạng), chỉ chọn type/ngày/số lượng.
Không đổi được proxy trong gói, chỉ đổi bảo mật từng con.

| Web hiển thị | Số lượng | Giá trị API `loaiproxy` | Giá vốn 30 ngày |
|---|---|---|---|
| Gói 90 proxy Viettel | 1 = 90 proxy | `GoiViettel` | 675.000 Xu |
| Gói 96 proxy VNPT | 1 = 96 proxy | `GoiVNPT` | 675.000 Xu |
| Gói 96 proxy FPT | 1 = 96 proxy | `GoiFPT` | 675.000 Xu |
| Gói 100 proxy Datacenter | 1 = 100 proxy | `GoiDATACENTER` | 480.000 Xu |

### 2F. Key xoay (trang `?home=proxyxoay`)

Mua theo ĐƠN VỊ ngày/tuần/tháng (mỗi đơn vị một endpoint mua riêng), `thoigian` = số đơn vị.

| Kỳ hạn | Endpoint mua | Giá vốn (đang -50%) |
|---|---|---|
| Theo ngày | `proxyxoay/apimuangay.php` | 2.500 Xu/ngày (5.000 gốc; ≥7 ngày còn 4.000; ≥30 còn 3.000) |
| Theo tuần | `proxyxoay/apimuatuan.php` | 14.000 Xu/tuần |
| Theo tháng | `proxyxoay/apimuathang.php` | 45.000 Xu/tháng |

Trang xoay CHỈ có ô số (ngày/tuần/tháng + số lượng) — không có select nhà mạng ở
bước mua. Nhà mạng & tỉnh chọn ở bước LẤY proxy (get.php, §4).

### 2G. Bảng giá vốn bậc thang đầy đủ (Xu/ngày, từ hàm tính giá trên web)

| Loại | 1n | 5n | 10n | 15n | 20n | 30n | 45n | 60n | 90n | 120n |
|---|---|---|---|---|---|---|---|---|---|---|
| Dân cư share (mọi nhà mạng) | 800 | 720 | 640 | — | 560 | 480 | 440 | 400 | 360 | 320 |
| DC Dùng riêng (Private) | 2800 | 2560 | — | 2400 | — | 1600 | — | — | 1440 | 1360 |
| DC Share1 | 800 | 720 | 640 | — | 560 | 480 | 440 | 400 | 360 | 320 |
| DC Share3 | 800 | 640 | 480 | — | 400 | 320 | 300 | 280 | 260 | 240 |
| US | 480 | 400 | 320 | — | 240 | 160 | 160 | 160 | 160 | 160 |
| 4G Vinaphone (×0.5 KM) | 2500 | 2000 | 1500 | — | 1300 | 1000 | 900 | 800 | 700 | 600 |
| Key xoay (×0.5 KM) | 5000 | 5000 | 5000 | — | — | từ 7n: 4000 / từ 30n: 3000 | | | | |

Giá "mua càng lâu càng rẻ" — vốn/ngày giảm dần theo số ngày. (Giá 4G & xoay đang nhân
khuyến mãi 0.5; hết KM tăng ~2x.)

---

## 3. API v2 — Proxy tĩnh (5 endpoint)

Base: `https://topproxy.vn/apiv2/`. Auth: `key=`. GET/POST.

### 3.1 Mua — `muaproxy.php`
Tham số: `key`, `loaiproxy` (xem §2), `soluong`, `ngay`, `type` (HTTP/SOCKS5), `user`, `password`.
```json
{ "status":100, "loaiproxy":"Viettel", "idproxy":2772, "ip":"27.73.88.211",
  "port":35270, "user":"mdtrong", "password":"pass", "type":"HTTPS",
  "proxy":"27.73.88.211:35270:mdtrong:pass", "time":1726675021 }
```
Lỗi: `101` `102` `103` `104` `201`.

### 3.2 Đổi proxy (đổi IP/nhà mạng) — `doiproxy.php`
Tham số: `key`, `loaiproxy`, `loaiproxynhan` (Viettel/FPT/VNPT/DatacenterB), `type`, `user`, `password`, `idproxy`.
Trả về object proxy như trên. Lỗi: `101` `102` `103` `104`.

### 3.3 Đổi bảo mật (user/pass) — `doibaomat.php`
Tham số: `key`, `loaiproxy`, `idproxy`, `type`, `user`, `password`. Trả object proxy. Lỗi: `101`.

### 3.4 Gia hạn — `giahanproxy.php`
Tham số: `key`, `loaiproxy`, `idproxy`, `ngay`.
```json
{ "status":100, "idproxy":1001, "time":1726675021 }
```
Lỗi: `101` `102` `104`.

### 3.5 List proxy đã mua — `listproxy.php`
Tham số: `key`, `loaiproxy`, `idproxy` (ID cụ thể hoặc `all`).
```json
[ { "status":100, "idproxy":1001, "ip":"130.22.183.69",
    "proxy":"130.22.183.69:56856:tttttd:pass", "type":"HTTPS", "time":1726675021 } ]
```
Lỗi: `101` `104`.

---

## 4. API — Proxy xoay

### 4.1 Mua key — `proxyxoay/apimuangay.php` | `apimuatuan.php` | `apimuathang.php`
Tham số: `key` (master), `thoigian` (số đơn vị), `soluong`.
```json
{ "status":100, "keyxoay":"rwywzSOvFNZOWDVJJBrQRb" }
```
Lỗi `101`: `{"status":101, "comen":"key does not exist"}`.

### 4.2 Gia hạn key — `apigiahanngay.php` | `apigiahantuan.php` | `apigiahanthang.php`
Tham số: `key`, `keyxoay`, `thoigian`.
```json
{ "status":100, "comen":"Renewal successful" }
```

### 4.3 List key còn hạn — `apigetkeyxoay.php`
Tham số: `key`. → `{ "status":100, "keyxoay":"...", "expired":"21:43 29-03-25" }`

### 4.4 LẤY proxy bằng key xoay — `https://proxyxoay.shop/api/get.php`
Đây là bước end-user gọi để đổi IP. Tham số:
- `key` = keyxoay
- `nhamang`: `Random` | `viettel` | `fpt` | `vnpt`
- `tinhthanh`: mã 0–31 hoặc tên tỉnh (bảng dưới)
- `whitelist` (tùy chọn): IPv4 được phép dùng

```json
{ "status":100, "message":"proxy nay se die sau 1777s",
  "proxyhttp":"42.117.243.215:10836::", "proxysocks5":"42.117.243.215:30836::",
  "Nha Mang":"fpt", "Vi Tri":"HaNoi1", "Token expiration date":"22:52 19-02-2025" }
```
Lỗi: `101` `102`. Ràng buộc nhà cung cấp: IP sống 15–30 phút, đổi IP tối thiểu 60 giây, không giới hạn số lần/băng thông, phủ 45 tỉnh.

**Bảng mã tỉnh `tinhthanh` (0–31):**
`0`=Random, `1`=Phú Thọ, `2`=Tuyên Quang, `3`=Hà Nội, `4`=Hải Dương, `5`=Bắc Giang,
`6`=Hồ Chí Minh, `7`=Tây Ninh, `8`=Đồng Nai, `9`=Vũng Tàu, `10`=Bình Dương,
`11`=Nghệ An, `12`=Hà Tĩnh, `13`=Quảng Bình, `14`=Quảng Trị, `15`=Huế, `16`=Đà Nẵng,
`17`=Vĩnh Phúc, `18`=Yên Bái, `19`=Lào Cai, `20`=Lạng Sơn, `21`=Thái Nguyên,
`22`=Hà Nam, `23`=Nam Định, `24`=Thái Bình, `25`=Hải Phòng, `26`=Quảng Ninh,
`27`=Cà Mau, `28`=Kiên Giang, `29`=Bạc Liêu, `30`=Sóc Trăng, `31`=Hậu Giang.

---

## 5. Bảng mã lỗi (`status`)

| Mã | Ý nghĩa | Xử lý phía mình |
|---|---|---|
| `100` | Thành công | — |
| `101` | Key không tồn tại (sai API key) | Kiểm tra config provider |
| `102` | Không đủ tiền (hết Xu) | **Alert admin nạp Xu gấp** |
| `103` | Loại proxy hết hàng | Báo buyer thử lại sau / hoàn tiền |
| `104` | Lỗi không xác định | Log + đối soát |
| `201` | Mua được nhưng THIẾU số lượng | Chỉ xảy ra khi soluong>1 (mình đã ép =1) |

---

## 6. Đối chiếu với sản phẩm đã map trên sàn (checklist)

Sản phẩm sàn (seller `pxstation-seller`) → giá trị `loaiproxy` gửi TopProxy:

| Sản phẩm sàn | `network_mult` keys (= loaiproxy) | Verify |
|---|---|---|
| Proxy dân cư tĩnh VN (share) | `Viettel` `FPT` `VNPT` | ✅ khớp API |
| Proxy Datacenter VN | `DatacenterA` `DatacenterB` `DatacenterC` | ⚠️ verify mapping riêng/Share1/Share3 |
| Proxy Datacenter US | `US` | ✅ |
| Proxy 4G Vinaphone | `4Gvinaphone` | ✅ |
| Gói 90–100 IP | `GoiViettel` `GoiVNPT` `GoiFPT` `GoiDATACENTER` | ✅ khớp API |
| Key xoay ngày/tuần/tháng | (dùng endpoint xoay, không qua loaiproxy) | ✅ adapter tự map |

**Việc còn phải làm trước khi bán datacenter thật:** mua thử 1 ngày `DatacenterA` bằng
key thật, xác nhận đó đúng là "Dùng riêng" (vốn ~2.800đ/ngày) chứ không phải Share.
Ba giá trị còn lại (share/US/4G/gói) khớp thẳng tài liệu, không cần verify.

---

## 7. Ba khác biệt hành vi cần nhớ

1. **Key xoay giao raw key** — buyer tự gọi `proxyxoay.shop/api/get.php` để đổi IP
   (không rotate qua nền tảng như DProxy). Delivered_data đã kèm URL + hướng dẫn.
2. **Mỗi đơn = 1 proxy** (chặn ở backend + form) vì lệnh mua không idempotent.
3. **Không auto-retry lệnh mua**: proxy tĩnh reconcile bằng marker `user=od{order_id}`;
   key xoay timeout → fail + hoàn tiền + alert (không có marker để đối soát).
