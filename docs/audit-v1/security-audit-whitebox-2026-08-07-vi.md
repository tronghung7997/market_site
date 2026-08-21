# Báo Cáo Kiểm Toán Bảo Mật — Marketplace market_site

> **Phân loại:** Bí mật — Chỉ dùng nội bộ  
> **Ngày:** 2026-08-07  
> **Nhánh:** check-security  
> **Stack:** FastAPI 0.115 · Next.js · PostgreSQL · Redis · Docker  
> **Mức rủi ro tổng thể:** 🔴 NGHIÊM TRỌNG — Không triển khai trong trạng thái hiện tại  
> **Kiểm toán viên:** Phân tích tĩnh white-box (có toàn quyền truy cập source code)

---

## 01 Tóm Tắt Điều Hành

**Không triển khai trong trạng thái hiện tại.** Tồn tại bốn lỗ hổng nghiêm trọng: secrets production đã bị commit vào git, tài khoản admin có mật khẩu hoạt động được seed vào database production, lỗ hổng logic nghiệp vụ cho phép bất kỳ buyer xác thực nào tạo ra số dư ví tùy ý, và một race condition cho phép chi tiêu gấp đôi.

| Mức độ | Số lượng |
|--------|----------|
| Nghiêm trọng (Critical) | 4 |
| Cao (High) | 5 |
| Trung bình (Medium) | 9 |
| Thấp/Thông tin (Low/Info) | 6 |
| **Tổng cộng** | **24** |

Codebase thể hiện rõ dấu hiệu của threat modelling có chủ đích: bảo vệ SSRF với DNS-pinning, xác thực webhook theo hướng fail-closed, phòng thủ CSRF qua Fetch-Metadata, validation cấu hình lúc khởi động, và coverage auth-dependency gần như hoàn chỉnh trên ~20 router. Rủi ro nghiêm trọng tập trung ở **quản lý secrets** và **logic tài chính**.

### Các Kiểm Soát Bảo Mật Tốt

- ✅ Validation cấu hình lúc khởi động từ chối secrets không an toàn, bắt buộc ≥32 byte entropy cho ba secrets độc lập
- ✅ SSRF guard với DNS-pinning xác thực lại trên mỗi lần gọi ra ngoài; đóng lỗ DNS-rebinding TOCTOU; `trust_env=False` chặn bypass qua proxy
- ✅ Webhook PayOS: `compare_digest`, từ chối key rỗng, từ chối số tiền âm, kiểm tra chéo `paymentLinkId`, idempotency qua unique constraint, khóa `FOR UPDATE`
- ✅ Webhook provider fail-closed — không có secret cấu hình thì từ chối mọi callback
- ✅ Cookie httpOnly + `sameSite: strict` + `secure`; không lưu token trong `localStorage`; CSRF qua Fetch-Metadata với fallback Origin
- ✅ Coverage auth-dependency hoàn chỉnh trên toàn bộ router được bảo vệ
- ✅ Chặn path traversal ở gateway: `^[A-Za-z0-9_-]{1,64}$` + allowlist endpoint tường minh
- ✅ Security event telemetry với keyed HMAC principal fingerprints
- ✅ Rate limiting auth theo cả IP lẫn hashed email; `fail_open=False`
- ✅ Sentry scrubbing: `send_default_pii=False`, bỏ body/query/cookie, redact gateway keys khỏi URL paths
- ✅ Credentials provider mã hóa at-rest bằng Fernet; mã hóa chọn lọc từng field; re-encryption idempotent
- ✅ Toàn bộ SQL được parameterized — không tìm thấy câu truy vấn nối chuỗi
- ✅ Cardinality guard metrics gộp route không khớp để ngăn exhaustion bộ nhớ do scanner

---

## 02 Kiểm Tra Kiến Trúc Hệ Thống

