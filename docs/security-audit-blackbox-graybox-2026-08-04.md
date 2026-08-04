# Báo cáo audit bảo mật API — Blackbox & Graybox

**Dự án:** `market_site`
**Ngày kiểm tra:** 2026-08-04 (Asia/Ho_Chi_Minh)
**Mục tiêu ban đầu:** `http://localhost:3000/`
**Phương pháp:** Blackbox có kiểm soát + Graybox source/config/dependency review
**Mức rủi ro tổng thể:** **CRITICAL**

## 1. Tóm tắt điều hành

Audit xác nhận hai vấn đề Critical có bằng chứng runtime:

1. Frontend đang chạy Next.js `15.5.4`, thuộc dải ảnh hưởng của lỗ hổng React Server Components/Flight có khả năng thực thi mã từ xa (CVSS 10 theo advisory), cùng nhiều advisory High khác. Dự án dùng App Router/RSC nên lỗ hổng có tính áp dụng thực tế, không chỉ là package nằm thừa trong lockfile.
2. Backend local `127.0.0.1:8001` thực sự chấp nhận JWT secret và internal API key mặc định. Kết hợp với CORS cho phép origin tùy ý, browser độc hại có thể gọi API localhost bằng token tự ký. Local còn bật `ENABLE_DEMO_TOPUP=true`, làm tăng tác động nếu tìm được account ID hợp lệ.

Ngoài ra có các vấn đề High về brute force login, SSRF qua DNS rebinding, và lưu secret production dạng plaintext; một endpoint public làm lộ dữ liệu vận hành/kinh doanh vốn được frontend dùng trong trang admin.

Không thực thi payload RCE, không đọc dữ liệu của account thật, không tạo đơn hàng/thanh toán/top-up, không thử phá hoại dữ liệu. Các probe production chỉ là GET, preflight, token/key giả, và đăng nhập sai có kiểm soát.

### Thống kê phát hiện

| Mức | Số lượng |
|---|---:|
| Critical | 2 |
| High | 4 |
| Medium | 5 |
| Low / hardening | 2 |

## 2. Phạm vi và topology thực tế

Blackbox cho thấy có hai đường đi khác nhau:

```text
Browser -> localhost:3000 (Next.js 15.5.4)
             |
             +-- /api/* rewrite -> https://api-market.taskforces.info/*

Frontend bundle -> NEXT_PUBLIC_API_URL=http://localhost:8001
                                      |
                                      +-> FastAPI local (127.0.0.1:8001)
```

Do đó:

- Kết quả gọi `http://localhost:3000/api/*` phản ánh backend production qua reverse proxy.
- Kết quả gọi `http://127.0.0.1:8001/*` phản ánh backend local.
- Cấu hình này tạo trạng thái split-brain: cùng một UI nhưng request có thể đi đến hai backend khác nhau tùy cách client gọi API.
- Source có route `/version`, nhưng cả local và production runtime đều trả 404; đây là dấu hiệu source/runtime hoặc deployment đang lệch phiên bản.

## 3. Bề mặt API

Knowledge graph tìm thấy **145 handler** trong `marketplace-svc/src`, thuộc 24 router/module. Có **77 route chứa path parameter dạng ID**, là bề mặt cần ưu tiên kiểm tra BOLA/IDOR.

| Router/module | Số endpoint |
|---|---:|
| products | 17 |
| providers | 15 |
| wallet | 13 |
| resources | 12 |
| orders | 11 |
| disputes | 11 |
| affiliate | 7 |
| auth | 7 |
| payments | 7 |
| pricing | 5 |
| seller | 5 |
| gateway | 4 |
| categories | 4 |
| alerts | 4 |
| main/docs/health | 4 |
| resource proxy | 3 |
| notifications | 3 |
| seller API keys | 3 |
| sellers | 2 |
| reviews | 2 |
| tasks | 2 |
| usage | 2 |
| debug | 1 |
| audit | 1 |

### Endpoint public hoặc có cơ chế auth riêng

