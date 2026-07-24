# TopProxy — Plan lên production & test mua thật (giá nhỏ nhất)

> Mục tiêu: chuyển 2 provider TopProxy từ mock sang API thật, và mua **1 đơn giá
> trị nhỏ nhất bằng tiền thật** để nghiệm thu trọn vòng trước khi mở bán.
> Tham chiếu danh mục/API: [`topproxy-catalog.md`](topproxy-catalog.md).

---

## 0. Điều kiện cần (bạn chuẩn bị)

- [ ] Tài khoản topproxy.vn đã **nạp Xu** (tối thiểu ~20.000 Xu để có đệm — đơn test tốn ~1.440 Xu).
- [ ] **API key** lấy tại topproxy.vn → menu "🧩 Tài liệu api". Đây là key master dùng cho cả proxy tĩnh lẫn xoay.
- [ ] Backend + Postgres + Redis đang chạy (`docker compose -f docker-compose.dev.yml up -d` + backend native).

> ⚠️ **KHÔNG cần** mock (`scripts/mock_topproxy.py`) khi test thật — có thể tắt nó đi.

---

## 1. Trỏ 2 provider sang TopProxy thật

Vào **/admin/providers**, sửa lần lượt 2 provider (form giữ nguyên `mode` khi sửa vì nó
load lại config cũ — chỉ cần đổi base_url + api_key):

**Provider #12 — "PX Station — proxy tĩnh":**
```
base_url = https://topproxy.vn
api_key  = <API key thật>
```

