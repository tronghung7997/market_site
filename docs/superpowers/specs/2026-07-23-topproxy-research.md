# TopProxy.vn — Nghiên cứu API & sản phẩm (trước khi viết adapter reseller)

Nguồn: https://topproxy.vn/?home=apiv2 , https://topproxy.vn/?home=apixoay , duyệt trực tiếp site 2026-07-23.

## 1. Mô hình chung

- **Prepaid bằng "Xu"**: tài khoản reseller nạp Xu trước (chuyển khoản tay qua trang Nạp Xu), mọi lệnh mua/gia hạn trừ Xu. 1 Xu ≈ 1 VND (giá niêm yết trùng mặt bằng VND).
- **Hai hệ API tách biệt**:
  - **API v2 (proxy tĩnh)** — `https://topproxy.vn/apiv2/*.php`
  - **API proxy xoay** — mua/gia hạn key tại `https://topproxy.vn/proxyxoay/*.php`, còn *lấy proxy* bằng key tại **domain khác**: `https://proxyxoay.shop/api/get.php`
- **Auth**: `key=<api key>` truyền dưới dạng **query/form param** (không phải Bearer header). GET hoặc POST đều được.
- **Envelope**: JSON với `status` dạng số: `100` = thành công; lỗi: `101` key sai, `102` không đủ Xu, `103` hết hàng, `104` lỗi không xác định, `201` = **mua thành công nhưng KHÔNG đủ số lượng** (partial fulfillment).
- **Không có Idempotency-Key, không có webhook** — mua bằng GET, retry mù sẽ mua trùng. Trạng thái chỉ lấy được bằng polling (`listproxy.php`, `apigetkeyxoay.php`).

## 2. API v2 — proxy tĩnh

| Việc | Endpoint | Tham số chính |
|---|---|---|
| Mua | `apiv2/muaproxy.php` | `loaiproxy`, `soluong`, `ngay`, `type` (HTTP/SOCKS5), `user`, `password` |
| Đổi proxy (đổi IP/nhà mạng) | `apiv2/doiproxy.php` | `loaiproxy`, `loaiproxynhan`, `idproxy`, `type`, `user`, `password` |
| Đổi bảo mật (user/pass) | `apiv2/doibaomat.php` | `loaiproxy`, `idproxy`, `type`, `user`, `password` |
| Gia hạn | `apiv2/giahanproxy.php` | `loaiproxy`, `idproxy`, `ngay` |
| List đã mua | `apiv2/listproxy.php` | `loaiproxy`, `idproxy` hoặc `all` |

`loaiproxy` hợp lệ: `Viettel`, `FPT`, `VNPT`, `US`, `DatacenterA/B/C`, `GoiViettel`, `GoiVNPT`, `GoiFPT`, `GoiDATACENTER`, `4Gvinaphone`.

Response mua (status=100): `idproxy`, `ip`, `port`, `user`, `password`, `type`, `proxy` ("ip:port:user:pass"), `time` (epoch — hết hạn).

## 3. API proxy xoay (kiến trúc 2 tầng key)

1. **Master key** (key API của tài khoản reseller) dùng để MUA "key xoay":
   - Mua: `proxyxoay/apimuangay.php` (ngày) / `apimuatuan.php` (tuần) / `apimuathang.php` (tháng) — params `key`, `thoigian`, `soluong` → trả `keyxoay`.
   - Gia hạn: `apigiahanngay/tuan/thang.php` — `key`, `keyxoay`, `thoigian`.
   - List key còn hạn: `apigetkeyxoay.php`.
2. **Key xoay** là thứ end-user dùng để LẤY proxy tại `https://proxyxoay.shop/api/get.php`:
   - Params: `key` (=keyxoay), `nhamang` (Random/viettel/fpt/vnpt), `tinhthanh` (0–31 hoặc tên tỉnh), `whitelist` (IP được phép dùng, optional).
   - Response: `proxyhttp`, `proxysocks5` ("ip:port::"), `Nha Mang`, `Vi Tri`, message dạng "proxy nay se die sau 1777s" (field name có khoảng trắng, không chuẩn — parser phải phòng thủ).
   - Ràng buộc: IP sống 15–30 phút, đổi IP tối thiểu 60s, không giới hạn số lần đổi/băng thông, 3 nhà mạng, phủ 45 tỉnh.

## 4. Bảng sản phẩm & giá niêm yết (23/07/2026, một số đang giảm 50%)

| Nhóm | Biến thể | Giá tham khảo (30 ngày trừ khi ghi khác) |
|---|---|---|
| Dân cư tĩnh share (share 3) | Viettel / FPT / VNPT | 14.400 Xu |
| Datacenter VN | Dùng riêng / Share1 / Share3 | 9.600 Xu (Share3) |
| US datacenter | San Jose, CA | 4.800 Xu |
| Dân cư tĩnh Private (riêng 100%, chọn được IP) | VNPT / Viettel | 78.000 Xu |
| 4G mobile (sim Vinaphone, 4GB/ngày) | — | 15.000 Xu (đang -50%) |
| Gói bulk | 90 Viettel / 96 VNPT / 96 FPT: 675.000 Xu; 100 Datacenter: 480.000 Xu | không đổi proxy được, chỉ đổi bảo mật |
| Key xoay IPv4 | ngày 2.500 / tuần 14.000 / tháng 45.000 Xu (đang -50%) | — |