- `POST /auth/login`, `POST /auth/register`
- `GET /categories`
- `GET /products`, `GET /products/{product_id}`
- `GET /products/{product_id}/operations`
- `GET /products/{product_id}/pricing-options`
- `POST /products/{product_id}/calculate`
- `GET /products/{product_id}/reviews`
- `GET /sellers/top`, `GET /sellers/{seller_id}`
- `POST /affiliate/click`
- `ANY /gw/{gateway_key}/{endpoint:path}` — dùng gateway key
- `POST /webhooks/payos` — chữ ký PayOS cho event thực
- `POST /webhooks/providers/{provider_id}/tasks/{external_task_id}` — HMAC theo provider
- `GET /health`, `/docs`, `/redoc`, `/openapi.json`
- `GET /version` tồn tại trong source nhưng chưa xuất hiện ở runtime đã kiểm tra

Kiểm tra tĩnh cho thấy **58/58 admin handler** có `require_role`; **3/3 internal handler** có `verify_internal_key`. Đây là tín hiệu tốt, nhưng internal key mặc định làm giảm hiệu lực bảo vệ ở local/dev.

## 4. Chi tiết phát hiện

### SEC-01 — Critical — Next.js 15.5.4 có lỗ hổng RSC/Flight RCE

**Bằng chứng**

- `frontend/package.json`, lockfile và HTTP fingerprint đều xác nhận Next.js `15.5.4`.
- `npm audit --omit=dev` báo 1 package Critical và 2 package High trong production dependency tree.
- Advisory Critical `GHSA-9qr9-h5gf-34mp` ảnh hưởng Next.js trước `15.5.7`; audit còn báo các advisory High khác được vá ở các bản mới hơn.
- Dự án dùng `frontend/app`, tức App Router/React Server Components — đúng bề mặt bị ảnh hưởng.

**Tác động**

Kẻ tấn công từ xa có thể nhắm vào React Flight/RSC để thực thi mã trong tiến trình Next.js tùy điều kiện advisory, từ đó lấy environment secret, gọi backend nội bộ hoặc chiếm máy chạy frontend.

**Khắc phục**

Nâng ngay Next.js lên bản vá mới nhất tương thích; tại thời điểm audit, `npm audit` đề xuất `15.5.22`. Rebuild image/artifact từ sạch, triển khai lại, rồi xoay mọi secret mà process Next.js từng có quyền đọc. Không chỉ sửa tối thiểu lên `15.5.7` vì còn nhiều advisory sau mốc đó.

### SEC-02 — Critical — Secret mặc định được backend local chấp nhận

**Vị trí liên quan**

- `marketplace-svc/src/config.py`
- `marketplace-svc/.env`, `.env.dev`
- Auth dependency và internal-key dependency trong backend

**Bằng chứng runtime an toàn**

- Token HS256 tự ký bằng giá trị JWT dev mặc định, với `sub` là account ID không tồn tại, gọi `GET /me` tại local nhận `401 Không tìm thấy tài khoản` thay vì `401 Token không hợp lệ`. Điều này chứng minh chữ ký đã được chấp nhận; probe không truy cập account thật.
- Gửi `X-Internal-Key` bằng giá trị dev mặc định tới internal endpoint với body rỗng nhận 422 báo thiếu `variant_id`, chứng minh request đã qua bước kiểm tra internal key.
- Hai giá trị mặc định tương tự bị production từ chối, nên bằng chứng này hiện áp dụng chắc chắn cho local backend.
- Local `.env` bật `ENABLE_DEMO_TOPUP=true`.

**Chuỗi tấn công**

```text
Trang web độc hại
  -> CORS cho phép gọi localhost:8001 với Authorization
  -> tự ký JWT bằng secret mặc định
  -> dò account ID qua khác biệt phản hồi
  -> truy cập chức năng account tương ứng
  -> có thể lạm dụng demo top-up nếu tìm được account hợp lệ
```

Role admin được đọc lại từ DB chứ không tin claim `roles`, đây là kiểm soát tốt; tuy nhiên attacker vẫn có thể mạo danh account đã tồn tại nếu biết/dò được ID.

**Khắc phục**