```
Internet
   |
   |--- :3001 --► frontend (Next.js)
   |                  |  /api/[...path] proxy -> marketplace-svc:8001
   |
   └--- :8001 --► marketplace-svc (FastAPI)   <- lộ thẳng ra host, không có TLS proxy
                     |
              [bridge network market_site]
                     |
           +---------+-----------+
           |                     |
        postgres:5432         redis:6379
        (không publish port    (không xác thực,
         trong prod compose)    không publish port)

Cloudflare Tunnel — token bị commit vào git (đã comment out nhưng còn trong history)
Private registry: registry.k7:5000 (HTTP thuần, không pin digest)
```

**Đánh giá bề mặt tấn công:** Việc lộ FastAPI trực tiếp trên port 8001 bỏ qua mọi WAF/TLS layer. Kết hợp với `DEPLOYMENT_ENVIRONMENT` mặc định là `development` (H-1), HSTS và các guardrail production đều không hoạt động. Redis không có xác thực — bất kỳ process nào trên Docker network đều có thể xóa bộ đếm rate-limit.

---

## 03 Báo Cáo Kiểm Toán Frontend

| ID  | Tiêu đề | Mức độ | File |
|-----|---------|--------|------|
| M-6 | API proxy chuyển tiếp headers tùy ý từ client lên upstream | Trung bình | `frontend/app/api/[...path]/route.ts:71` |
| L-1 | CSP cho phép `unsafe-inline` cho script và style | Thấp | `frontend/next.config.mjs:26` |
| L-2 | An toàn URL trong Markdown phụ thuộc vào internals của thư viện | Thấp | `frontend/components/MarkdownContent.tsx:51` |

**Chi tiết M-6:** Chỉ loại bỏ `host`, `cookie`, `content-length`, `connection`, `authorization` khỏi request proxy. Các header như `x-internal-key`, `x-seller-api-key`, `x-forwarded-*` đều được chuyển qua — biến Next.js proxy public thành relay tới mọi route backend kể cả `/internal/*` và `/webhooks/payos`. Cách sửa: chuyển sang allowlist headers được phép chuyển tiếp.

**Điểm tốt:** `npm audit` = 0 lỗ hổng. Cookie session httpOnly, sameSite strict, và secure. Dockerfile frontend chạy với user non-root `app`.

---

## 04 Báo Cáo Kiểm Toán Backend API

| ID  | Tiêu đề | Mức độ | CVSS | File |
|-----|---------|--------|------|------|
| C-3 | `quantity` âm tạo số dư ví tùy ý | Nghiêm trọng | 9.3 | `src/orders/schemas.py:8` |
| M-2 | Mật khẩu đăng nhập quá dài gây lỗi 500 không xử lý | Trung bình | 5.3 | `src/auth/schemas.py:31` |
| M-9 | Điểm SSRF tiềm ẩn trong health probe của provider | Trung bình | 4.0/7.5 | `src/scheduler.py:281` |
| L-6 | Webhook PayOS không có rate limit | Thấp | 3.1 | `src/payments/router.py:42` |

**Chi tiết C-3:**
```python
# src/orders/schemas.py:8
quantity: int = 1          # thiếu ràng buộc ge=1

# src/orders/service.py:56
total = variant.price * quantity   # quantity=-100 → total âm

# src/wallet/service.py:93-95
if wallet.available_balance < amount:  # 0 < -500000 là False → qua kiểm tra
    raise InsufficientCredit()
wallet.available_balance -= amount     # -= -500000  →  +500000 (tạo tiền)
```
Bất kỳ buyer đã xác thực nào có thể tạo số dư không giới hạn bằng một request POST duy nhất vào bất kỳ sản phẩm nào có delivery thủ công, sau đó rút ra thành tiền mặt.

Cách sửa: `quantity: int = Field(1, ge=1, le=100)` + `if amount <= 0: raise` trong tất cả các hàm biến đổi ví.