Tồn kho hữu hạn, hiển thị realtime trên site (vd "Dùng riêng còn 15 Proxy", "VNPT còn 3 Proxy") → lỗi `103` là chuyện thường ngày, phải xử lý đẹp.

## 5. Hệ quả thiết kế cho adapter TopProxy (khi làm)

1. **Không dùng lại nguyên `RealApiAdapter`**: auth qua query param chứ không Bearer; envelope `status` số chứ không `{success,...}`. Kế thừa pattern `DProxyAdapter` (custom `_headers`/request, map lỗi, giữ retry + `provider_call_logs`).
2. **Cấm auto-retry lệnh mua** (không có idempotency): mua = 1 attempt duy nhất; nếu timeout/không rõ kết quả → reconcile bằng `listproxy.php`/`apigetkeyxoay.php` trước khi mua lại (so khớp theo user/password đã gửi hoặc đếm chênh lệch).
3. **Xử lý `status=201`** (giao thiếu số lượng): hoặc refund phần thiếu, hoặc chỉ cho mua `soluong=1` mỗi order (như đã làm với DProxy) — khuyến nghị bắt đầu với quantity=1.
4. **Hai sản phẩm khác hẳn nhau**:
   - *Proxy tĩnh* → `pricing_strategy=config` (nhà mạng/loại/ngày/type), provision = `muaproxy.php`, giao `ip:port:user:pass`; hỗ trợ thêm hành động "đổi bảo mật"/"gia hạn" về sau.
   - *Key xoay* → giống mô hình DProxy hiện có. Hai lựa chọn giao hàng: (a) giao thẳng `keyxoay` + hướng dẫn gọi `proxyxoay.shop` (đơn giản, nhưng lộ key & mất kiểm soát); (b) nền tảng giữ key, buyer bấm "Đổi IP" qua backend mình như UX DProxy hiện tại (kiểm soát tốt, tính được usage). Khuyến nghị (b) — tái dùng gần như toàn bộ luồng rotate/proxy_allocation sẵn có.
5. **Theo dõi số dư Xu**: không có API xem số dư trong tài liệu → phát hiện gián tiếp qua lỗi `102` khi mua; cần alert (module alerts có sẵn) khi gặp `102` để admin nạp Xu kịp.
6. **Giá vốn theo (loại, ngày, số lượng)** "mua càng lâu giá càng rẻ" → bảng giá vốn nên là config trên provider (`config.cost_table`) hoặc đồng bộ tay, margin đặt ở `pricing_params` sản phẩm.

## 5b. Dump form thật (Playwright, 2026-07-23) — option + bảng giá bậc thang

Giá trị `<select>` NGUYÊN VĂN trên web (dùng để đối chiếu option sản phẩm):

| Trang | Field | Values thật |
|---|---|---|
| muaproxy — Dân cư share | `chon1` | `Viettel` / `FPT` / `VNPT` |
| muaproxy — Datacenter VN | `chon2` | `Private` (Dùng riêng) / `Share1` / `Share3` |
| muaproxy — US | `chon3` | `1` (San Jose, CA — chỉ 1 khu vực) |
| muaproxy — Dân cư Private | `chon4` | `Random` + list IP cụ thể; JS gửi `loai='PRIVATEA'` |
| mọi card tĩnh | `typeN` | `HTTP` / `SOCKS5` |
| muaproxy4g | không có select nhà mạng | chỉ ngày/số lượng/type/user/pass |
| proxyxoay | không có select | ngày/tuần/tháng là INPUT SỐ (mua N đơn vị) |

Lưu ý mapping: web dùng session + endpoint riêng (`/ipv4tinh/apimua.php`,
`/4gmobi/apimua4g.php`, `/proxyxoay/apimua.php`) với `loai=Private/Share1/Share3`;
còn apiv2 reseller dùng `loaiproxy=DatacenterA/B/C`. Suy đoán A=riêng, B=Share1,
C=Share3 (theo bậc giá) — **PHẢI verify bằng key thật (mua thử 1 ngày) trước khi bán thật**.
"Dân cư tĩnh Private" (PRIVATEA, chọn IP) **không có trong apiv2** → không resell được.

Bảng giá bậc thang thật (Xu/ngày, từ hàm `tinhGia*`; 4G và xoay đang nhân `giamgia=0.5`):