- Không được có giá trị secret mặc định có thể khởi động ứng dụng. Production/dev server phải fail-fast nếu key thiếu, quá ngắn, hoặc trùng denylist.
- Xoay JWT secret, internal API key, encryption key; revoke token đang tồn tại.
- Tắt demo top-up theo mặc định và tách feature này khỏi build/runtime có dữ liệu thật.
- Không dùng ID tuần tự làm định danh đủ để tạo JWT; nên thêm token version/session ID và cơ chế revoke.

### SEC-03 — High — Không có rate limit cho đăng nhập

**Bằng chứng**

15 lần đăng nhập sai liên tiếp trên local và production đều trả 401; không có 429, backoff hoặc challenge. Source chỉ có rate limiter riêng cho gateway, không thấy limiter chung cho auth.

**Tác động**

Cho phép credential stuffing, password spraying và brute force phân tán. Thông báo lỗi login là generic nên không lộ trực tiếp email tồn tại, nhưng không đủ thay thế rate limiting.

**Khắc phục**

Áp dụng limiter nhiều tầng theo IP, account/email chuẩn hóa, subnet và device/session; dùng exponential backoff, metric/alert, và CAPTCHA/challenge khi rủi ro tăng. Thiết kế chống distributed spray và tránh tạo DoS khóa account cho nạn nhân.

### SEC-04 — High — SSRF vẫn có thể qua DNS rebinding/TOCTOU

**Vị trí liên quan**

- Hàm validate seller/provider base URL
- Luồng adapter HTTP gọi URL seller/provider

**Điểm tốt hiện có**

Validator yêu cầu HTTPS, resolve hostname và chặn private/loopback/link-local/multicast/reserved/unspecified; HTTP client tắt redirect.

**Lỗ hổng còn lại**

Validation resolve DNS một lần, sau đó `httpx` resolve hostname lại khi kết nối. Domain do seller kiểm soát có thể trả IP public ở lần kiểm tra và trả IP private/metadata ở lần kết nối. Nếu lần resolve validation lỗi, một số nhánh còn để request thật tự resolve sau. Đây là lỗi time-of-check/time-of-use; chưa gửi payload tới metadata/internal service trong audit.

**Khắc phục**

- Resolve một lần, kiểm tra toàn bộ A/AAAA, sau đó kết nối tới IP đã được pin trong khi giữ đúng SNI/Host và kiểm tra certificate hostname.
- Chặn egress ở network layer tới loopback, RFC1918, link-local, metadata IP và mạng nội bộ; đây phải là lớp bảo vệ bắt buộc, không chỉ application validation.
- Kiểm tra lại mọi redirect nếu sau này bật redirect.

### SEC-05 — High — Secret production và file backup lưu plaintext, quyền 0644

**Bằng chứng**

- Workspace có `.env.production` và `.env.production.bk`, chứa các trường PayOS/encryption có giá trị không rỗng.
- Các file có mode `-rw-r--r--` (0644), đọc được bởi user khác trên cùng máy theo mô hình quyền Unix.
- File backup lặp secret và tăng số bản sao cần quản lý.
- Các file hiện được gitignore và không thấy tracked trong Git; audit không in hoặc ghi lại giá trị secret.

**Tác động**

Malware, user cùng host, artifact đóng gói sai, backup hoặc thao tác hỗ trợ có thể làm lộ khóa thanh toán và encryption key production.

**Khắc phục**

Xoay các secret hiện có, đưa vào secret manager/runtime injection, xóa bản backup sau khi xác nhận nơi lưu an toàn, đặt quyền tối thiểu 0600 nếu buộc dùng file, và thêm secret scanning ở pre-commit/CI cùng kiểm tra lịch sử Git/artifact.

### SEC-06 — High — CORS cho phép origin tùy ý; production trả header trùng/mâu thuẫn

**Bằng chứng runtime**

- Local preflight từ `https://evil.example` với header `Authorization` trả 200, phản chiếu origin, bật credentials và cho phép Authorization.
- Source cấu hình `allow_origins=["*"]`, `allow_credentials=True`, methods/headers đều wildcard.
- Qua production rewrite, preflight trả `Access-Control-Allow-Origin: *` cùng credentials; request thường có lúc trả giá trị ghép `https://evil.example, *` và credentials trùng. Điều này cho thấy nginx và ứng dụng cùng chèn CORS không nhất quán.