**Chi tiết M-9:** `scheduler.py:281` gọi GET đến `provider.config["health_endpoint"]` không qua SSRF guard, không có `follow_redirects=False`. Hiện chưa khai thác được — job chưa được lên lịch. Chỉ cần thêm một dòng `scheduler.add_job` là có thể khai thác ngay (CVSS tiềm ẩn 7.5).

---

## 05 Kiểm Toán Xác Thực & Phân Quyền

| ID  | Tiêu đề | Mức độ | CVSS | File |
|-----|---------|--------|------|------|
| C-1 | Tài khoản admin hoạt động được seed vào database production | Nghiêm trọng | 9.8 | `docker-compose.yml:18` |
| C-2 | Secrets production thật được commit vào git history | Nghiêm trọng | 9.1 | `docker-compose.yml:11,39,41,42` |
| H-3 | Không có cơ chế thu hồi token — token bị đánh cắp có thể refresh vô thời hạn | Cao | 7.1 | `src/auth/router.py:80` |
| M-8 | API key của seller không bao giờ hết hạn và không có scope | Trung bình | 4.8 | `src/seller_api_keys/service.py:11` |
| L-3 | JWT decode thiếu validation required-claims và iss/aud | Thấp | 3.1 | `src/auth/service.py:32` |

**Chi tiết C-1:**
```yaml
# docker-compose.yml:18
- ./db/marketplace-seed.sql:/docker-entrypoint-initdb.d/02-seed.sql
```
```sql
-- db/marketplace-seed.sql:1006
-- admin@dxtrade.example.com  {buyer,admin,seller}  Mật khẩu: DemoPass123!
-- Đã xác minh: bcrypt.checkpw(b'DemoPass123!', hash) == True
```
Chạy trên mọi volume mới. Bất kỳ ai đọc được repo đều có quyền admin đầy đủ: phê duyệt rút tiền, nạp ví bất kỳ, thay đổi roles, đọc toàn bộ PII và dữ liệu thanh toán. Account ID 1 cũng là ví phí platform.

**Chi tiết C-2:**
```
POSTGRES_PASSWORD: 3ivYYwOP27U2vF9Z              (docker-compose.yml:11)
JWT_SECRET: 567fbb317c8d429...                   (:41) — cho phép giả mạo token
INTERNAL_API_KEY: 7w8EAM76idmctHxtg1820VIzk7N85nDU (:42)
TUNNEL_TOKEN: eyJhIjoiM2I3ZDFh...               (:73, đã comment nhưng còn trong history)
```
`.gitignore:2` liệt kê `docker-compose.yml` nhưng file đã được track — không có tác dụng gì. Tất cả bốn giá trị đều có trong git history.

**Chi tiết H-3:** Không có mô hình refresh token. `/auth/refresh` nhận token truy cập hợp lệ và tạo token mới 60 phút, không giới hạn số lần. Không có `jti`, không có denylist, không có server-side logout. TTL truy cập 60 phút (security.md quy định 15 phút). Biện pháp giảm thiểu một phần: `get_current_account` đọc lại `is_active` từ DB mỗi request.

---

## 06 Kiểm Toán Bảo Mật Cơ Sở Dữ Liệu

| ID  | Tiêu đề | Mức độ | CVSS | File |
|-----|---------|--------|------|------|
| C-4 | Race condition ví — chi tiêu gấp đôi / rút vượt số dư | Nghiêm trọng | 8.6 | `src/wallet/service.py:91` |
| M-1 | Không có ràng buộc CHECK ở cấp DB cho các cột tiền tệ | Trung bình | 5.9 | `src/models/wallet.py:78` |
| M-7 | Kiểm tra số lệnh nạp tiền chờ xử lý không atomic | Trung bình | 4.3 | `src/payments/service.py:42` |
| L-4 | DB `marketplace_test` được tạo trên Postgres production | Thấp | 2.5 | `init-db.sql:1` |

