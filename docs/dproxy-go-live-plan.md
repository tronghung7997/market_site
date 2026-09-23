# DProxy × seller nội bộ — kế hoạch go-live

Cập nhật 2026-09-23. Nhánh `feat/dproxy-internal-seller` (worktree `market_site-dproxy`, tách từ `main` 45e8348).

Mục tiêu: một **seller nội bộ** (`accounts.is_internal`, sàn vận hành) bán proxy lấy từ DProxy qua API M2M.
Luồng gồm các bước sau:

1. Admin thêm nguồn DProxy ở `/admin/sources/new`.
2. Admin giao nguồn cho seller nội bộ và đồng bộ gói.
3. Admin nhập gói thành sản phẩm, đặt giá VND.
4. Buyer mua.
5. Sàn gọi `partner-purchase` và giao proxy.
6. Nếu buyer được hoàn tiền, sàn gửi `partner-dispute` để DProxy thu node và hoàn credit.

Tài liệu gốc của nhà cung cấp (không commit, chỉ nằm trong máy):
- `docs/dproxy/User-Proxy-APIs-M2M-Purchase.docx`
- `docs/dproxy/openapi.json` (bản chụp ngày 2026-08-27; bản live `/openapi.json` giờ trả 404)
- `docs/dproxy/api.md`

Chạy thử bằng mock: `docs/dproxy-mock-runbook.md`.

## 1. Tình trạng

| Bước | Trạng thái |
|---|---|
| Adapter M2M (mua, retry, quét đơn kẹt, dispute, đối soát) | Có. Đã sửa theo contract live (§2) |
| Seller nội bộ + wizard `/admin/sources` | Có. DProxy là loại nguồn `proxy`: đồng bộ gói, nhập gói, sửa giá, gỡ gói |
| Chặn biên lãi | Có. Không lưu được giá bán thấp hơn `vốn × (1 + min_margin_pct)`. Vốn USD được quy đổi theo tỷ giá hiển thị (Settings › Tiền tệ), làm tròn lên |
| Phí sàn cho seller nội bộ | 0% (`fees.service.order_fee_percent`). Hệ quả: hoa hồng affiliate trên đơn nội bộ cũng bằng 0 vì hoa hồng được tính trên phí |
| Thu hồi thượng nguồn | Qua outbox `upstream_revocations` (job `upstream_revocation_job`, chạy mỗi 2 phút) |
| Theo dõi hạn mức | Job `dproxy_credit_check_job` (30 phút). Dưới `low_credit_usd` thì cảnh báo; bằng 0 thì tắt provider |
| Cảnh báo ra ngoài | Sự cố `critical` mới được gửi email cho mọi admin qua mail outbox (template `ops_incident`) |
| White-label | API công khai trả `auto_proxy`, không lộ `dproxy`. Khu seller gọi nguồn bằng `providers.public_key` (`/seller/sources/{key}`), không dùng id tuần tự |
| Bán thật | **Chưa.** Còn các mục ở §3 và §4 |

## 2. Contract live — probe bằng key thật ngày 2026-09-23

Script probe (đã che mật khẩu) nằm ở scratchpad của phiên làm việc. Kết quả:

| Endpoint | Tài liệu nói | Live trả |
|---|---|---|
| `GET /api/v1/store/plans` | — | 3 gói, **USD**, 30 ngày, `country_id: null`, loại proxy chỉ có `proxies_type_id` (1 = residential, 2 = mobile, 4 = datacenter) |
| `POST /api/v1/store/quote` | (không nhắc tới) | Báo giá, không tạo đơn: trả `available`, `available_count`. Truyền `duration_days` **không đổi giá** |
| `GET /customer/marketplace/credit-summary` | OpenAPI để `{}` | `balance_usd, credit_limit_usd (100), available_spending_usd, current_debt_usd, is_credit_active`: hạn mức **trả sau** |
| `GET /api/v1/proxies/user` | — | **Mảng** (giả định #3 đúng). `/user/list` là dạng bọc + phân trang |
| `partner-purchase` với plan không tồn tại | 4xx | **404** `"Không tìm thấy gói proxy đã chọn."` |
| `partner-dispute` với đơn không tồn tại | 404 | **404** `"Không tìm thấy đơn hàng đối tác cần khiếu nại."` |
| `partner-purchase` với gói **hết hàng** (Datacenter 0.1 USD) | 4xx hết hàng | **200 `success:true`**, `order_id: null`, **không có `status`**, `proxies[].assignment_id` là **assignment CÓ SẴN của tài khoản, đã hết hạn từ 15/07**, `total_cost_usd: 0.1`; credit không đổi, `orders` vẫn rỗng |
| Gửi lại cùng `partner_order_id` | trả lại response cũ | Trả y hệt, không tính tiền (giả định #1 đúng *trong trường hợp này*) |

Hệ quả trong code (`src/adapters/dproxy.py::_parse_purchase`):

- **Chấp nhận** `order_id` null và thiếu `status` (nếu có `status` thì vẫn bắt buộc là `fulfilled`). Định danh của allocation là `assignment_id`, nếu không có thì dùng `order_id`.
- **Từ chối** proxy có `expires_at` sớm hơn `now + số ngày đã bán − expiry_tolerance_hours` (mặc định 6h). Cũng từ chối `assignment_id` đang thuộc một đơn khác. Khi từ chối: hoàn tiền buyer, xếp `partner-dispute`, gửi alert critical.
- Trước lần mua **đầu tiên** của một đơn, adapter hỏi `/store/quote`. Nếu gói hết hàng thì từ chối trước khi mua (alert warning). Lần retry thì **không** hỏi, vì lần mua trước có thể đã lấy mất node cuối.
- Sau khi mua, adapter đọc `/proxies/user` theo `assignment_id` để lấy khối `rotation` thật. Có `rotate_endpoint` hợp lệ thì nút đổi IP mới bật. Response mua không mang thông tin xoay; nhà cung cấp nói xoay hay tĩnh "tuỳ resource", nên sàn **không hứa xoay** trên trang sản phẩm.
- 402, hoặc detail có chữ "credit / hạn mức / số dư / insufficient / debt" → `provider_out_of_credit`: tắt provider. Đơn tiếp theo bị từ chối **trước khi trừ ví**.
- `partner_order_id` được chốt vào `proxy_allocations.partner_order_id`, nên thu hồi luôn gửi đúng id đã mua. Nhờ vậy đổi `DEPLOYMENT_ENVIRONMENT` hay prefix không làm lệch id.

### 8 giả định trong `docs/dproxy/api.md`

| # | Giả định | Trạng thái |
|---|---|---|
| 1 | Gửi trùng `partner_order_id` thì trả lại response cũ | Đúng với đơn "hết hàng". **Chưa kiểm với một đơn mua thành công thật** |
| 2 | `Idempotency-Key` được tôn trọng | Không cần (adapter dựa vào #1) |
| 3 | Key M2M đọc được `/proxies/user` (mảng) | **Đúng** |
| 4 | Node M2M có trong `/proxies/user` | **Có**, dưới đúng `assignment_id` → đổi IP được, đối soát được |
| 5 | Lỗi là 4xx, không phải 200 `success:false` | Plan sai → 404. **Hết hàng lại trả 200 success** (xem bảng trên) |
| 6 | Dispute nhận id do sàn đặt, 404 khi không có | 404 đúng. **Chưa kiểm dispute một đơn có thật** |
| 7 | Mua thành công có `status: fulfilled` | **Sai**: live không có `status` |
| 8 | Lệnh mua trả lời trong < 30s | ~1s cho lệnh mua "hết hàng"; chưa đo lệnh mua thật |

## 3. Câu hỏi gửi DProxy (chặn go-live)

1. Mua gói **Datacenter** (`02a80f8f…`, đang hết hàng theo `/store/quote`) với `partner_order_id=proxora-probe-dc-20260923-01` thì nhận `200 success`, `order_id: null`, **không có `status`**, và proxy là **assignment `e032e17f…` đã có sẵn trên tài khoản, hết hạn từ 2026-07-15**. Credit không bị trừ, `marketplace/orders` vẫn rỗng. Đây là lỗi hay hành vi dự kiến? Khi hết hàng, lệnh mua nên trả mã lỗi gì?
2. Response mua thành công **thật** có `status` và `order_id` không? Xin một mẫu đầy đủ.
3. Có tách được gói **xoay** và **tĩnh** (mỗi loại một `plan_id`), hoặc thêm một trường trên gói (vd `service_type_id`) để biết trước khi mua không? Response `partner-purchase` có trả được khối `rotation` giống `/proxies/user` không?
4. Mã lỗi khi hết **hạn mức tín dụng** là gì (HTTP + detail)?
5. `partner-dispute` hoàn credit toàn phần hay theo ngày đã dùng? Node bị thu hồi ngay không?
6. Có gói ngắn hơn 30 ngày không? `partner-purchase` có tham số thời hạn không? (`/store/quote` nhận `duration_days` nhưng giá không đổi.)
7. Có sandbox / key test riêng không, hay mọi lệnh mua bằng key này đều tính tiền thật?
8. Có cần whitelist IP server của sàn không? Có giới hạn tần suất (rate limit) không?
9. `channel` có cần đăng ký trước không (sàn gửi `proxora`)?
10. Chu kỳ đối soát / thanh toán công nợ (`settlements`) hoạt động thế nào?

## 4. Checklist go-live

### A. Trước khi deploy

1. **Rotate API key.** Key hiện tại đã bị dán vào chat. Lấy key production mới từ DProxy và chỉ nhập qua form admin (được mã hoá ở DB).
2. Có câu trả lời cho các câu hỏi 1, 2, 4 ở §3. Nếu DProxy thay đổi contract, sửa `_parse_purchase` và mock, rồi chạy lại test.
3. Nếu vẫn dùng chung một tài khoản DProxy cho staging và prod: đặt `DEPLOYMENT_ENVIRONMENT` đúng cho từng môi trường để prefix `partner_order_id` không trùng (prod là `proxora-`, môi trường khác là `proxora-{env}-`).
4. Chốt tỷ giá hiển thị USD/VND ở Settings › Tiền tệ. Đây là cơ sở tính giá vốn và biên lãi.
5. Mail: SES đang cấu hình ở admin (Settings › Mail). Ai nhận alert thì phải là tài khoản admin đang active.

### B. Deploy

6. Backup DB production trước khi deploy.
7. Migration: `fp1a2b3c4d5e6` (`supplier_catalog_items.extra`), `fq1a2b3c4d5e6` (`upstream_revocations` + cột mới trên `proxy_allocations`) `fs1a2b3c4d5e6` (`providers.public_key`, backfill key ngẫu nhiên) và `ft1a2b3c4d5e6` (dashboard /proxies: phân loại dòng, ghi chú, `proxy_tags`). Nhánh `feat/igbm-sources-ux` cũng có `fr1a2b3c4d5e6` nối tiếp `fo`, nên khi merge cả hai nhánh cần một merge revision với `down_revision = ("fs1a2b3c4d5e6", "fr1a2b3c4d5e6")`. Container tự chạy `alembic upgrade head` lúc khởi động (`marketplace-svc/Dockerfile`). Test `tests/test_alembic_heads.py` chặn trường hợp có 2 head.
8. Chỉ **một** tiến trình uvicorn chạy scheduler (CMD hiện tại không có `--workers`). Có thêm hai job mới: `upstream_revocation` (2 phút) và `dproxy_credit_check` (30 phút).
9. Egress: server backend phải gọi được `https://api.dproxy.info:443`. Kiểm từ **trong container**, không có key sẽ nhận 401: `curl -sS -o /dev/null -w '%{http_code}' https://api.dproxy.info/api/v1/store/plans`.

### C. Cấu hình trên production

10. `/admin/sources/new` → chọn **DProxy (M2M)** → Base URL `https://api.dproxy.info`, xác thực `X-API-Key`, channel `proxora`, lãi tối thiểu, ngưỡng hạn mức `low_credit_usd` → **Kiểm tra**. Trạng thái `warning` "không đọc được danh sách proxy" vẫn bán được, chỉ là không bật được đổi IP.
11. Giao nguồn cho seller nội bộ (tạo mới ở bước 2 của wizard, hoặc chọn seller có sẵn; wizard tự bật `is_internal`). Nên sửa bio cửa hàng để không lộ "sàn vận hành".
12. **Đồng bộ ngay.** Bảng gói sẽ hiện giá vốn VND, tồn (`available_count`) và loại proxy.
13. **Thêm gói:**
    - Chọn gói, nhập *nhà mạng / quốc gia*. DProxy không khai trường này; đây là nhãn buyer thấy, nên điền đúng thực tế.
    - Số ngày bị khoá đúng bằng thời hạn gói. Gói nhiều proxy mỗi lượt mua (Mobile 5 proxy) và gói đang tắt không nhập được.
    - Đặt giá bán ≥ mức tối thiểu. Để trạng thái **Nháp**.

### D. Nghiệm thu (tốn tiền thật)

14. Mua thử 1 đơn gói rẻ nhất **còn hàng** bằng tài khoản buyer thật:
    - Đơn phải `delivered`.
    - Proxy kết nối được.
    - `proxy_allocations` có `partner_order_id`, `upstream_cost_usd` và `external_id = assignment_id`.
    - `credit-summary` tăng công nợ đúng giá.
    - Nếu node có rotation: nút đổi IP hoạt động và cooldown đúng.
15. Mở khiếu nại cho đơn đó, admin hoàn tiền toàn bộ. Trong vòng ≤ 2 phút, `upstream_revocations` phải chuyển sang `done / revoked`. Kiểm credit được hoàn và node bị thu hồi.
16. Chuyển sản phẩm sang **Đang bán**.

### E. Vận hành

17. `/admin/alerts`: `provision_operational` (critical), `provider_out_of_credit`, `provider_low_credit`, `upstream_revoke_failed`, `provision_stuck`. Sự cố critical mới được gửi email.
18. Khi hết hạn mức, provider tự tắt. Thanh toán công nợ hoặc nâng hạn mức bên DProxy, rồi bật lại provider ở `/admin/providers`.
19. `upstream_revoke_failed`: gửi dispute tay theo `partner_order_id` trong alert, đối soát bằng `credit-summary`.

### F. Rollback

20. Tắt provider DProxy (`is_active=false`). Sản phẩm sẽ bị khoá nút mua. Đơn đang giao vẫn đổi IP / hết hạn bình thường (job hết hạn vẫn chạy cả khi provider tắt). Outbox thu hồi vẫn chạy.
21. Rollback code: migration `fq`/`fp` chỉ **thêm** bảng/cột, nên bản cũ vẫn chạy được trên schema mới. Chỉ `alembic downgrade` khi thật sự cần.

## 5. Chưa làm (ngoài phạm vi đợt này)

- Gia hạn proxy (DProxy chưa có API gia hạn cho đơn M2M). Hiện hết hạn thì buyer mua đơn mới và nhận IP mới.
- Đối soát tự động với `marketplace/orders` / `settlements`. Live đang trả rỗng ngay cả sau lệnh mua "thành công", nên chờ DProxy trả lời §3.10.
- Hoàn tiền một phần không gọi thượng nguồn. Chưa có chính sách bảo hành theo ngày cho proxy cố định thời hạn.