**Tác động**

CORS rộng làm trang web bất kỳ gọi được API từ browser. Với bearer token trong localStorage, nó không tự đọc được token cross-origin; nhưng khi kết hợp secret mặc định ở SEC-02, nó biến backend localhost thành mục tiêu có thể khai thác trực tiếp. Header trùng có thể tạo hành vi khác nhau giữa browser/proxy/cache.

**Khắc phục**

Dùng allowlist origin chính xác theo môi trường, bỏ credentials nếu không dùng cookie, chỉ cho phép method/header cần thiết, và để đúng một tầng chịu trách nhiệm CORS. Không cho origin tùy ý truy cập service localhost/dev.

### SEC-07 — Medium — Public endpoint làm lộ dữ liệu vận hành và kinh doanh

**Endpoint:** `GET /products/{product_id}/operations`

**Bằng chứng**

Không yêu cầu account/auth. Với product tồn tại, cả local và production trả thông tin provider ID/name, adapter, trạng thái active/health, pricing strategy/params, setup mode, tổng đơn, doanh thu, success rate và dispute count. Frontend dùng endpoint này trong vùng admin, nên việc public dữ liệu không khớp ngữ cảnh sử dụng.

**Tác động**

Đối thủ hoặc attacker có thể lập bản đồ provider, tình trạng tích hợp, doanh thu và chất lượng vận hành; hỗ trợ chọn mục tiêu và phân tích business.

**Khắc phục**

Yêu cầu role admin/seller phù hợp; nếu cần dữ liệu public thì tạo DTO public riêng chỉ chứa trường đã duyệt. Thêm test anonymous=401/403 và ownership cho seller.

### SEC-08 — Medium — Split-brain API configuration và source/runtime drift

**Bằng chứng**

- Next rewrite `/api/*` dùng `API_URL=https://api-market.taskforces.info`.
- Client-exposed `NEXT_PUBLIC_API_URL=http://localhost:8001`.
- Route `/version` tồn tại trong source nhưng local và production runtime đều trả 404.

**Tác động**

Test local có thể vô tình chạm production; browser production có thể cố gọi `localhost` của chính người dùng; policy/auth/CORS khác nhau theo đường đi; source audit không hoàn toàn trùng artifact đang chạy.

**Khắc phục**

Dùng một API origin chuẩn qua same-origin proxy, validate biến môi trường lúc build/start, cấm localhost trong production build, ghi build SHA vào health/version an toàn, và triển khai artifact bất biến có provenance.

### SEC-09 — Medium — Dependency Python và transitive frontend có CVE High

`pip-audit` báo `cryptography 49.0.0` dính `CVE-2026-69247`, bản sửa `50.0.0`. `npm audit` còn báo `postcss` và `sharp` ở mức High trong production tree.

Khắc phục bằng nâng version có kiểm soát, chạy regression test, rebuild artifact và đưa `npm audit --omit=dev`/`pip-audit` vào CI với policy chặn Critical/High có bản vá.

### SEC-10 — Medium — Thiếu browser security headers; token lưu localStorage

**Bằng chứng**

Response Next.js thiếu CSP, `X-Content-Type-Options`, frame protection (`frame-ancestors` hoặc X-Frame-Options) và Referrer-Policy; đồng thời lộ `X-Powered-By: Next.js`. Backend lộ server fingerprint Uvicorn/nginx. Frontend lấy bearer token từ `window.localStorage`.

**Tác động**

Nếu xuất hiện XSS hoặc dependency frontend bị chiếm, localStorage token có thể bị đọc trực tiếp. Thiếu CSP làm giảm lớp giới hạn hậu khai thác; thiếu frame protection tạo nguy cơ clickjacking cho thao tác nhạy cảm.

**Khắc phục**

Triển khai CSP theo nonce/hash, `frame-ancestors`, `nosniff`, Referrer-Policy, Permissions-Policy và HSTS ở HTTPS edge. Tắt powered-by/server banner. Cân nhắc access token ngắn hạn trong memory và refresh token HttpOnly/Secure/SameSite kèm CSRF protection.