**Chi tiết C-4:**
```python
# src/wallet/service.py:91-101
wallet = await get_wallet_by_account(account_id, db)  # SELECT thường, không có FOR UPDATE
if wallet.available_balance < amount:
    raise InsufficientCredit()
wallet.available_balance -= amount  # lost update khi có concurrency
```
Không có hàng nào trong bảng wallet được lock ở bất kỳ đâu trong codebase. N request đồng thời đều vượt qua kiểm tra số dư với cùng giá trị cũ, đều trừ tiền, khiến số dư âm.

Cách sửa: `.with_for_update()` trong `deduct_credit` và `request_withdraw`. Hoặc dùng atomic conditional: `UPDATE wallets SET available_balance = available_balance - :amt WHERE account_id = :id AND available_balance >= :amt RETURNING id`.

**Điểm tốt:** Toàn bộ SQL được parameterized. Patterns SQLAlchemy 2.0 async nhất quán. `expire_on_commit=False` được set đúng.

---

## 07 Kiểm Toán Bảo Mật Hạ Tầng

| ID  | Tiêu đề | Mức độ | CVSS | File |
|-----|---------|--------|------|------|
| H-1 | Production chạy ở chế độ development — tắt toàn bộ guardrail | Cao | 7.5 | `docker-compose.yml:38` |
| H-2 | Container backend chạy với quyền root và cài curl/vim | Cao | 7.3 | `marketplace-svc/Dockerfile:18` |
| H-4 | Jenkins deploy với quyền root qua SSH, không xác minh host key | Cao | 7.0 | `Jenkinsfile:19` |
| H-5 | Không pin image; tag mutable; dependencies Python không bị ràng buộc phiên bản | Cao | 6.8 | `docker-compose.yml:8,27,34` |
| M-3 | Redis không có xác thực | Trung bình | 5.5 | `docker-compose.yml:26` |
| M-4 | Dev compose publish database ra tất cả interfaces | Trung bình | 5.8 | `docker-compose.dev.yml:13` |
| M-5 | Port FastAPI lộ thẳng ra host, không có TLS proxy | Trung bình | 5.3 | `docker-compose.yml:36` |

**Chi tiết H-1:** `DEPLOYMENT_ENVIRONMENT` vắng mặt trong production compose → mặc định là `"development"`. Vô hiệu hóa: HSTS, validation CORS HTTPS-only, cấm demo-topup, cấm API docs, cấm debug routes. `ENCRYPTION_KEY` cũng vắng mặt dù là required field.

**Chi tiết H-4:**
```groovy
ssh -tt root@172.16.89.2 << 'SSHEOF'
  cd /srv/market_site && git pull && docker-compose up -d --force-recreate
SSHEOF
```
SSH root thẳng, không có StrictHostKeyChecking (MITM → RCE trên prod server), không có stage test, không có scan image, exit status của heredoc không được propagate — deploy thất bại trông như thành công.

---

## 08 Danh Sách Lỗ Hổng