**Provider #13 — "PX Station — key xoay":**
```
base_url = https://topproxy.vn
api_key  = <API key thật>
```
(mode=xoay và xoay_get_url=https://proxyxoay.shop/api/get.php giữ nguyên)

> Nếu form admin không hiện lại giá trị `mode`/`xoay_get_url` sau khi sửa, KHÔNG bấm lưu —
> báo lại để cập nhật form; hoặc sửa nhanh bằng API (mục 1b).

### 1b. (Tuỳ chọn) Sửa provider bằng API thay vì UI
```bash
ADMIN=$(curl -s -X POST http://localhost:8001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@dxtrade.example.com","password":"DemoPass123!"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# Provider #12 (tĩnh)
curl -s -X PUT http://localhost:8001/admin/providers/12 -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' \
  -d '{"config":{"base_url":"https://topproxy.vn","api_key":"<KEY_THẬT>","mode":"static"}}'

# Provider #13 (xoay)
curl -s -X PUT http://localhost:8001/admin/providers/13 -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' \
  -d '{"config":{"base_url":"https://topproxy.vn","api_key":"<KEY_THẬT>","mode":"xoay","xoay_get_url":"https://proxyxoay.shop/api/get.php"}}'
```

---

## 2. Test kết nối (KHÔNG tốn Xu)

Nút "Test" giờ chỉ chạy `check_health()` (list read-only), không mua thử:
```bash
curl -s -X POST http://localhost:8001/admin/providers/12/test -H "Authorization: Bearer $ADMIN" \
  | python3 -c "import sys,json;print('static:',json.load(sys.stdin)['health']['status'])"
curl -s -X POST http://localhost:8001/admin/providers/13/test -H "Authorization: Bearer $ADMIN" \
  | python3 -c "import sys,json;print('xoay:',json.load(sys.stdin)['health']['status'])"
```
- Cả hai phải trả `healthy`.
- `unhealthy` + "Sai API key" → mã 101, kiểm tra lại key.

---

## 3. Mua 1 đơn THẬT — giá nhỏ nhất

**Sản phẩm chọn: Proxy Datacenter US (San Jose) — #32, kỳ hạn 3 ngày.**
- Giá bán buyer: **2.400đ** (rẻ nhất trong các sản phẩm tĩnh).
- Giá vốn TopProxy: **~1.440 Xu** (US 480 Xu/ngày × 3).
- Lý do chọn: 1 API call `muaproxy.php`, giao `ip:port:user:pass` trực tiếp — test được proxy ngay.

### Cách A — mua trên frontend (giống buyer thật)
1. Đăng nhập `buyer@dxtrade.example.com` (số dư demo có sẵn ~49 triệu).
2. Vào sản phẩm #32 → chọn **US / 3 ngày / HTTP** → Đặt hàng.
3. Đợi ~3 giây, mở "Dữ liệu bàn giao" xem `Host/Port/Username/Password`.

### Cách B — mua bằng API
```bash
BUYER=$(curl -s -X POST http://localhost:8001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"buyer@dxtrade.example.com","password":"DemoPass123!"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

ORDER=$(curl -s -X POST http://localhost:8001/orders -H "Authorization: Bearer $BUYER" \
  -H 'Content-Type: application/json' \
  -d '{"product_id":32,"user_config":{"type":"HTTP","network":"US","days":3,"quantity":1},"quantity":1}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['id'])")
echo "order $ORDER"

sleep 4
curl -s http://localhost:8001/orders/$ORDER -H "Authorization: Bearer $BUYER" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('status:',d['status']);print(d['delivered_data'])"
```

---

## 4. Nghiệm thu sau khi mua

- [ ] Order → `delivered`, delivered_data có `Host/Port/Username/Password` thật.
- [ ] **Proxy dùng được** — test trực tiếp (thay bằng giá trị thật):
  ```bash
  curl -x http://USER:PASS@HOST:PORT -s https://api.ipify.org
  # phải trả về một IP Mỹ (San Jose)
  ```
- [ ] `provider_call_logs` có dòng `muaproxy` status_code 200 success=t:
  ```bash
  docker exec market_site-postgres-1 psql -U marketplace -d marketplace -c \
    "SELECT operation,status_code,success FROM provider_call_logs WHERE provider_id=12 ORDER BY id DESC LIMIT 3;"
  ```
- [ ] **Đối chiếu Xu** trên topproxy.vn (Lịch sử tiêu) — trừ đúng ~1.440 Xu.
- [ ] Ledger buyer: `SELECT * FROM transactions WHERE reference_id LIKE 'order-<id>%'` — trừ 2.400đ.

### Nếu order về `cancelled` (provision fail)
Buyer được **tự động hoàn tiền** (refund_escrow). Xem lý do:
```bash
docker exec market_site-postgres-1 psql -U marketplace -d marketplace -c \
  "SELECT level,left(message,120) FROM log_entries WHERE message LIKE '%rder <id>%' ORDER BY id DESC LIMIT 5;"
```
Nguyên nhân thường gặp: `102` hết Xu (nạp thêm), `103` US hết hàng (thử lại/đổi loại), `101` sai key.

---

## 5. Sau khi test đạt — mở bán

1. **Chốt mapping Datacenter A/B/C** (điểm ⚠️ duy nhất): mua thử thêm 1 đơn
   Datacenter VN chọn "Dùng riêng" (1 ngày), xác nhận `DatacenterA` = riêng
   (vốn ~2.800đ/ngày) chứ không phải Share. Nếu lệch, sửa `network_mult` sản phẩm #31.
2. **Rà lại giá bán** tất cả sản phẩm #30–34, #38–40 so bảng giá vốn (catalog §2G) — đảm bảo margin dương ở kỳ hạn ngắn nhất.
3. **Bật cảnh báo hết Xu**: khi gặp `102`, adapter trả lỗi và order tự refund — nhưng nên
   theo dõi `/admin/alerts` hoặc `/admin/logs` để nạp Xu kịp (TopProxy không có API xem số dư).
4. Sản phẩm key xoay: nhắc buyer đây là **key tự đổi IP qua proxyxoay.shop** (không rotate qua sàn).

---

## 6. Rollback (nếu cần quay lại mock)

Sửa 2 provider về `base_url=http://127.0.0.1:9300`, api_key=`mock-topproxy-key`, rồi
`uv run uvicorn scripts.mock_topproxy:app --port 9300`. Dữ liệu sản phẩm không đổi.

---

## Tóm tắt 1 dòng cho lần test đầu

> Nạp ~20k Xu + lấy API key → sửa provider #12/#13 (base_url + api_key) → Test phải
> `healthy` → mua **US 3 ngày (#32, vốn ~1.440 Xu)** → curl proxy thấy IP Mỹ → xong.