### SEC-11 — Medium — Route debug `/version` có dữ liệu nhạy cảm nếu được deploy

Source route public trả git SHA/build time/start time, Alembic head/current revision, DB product count và có nhánh trả `repr(e)` của lỗi DB. Runtime hiện trả 404 nên đây là latent finding/source drift, không phải exposure đã xác nhận trên instance hiện tại.

Khắc phục bằng xóa route khỏi production, hoặc chỉ trả version opaque/build ID không tiết lộ DB/schema/error; chi tiết phải yêu cầu admin và không trả exception thô.

### SEC-12 — Low — Public OpenAPI/Swagger/Redoc hỗ trợ enumeration

`/openapi.json` (~156 KB), `/docs` và `/redoc` đều public ở local và production. Điều này không tự tạo lỗ hổng nhưng cung cấp danh sách route/schema đầy đủ, giảm đáng kể chi phí reconnaissance.

Khắc phục bằng tắt ở production hoặc bảo vệ bằng admin/VPN. Nếu API cố ý public, có thể giữ spec public nhưng cần xem đây là quyết định sản phẩm và không dựa vào việc giấu route để bảo mật.

### SEC-13 — Low — Các điểm abuse/oracle và rate-limit design

- `POST /affiliate/click` nhận `visitor_id` do client cung cấp; attacker có thể luân phiên ID để thổi phồng click metric.
- Provider webhook trả 404 theo provider ID trước bước xác minh chữ ký, tạo oracle ID tồn tại mức thấp.
- Gateway rate limit chỉ theo gateway key; key ngẫu nhiên có thể tạo DB lookup và né bucket theo-key. Limiter fail-open khi Redis lỗi.
- Gateway call log lưu request payload và response body rút gọn; cần data classification/redaction/retention để tránh lưu credential/PII ngoài ý muốn.
- `GET /products?per_page=1` vẫn trả toàn bộ catalog trong thử nghiệm, gồm exact stock và seller ID; nên kiểm tra lại pagination và trường public.

## 5. Kiểm soát tốt đã xác nhận

- JWT decoder khóa thuật toán cấu hình; token `alg=none` bị từ chối.
- Role được lấy lại từ account trong DB, không tin trực tiếp `roles` claim trong JWT.
- 58/58 admin handler có role dependency; 3/3 internal handler có key dependency.
- Login dùng thông báo lỗi generic cho email không tồn tại và mật khẩu sai.
- Webhook dùng HMAC và `compare_digest`; PayOS body rỗng chỉ được coi là ping, event có data vẫn yêu cầu signature.
- Markdown renderer đặt `disableParsingRawHTML: true`; chưa xác nhận stored XSS từ markdown.
- Truy vấn DB chủ yếu dùng SQLAlchemy/parameter binding; không tìm thấy SQL injection xác nhận.
- Subprocess dùng `create_subprocess_exec` với script path cố định; không thấy `shell=True`/command injection.
- SSRF validator đã chặn nhiều lớp IP nguy hiểm và client tắt redirect, dù còn TOCTOU.

## 6. Kết quả blackbox tiêu biểu

| Kiểm tra | Local backend | Production qua `:3000/api` |
|---|---|---|
| Anonymous admin/seller route | 401 | 401 |
| JWT `alg=none` | 401 | 401 |
| JWT ký bằng dev default | Qua chữ ký, dừng ở account lookup | Bị từ chối |
| Internal dev key | Qua key, dừng ở body validation | Bị từ chối |
| 15 login sai liên tiếp | 15×401, không 429 | 15×401, không 429 |
| Evil-origin CORS preflight | Cho phép | Cho phép/header mâu thuẫn |
| `/openapi.json`, `/docs`, `/redoc` | Public | Public |
| `/products/1/operations` | 200, lộ operational data | 200, lộ operational data |
| `/version` | 404 | 404 |

## 7. Kết quả test tự động

Backend test suite hoàn tất bằng `uv run pytest -q`:

- **603 passed, 10 failed**, thời gian 992.67 giây.
- Cả 10 failure nằm trong `tests/test_adapters.py::TestAdapterFactory` và có cùng nguyên nhân gốc.
- `get_adapter()` hiện từ chối provider khi `review_status != "approved"`; helper `_make_provider()` tại `tests/test_adapters.py:106` tạo `MagicMock` nhưng không gán `review_status`, nên giá trị trở thành một `MagicMock` và toàn bộ test dừng ở guard mới trước khi kiểm tra hành vi adapter/fallback dự kiến.
- Đây là regression hoặc test-fixture mismatch trong worktree hiện tại, không được tính thành 10 lỗ hổng bảo mật độc lập. Cần cập nhật fixture để đặt trạng thái approved mặc định, đồng thời thêm test riêng cho pending/rejected provider; sau đó chạy lại toàn suite.

Dependency audit:

- npm production: 1 Critical, 2 High package findings; direct Next.js cần nâng cấp.
- Python: 1 CVE trong `cryptography 49.0.0`, fix ở `50.0.0`.

## 8. Kế hoạch khắc phục ưu tiên

### Trong 24 giờ

1. Nâng Next.js lên bản đã vá toàn bộ advisory hiện biết, rebuild và deploy lại.
2. Xoay JWT/internal/encryption/PayOS secret; loại default secret; tắt demo top-up ngoài môi trường test cô lập.
3. Thu hẹp CORS về allowlist và bỏ cấu hình CORS trùng ở proxy/app.
4. Bảo vệ hoặc tạm tắt `/products/{id}/operations`.
5. Chặn brute force ở login tại edge và application.

### Trong 1–3 ngày

1. Chuyển secret sang secret manager, loại file backup plaintext, kiểm tra lịch sử Git/build artifact/log.
2. Sửa split-brain URL và thêm startup/build validation.
3. Nâng `cryptography`, `postcss`, `sharp`; thêm dependency gate trong CI.
4. Tắt/bảo vệ OpenAPI docs và debug route ở production.
5. Thêm browser security headers và kế hoạch giảm phụ thuộc localStorage token.

### Trong 1 tuần

1. Sửa SSRF theo mô hình DNS pinning + network egress deny.
2. Viết authorization matrix/test cho toàn bộ 77 route có ID parameter.
3. Thêm abuse protection cho affiliate, gateway và webhook; limiter nên fail-closed hoặc degrade có kiểm soát cho thao tác nhạy cảm.
4. Thiết lập log redaction, retention và cảnh báo auth/gateway bất thường.
5. Chạy lại blackbox sau deploy trên đúng artifact/build SHA.

## 9. Tiêu chí retest

- Next runtime không còn nằm trong bất kỳ dải advisory Critical/High đã nêu.
- Token/key mặc định không thể khởi động app hoặc xác thực ở mọi environment.
- Origin ngoài allowlist không nhận CORS allow header.
- Login trả 429/backoff theo policy, có metric/alert và chống distributed spray.
- Anonymous không đọc được operational statistics/provider details.
- DNS rebinding test không thể kết nối tới IP private/metadata, kể cả khi DNS answer thay đổi giữa các lần resolve.
- Production bundle không chứa `localhost:8001`; `/api` chỉ có một upstream xác định.
- Secret scan toàn bộ Git history/artifact sạch; secret cũ đã revoke.
- Bộ test authorization cho admin/seller/buyer/anonymous chạy pass trên artifact triển khai.

## 10. Giới hạn của đợt kiểm tra

- Không có test account hợp lệ cho buyer/seller/admin, nên chưa thực hiện dynamic BOLA/IDOR giữa hai account thật; graybox đã kiểm tra dependency/ownership và xác định 77 route cần matrix retest.
- Không gửi exploit RCE, SSRF metadata, payload thanh toán, top-up hay mutation có tác động dữ liệu.
- Một phần request qua `localhost:3000/api` đi tới production do cấu hình rewrite; các probe production đã được giới hạn ở read-only/invalid-auth.
- Kết quả phản ánh source/worktree và runtime quan sát ngày 2026-08-04; deployment drift đã được ghi rõ.