| ID  | Tiêu đề | Mức độ | OWASP | CVSS | File |
|-----|---------|--------|-------|------|------|
| C-1 | Tài khoản admin hoạt động được seed vào database production | Nghiêm trọng | A07 | 9.8 | `docker-compose.yml:18` |
| C-2 | Secrets production thật được commit vào git history | Nghiêm trọng | A02 | 9.1 | `docker-compose.yml:11,39,41,42` |
| C-3 | `quantity` âm tạo số dư ví tùy ý | Nghiêm trọng | A04 | 9.3 | `src/orders/schemas.py:8` |
| C-4 | Race condition ví — chi tiêu gấp đôi / rút vượt số dư | Nghiêm trọng | A04 | 8.6 | `src/wallet/service.py:91` |
| H-1 | Production chạy ở chế độ development — tắt toàn bộ guardrail | Cao | A05 | 7.5 | `docker-compose.yml:38` |
| H-2 | Container backend chạy với quyền root và cài curl/vim | Cao | A05 | 7.3 | `marketplace-svc/Dockerfile:18` |
| H-3 | Không có thu hồi token — token bị đánh cắp refresh vô thời hạn | Cao | A07 | 7.1 | `src/auth/router.py:80` |
| H-4 | Jenkins deploy root qua SSH, không xác minh host key | Cao | A08 | 7.0 | `Jenkinsfile:19` |
| H-5 | Không pin image; tag mutable; dependencies Python không khóa phiên bản | Cao | A08 | 6.8 | `docker-compose.yml:8,27,34` |
| M-1 | Không có ràng buộc CHECK ở cấp DB cho các cột tiền tệ | Trung bình | A04 | 5.9 | `src/models/wallet.py:78` |
| M-2 | Mật khẩu đăng nhập quá dài gây lỗi 500 không xử lý | Trung bình | A04 | 5.3 | `src/auth/schemas.py:31` |
| M-3 | Redis không có xác thực | Trung bình | A05 | 5.5 | `docker-compose.yml:26` |
| M-4 | Dev compose publish database ra tất cả interfaces | Trung bình | A05 | 5.8 | `docker-compose.dev.yml:13` |
| M-5 | Port FastAPI lộ thẳng ra host, không có TLS proxy | Trung bình | A05 | 5.3 | `docker-compose.yml:36` |
| M-6 | Next.js proxy chuyển tiếp headers tùy ý lên upstream | Trung bình | A05 | 5.0 | `frontend/app/api/[...path]/route.ts:71` |
| M-7 | Kiểm tra số lệnh nạp tiền chờ không atomic | Trung bình | A04 | 4.3 | `src/payments/service.py:42` |
| M-8 | API key seller không hết hạn và không có scope | Trung bình | A07 | 4.8 | `src/seller_api_keys/service.py:11` |
| M-9 | Điểm SSRF tiềm ẩn trong health probe provider | Trung bình | A10 | 4.0/7.5 | `src/scheduler.py:281` |
| L-1 | CSP cho phép `unsafe-inline` cho script và style | Thấp | A05 | 3.7 | `frontend/next.config.mjs:26` |
| L-2 | An toàn URL trong Markdown phụ thuộc internals thư viện | Thấp | A03 | 3.5 | `frontend/components/MarkdownContent.tsx:51` |
| L-3 | JWT decode thiếu required-claims và validation iss/aud | Thấp | A02 | 3.1 | `src/auth/service.py:32` |
| L-4 | DB `marketplace_test` được tạo trên Postgres production | Thấp | A05 | 2.5 | `init-db.sql:1` |
| L-5 | `pyproject.toml` liệt kê trong .gitignore nhưng đang được track | Thông tin | — | — | `.gitignore:8` |
| L-6 | Webhook PayOS không có rate limit | Thấp | A04 | 3.1 | `src/payments/router.py:42` |

---

## 09 Ma Trận Rủi Ro

```
Khả năng \ Tác động | Không đáng kể | Nhỏ      | Vừa phải   | Lớn            | Thảm họa
---------------------|---------------|----------|------------|----------------|----------
Rất cao              |               |          |            | C-1, C-2       |
Cao                  |               |          | H-1        | C-3            |
Trung bình           |               | M-2      | H-5, M-6   | C-4, H-2, H-3  |
Thấp                 |               | L-1, L-2 | M-7, M-8   | H-4, M-9       |
Rất thấp             |               | L-3, L-4 |            |                |
```

---

## 10 Lộ Trình Khắc Phục

### Giai đoạn 1 — Chặn Triển Khai (0–24 giờ)