| Loại | 1n | 5n | 10n | 15n | 20n | 30n | 45n | 60n | 90n | 120n |
|---|---|---|---|---|---|---|---|---|---|---|
| Dân cư share (mọi nhà mạng) | 800 | 720 | 640 | — | 560 | 480 | 440 | 400 | 360 | 320 |
| DC Private (riêng) | 2800 | 2560 | — | 2400 | — | 1600 | — | — | 1440 | 1360 |
| DC Share1 | 800 | 720 | 640 | — | 560 | 480 | 440 | 400 | 360 | 320 |
| DC Share3 | 800 | 640 | 480 | — | 400 | 320 | 300 | 280 | 260 | 240 |
| US | 480 | 400 | 320 | — | 240 | 160 | 160 | 160 | 160 | 160 |
| 4G Vinaphone (×0.5 hiện hành) | 2500 | 2000 | 1500 | — | 1300 | 1000 | 900 | 800 | 700 | 600 |
| Key xoay (×0.5 hiện hành) | 5000 | 5000 | 5000 | — | — | 3000 (từ 7n: 4000) | — | — | — | — |

Hệ quả đã áp vào seed (cập nhật theo yêu cầu 23/07 chiều — kỳ hạn ngắn 3/7/14/30):
giá vốn KHÔNG tuyến tính theo ngày, còn ConfigPricing thì tuyến tính → đơn giá bán/ngày
NEO THEO BẬC VỐN Ở KỲ NGẮN NHẤT (3 ngày) × margin ≥ 50%: dân cư share 1.200đ/ngày
(base 36.000), Datacenter Share3/Share1/riêng 1.200/1.500/4.200đ/ngày (mult 1.0/1.25/3.5),
US 800đ/ngày (base 24.000), 4G 1.900đ/ngày (base 57.000). Margin phình to ở kỳ dài —
đó là giới hạn của công thức tuyến tính, muốn giá kỳ dài cạnh tranh cần pricing
per-duration. Key xoay tách 3 sản phẩm theo ĐƠN VỊ (ngày/tuần/tháng: 4.000đ/ngày,
21.000đ/tuần, 68.000đ/tháng), adapter tự map `days` → endpoint + `thoigian=N`
(mua N đơn vị — web cho phép, `_xoay_endpoint()`).

**White-label (yêu cầu 23/07)**: buyer không được thấy nguồn TopProxy ở bất kỳ đâu —
title/description sản phẩm trung tính, seller riêng `pxstation-seller@dxtrade.example.com`,
tên provider đặt trung tính "PX Station — ..." (vì `/products/{id}/operations` chưa có
auth guard), và API public `pricing-options` trả `adapter_type` qua alias
`topproxy → "auto_proxy"` (`_PUBLIC_ADAPTER_ALIASES`, src/pricing/router.py — frontend
khoá số lượng theo alias này). adapter_type thật chỉ hiện trong admin.

## 6. Đã triển khai (2026-07-23)

- `src/adapters/topproxy.py` — `TopProxyAdapter` (adapter_type `topproxy` giờ trỏ vào đây,
  không còn là RealApiAdapter convention giả định): auth query-param, map mã lỗi
  101/102/103/104/201, mua tĩnh có marker idempotency `user=od{order_id}` (reconcile qua
  listproxy trước khi mua lại), key xoay fail-fast khi kết quả mua không rõ ràng.
- `scripts/mock_topproxy.py` — mock đúng wire format (`:9300`), có mô phỏng hết Xu (102),
  hết hàng (103), sai key (101).
- `scripts/seed_topproxy.py` — seller riêng `topproxy-seller@dxtrade.example.com` +
  2 provider (static/xoay) + 8 sản phẩm mapping đầy đủ catalog (option/giá đối chiếu
  dump form thật §5b). QUY ƯỚC: `network_mult` keys = giá trị `loaiproxy` nguyên văn;
  `type_mult` keys = HTTP/SOCKS5; `duration_options.days` = số ngày (xoay: adapter tự
  đổi sang endpoint + thoigian). Nhãn tiếng Việt để ở `network_display`.
- Ràng buộc quantity=1/đơn cho topproxy (orders/service.py + DynamicOrderForm, chung cơ chế DProxy).
- Tests: `tests/test_topproxy_adapter.py`.

### Runbook dev

```bash
cd marketplace-svc
uv run uvicorn scripts.mock_topproxy:app --port 9300   # mock TopProxy
uv run python scripts/seed_topproxy.py                 # seed provider + 8 sản phẩm
# mua thử trên frontend (products 30–37) hoặc qua API — đơn giao tự động trong ~2s
```

### Chuyển sang TopProxy thật

1. `/admin/providers` → sửa 2 provider "TopProxy — ...": `base_url=https://topproxy.vn`,
   `api_key` = key thật; provider xoay bỏ `xoay_get_url` (mặc định về `https://proxyxoay.shop/api/get.php`).
2. Bấm Test provider (gọi listproxy/apigetkeyxoay thật).
3. Chỉnh `network_mult`/`base_price` các sản phẩm theo bảng giá thật (margin hiện seed 25%).
4. Theo dõi alert lỗi 102 (hết Xu) để nạp Xu kịp thời — TopProxy không có API xem số dư.