1. **Rotate toàn bộ secrets bị commit** (C-2) — JWT_SECRET, INTERNAL_API_KEY, POSTGRES_PASSWORD, Cloudflare tunnel token. Coi tất cả đã bị lộ. Xóa khỏi git history bằng `git filter-repo`. Chuyển sang CI secret manager hoặc Docker secrets.
2. **Gỡ seed mount khỏi production compose** (C-1). Chạy `python -m src.ops.purge_demo`. Thêm assertion lúc khởi động từ chối tài khoản `*@dxtrade.example.com` trong production.
3. **Sửa validation quantity của đơn hàng** (C-3) — `quantity: int = Field(1, ge=1, le=100)`. Thêm `if amount <= 0: raise` vào `deduct_credit`, `release_escrow`, `refund_escrow`, `credit_affiliate_commission`.
4. **Sửa race condition ví** (C-4) — `.with_for_update()` trong `deduct_credit` và `request_withdraw`. Thêm `CHECK (available_balance >= 0)` vào DB qua Alembic.
5. **Set `DEPLOYMENT_ENVIRONMENT=production`** (H-1) trong production compose. Cung cấp `ENCRYPTION_KEY`.

### Giai đoạn 2 — Tăng Cường Hạ Tầng (Trong vòng 1 tuần)

6. **Container backend non-root** (H-2) — `useradd -m app && USER app`. Xóa `curl`, `nano`, `vim`. Tách bước migration ra khỏi CMD của app.
7. **Thu hồi token** (H-3) — Tạo model `RefreshToken` với rotation + phát hiện tái sử dụng. Thêm claim `jti` và Redis denylist. Thêm `DELETE /auth/logout`. Giảm `JWT_EXPIRE_MINUTES` mặc định xuống 15.
8. **Tăng cường Jenkins** (H-4) — User deploy non-root, pin SSH host key, thêm các stage blocking: `pytest -x`, `pip-audit`, `npm audit --audit-level=high`, `trivy image --exit-code 1 --severity CRITICAL,HIGH`.
9. **Pin image và dependencies** (H-5) — Tất cả `FROM` và `image:` phải dùng digest `sha256`. `uv sync --frozen` trong Dockerfile backend. Thêm `gitleaks detect` vào CI.
10. **Redis auth + binding port dev** (M-3, M-4) — Set `requirepass` cho Redis. Bind dev compose về `127.0.0.1`.
11. **Reverse proxy cho backend** (M-5) — Nginx + TLS termination. Gỡ binding port trực tiếp ra host.

### Giai đoạn 3 — Cải Thiện Code (Sprint hiện tại)

12. **Allowlist headers Next.js** (M-6) — Chỉ chuyển tiếp `content-type`, `accept`, `accept-language`, `accept-encoding`.
13. **Giới hạn độ dài mật khẩu đăng nhập** (M-2) — Mirror validator 72-byte sang `LoginRequest`. Thêm generic `Exception` handler vào `src/errors/handlers.py`.
14. **Hết hạn và scope cho API key seller** (M-8) — `expires_at` mặc định 90 ngày, thêm cột scopes.
15. **SSRF guard cho health endpoint** (M-9) — Áp dụng guard trước khi bật lại `health_check_job`.
16. **Required-claims JWT** (L-3) — `options={"require": ["exp", "sub"]}` trong `jwt.decode`.
17. **CSP nonce-based** (L-1) + **sanitizer URL markdown** (L-2).
18. **Dọn dẹp** (L-4, L-5) — Xóa DB test khỏi init script. Sửa `.gitignore` cho file đang được track.

---

## 11 Checklist Kiểm Tra Lại

| ID  | Phương pháp xác minh | Tiêu chí đạt | Xong |
|-----|----------------------|--------------|------|
| C-1 | `SELECT email FROM accounts WHERE email LIKE '%@dxtrade.example.com';` Thử đăng nhập với `admin@dxtrade.example.com / DemoPass123!`. | Không có row nào. Đăng nhập trả về 401. | ☐ |
| C-2 | `git log --all -S "3ivYYwOP27U2vF9Z" --oneline`. `gitleaks detect` trong CI. | Không có commit nào khớp. gitleaks pass. | ☐ |
| C-3 | `POST /api/v1/orders {"quantity": -100}` với token buyer hợp lệ. Kiểm tra số dư ví. | Trả về 422. Số dư không thay đổi. | ☐ |
| C-4 | Nạp ví 1 đơn vị. Gửi 10 đơn hàng đồng thời mỗi cái cần 1 đơn vị. Kiểm tra số dư. | Đúng 1 đơn thành công. Số dư = 0. Không âm. | ☐ |
| H-1 | `docker inspect marketplace-svc` tìm biến DEPLOYMENT. `GET /docs`. | Thấy `production`. `/docs` trả về 404. | ☐ |
| H-2 | `docker exec marketplace-svc id`. `docker exec marketplace-svc which curl`. | UID không phải root. curl không tìm thấy. | ☐ |
| H-3 | Đăng nhập → `DELETE /auth/logout` → dùng token cũ gọi `GET /auth/me`. | Sau logout trả về 401. Refresh cũng 401. | ☐ |
| H-4 | Xem lại Jenkinsfile. Kiểm tra log Jenkins có các stage audit. | Deploy non-root. Host key được pin. Có stage pytest + pip-audit + trivy blocking. | ☐ |
| H-5 | Kiểm tra tất cả `FROM` và `image:` trong Dockerfiles và compose files. | Mọi tham chiếu đều có digest `@sha256:`. | ☐ |
| M-1 | `SELECT conname, consrc FROM pg_constraint WHERE conrelid = 'wallets'::regclass;` | Constraint `available_balance >= 0` tồn tại. | ☐ |
| M-2 | `POST /auth/login` với email hợp lệ + mật khẩu 200 ký tự. | Trả về 422, không phải 500. | ☐ |
| M-3 | `redis-cli -h <host> ping` không có thông tin xác thực. | `NOAUTH Authentication required`. | ☐ |
| M-4 | `grep -E "5432:|6379:" docker-compose.dev.yml` | Tất cả binding bắt đầu bằng `127.0.0.1:`. | ☐ |
| M-5 | `curl -v http://<host>:8001/health` từ ngoài Docker network. | Connection refused. | ☐ |
| M-6 | Request proxy với header `x-internal-key: anything`. Kiểm tra backend nhận được không. | Backend không nhận `x-internal-key`. | ☐ |
| M-7 | 10 request nạp tiền đồng thời khi account đã có 3 lệnh chờ. | Tất cả vượt giới hạn đều bị từ chối. Số trong DB không vượt giới hạn. | ☐ |
| M-8 | Code review: model `seller_api_keys` có cột `expires_at`. | Cột tồn tại. Mặc định = `now() + 90 ngày`. Key hết hạn bị từ chối. | ☐ |
| M-9 | Code review: `scheduler.py:281` dùng transport có SSRF guard. | Guard được áp dụng trước khi bật lại job. | ☐ |
| L-1 | Kiểm tra header `Content-Security-Policy` trong response production. | Không có `unsafe-inline`. CSP dùng nonce. | ☐ |
| L-2 | Code review: `MarkdownContent.tsx` có `overrides.a` với validation href. | Từ chối scheme `javascript:` và `data:`. | ☐ |
| L-3 | Gửi JWT không có claim `sub` đến endpoint được bảo vệ. | Trả về 401, không phải 500. | ☐ |
| L-4 | `docker exec postgres psql -U marketplace -lqt` trên volume mới. | `marketplace_test` không tồn tại. | ☐ |
| L-6 | 200 request nhanh đến `POST /webhooks/payos` với signature sai. | Bị rate-limit sau ngưỡng cấu hình. | ☐ |

> **Ký duyệt:** Tất cả mục Giai đoạn 1 (C-1 đến H-1) phải pass trước khi triển khai production. Giữ lại checklist đã hoàn thành với ngày tháng và tên người kiểm tra cho hồ sơ kiểm toán.

---

*Bản HTML đầy đủ: https://claude.ai/code/artifact/78ee1f3d-2488-4e49-9a6d-da90ff3a26d6*  
*Bản tiếng Anh: [security-audit-whitebox-2026-08-07.md](./security-audit-whitebox-2026-08-07.md)*
