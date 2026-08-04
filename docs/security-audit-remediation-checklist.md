# Security Remediation Checklist — Prioritized Update

Checklist hợp nhất và chuẩn hóa từ:

- `docs/security-audit-blackbox-graybox-2026-08-04.md`
- Bản checklist remediation trước đó

**Baseline:** 2026-08-04 · **Risk ban đầu:** Critical · **Code/local remediation:** hoàn tất · **Production sign-off:** chưa hoàn tất
Đánh dấu `[x]` chỉ khi có evidence/retest. Ghi owner + PR/ticket + bằng chứng triển khai.

## Cập nhật triển khai local — 2026-08-04

| Nhóm | Trạng thái | Evidence local |
|---|---|---|
| Next/dependency | **Đã xử lý code/build/runtime local** | Local `:3000` đã restart sang Next `16.3.0`; production-mode build 35 routes pass; `npm audit --omit=dev` = 0; locked production requirements `pip-audit` = 0 |
| Secret/CORS/demo/docs | **Đã xử lý application code** | Required secret + denylist/min length; demo off; allowlist CORS; docs/debug off; production compose đã được khôi phục bản cũ theo quyết định owner |
| Auth/operations/session | **Đã xử lý code** | Operations owner/admin-only; login/register/refresh limiter; inactive-account check; password ≥12; bearer chuyển sang HttpOnly SameSite cookie BFF |
| SSRF/provider credential | **Đã xử lý application layer** | Validate toàn bộ A/AAAA + TCP pin public IP, TLS giữ SNI/cert; API chỉ trả mask; write-only update giữ secret cũ |
| Abuse/logging | **Đã xử lý code** | Gateway IP+key limiter fail-safe; affiliate IP dedupe/limit; webhook auth response đồng nhất; payload log redaction + retention |
| Build/container/CI | **Đã xử lý code/CI** | Dockerfiles được giữ nguyên theo quyết định owner; CI thêm npm/locked-pip audit/full pytest; `.dockerignore` loại `.env`, dependency/build cache và test artifact |
| Local encryption rotation | **Hoàn tất** | 15/15 provider credential re-encrypt sang key local mới; verify: 15 current, 0 pending |
| Backend regression | **Hoàn tất local** | Full suite cuối trên snapshot có observability mới: `669 passed, 0 failed`; targeted auth/security `29 passed`; targeted security/regression `30 passed` |

### Việc P0/P1 còn bắt buộc ở Ops/production

Các mục dưới đây **không thể đóng bằng source diff/local runtime** và vẫn giữ `[ ]`: deploy artifact đã vá; roll instance cũ; secret exposure triage bằng fingerprint; rotate/revoke secret production nếu trigger; ingress/NetworkPolicy chặn `/internal/*` và private egress; WAF/edge limiter; telemetry/history/image-layer scan; canary và blackbox trên đúng build SHA/digest. Production compose đã được khôi phục bản cũ theo quyết định owner, vì vậy secret/config/network findings trong file này vẫn mở. Đây là phần ảnh hưởng lớn nhất còn lại.

## Cách dùng và mức ưu tiên

| Priority | SLA mục tiêu | Ý nghĩa |
|---|---:|---|
| **P0** | 0–24 giờ | Có thể RCE, giả mạo danh tính, mất tiền/secret hoặc exposure diện rộng |
| **P1** | 1–3 ngày | High risk cần chặn nhanh; chưa có bằng chứng khai thác production |
| **P2** | ≤ 1 tuần | Defense-in-depth, authorization coverage và giảm blast radius |
| **P3** | ≤ 30 ngày | Abuse/hardening/operational maturity |

### Kết luận đối chiếu evidence

- **Confirmed:** Next.js `15.5.4` nằm trong dải RSC/Flight RCE; backend local chấp nhận JWT/internal key mặc định; CORS tùy ý; login không throttle; SSRF có DNS-rebinding TOCTOU; `/products/{id}/operations` public; secret production nằm plaintext 0644; frontend/backend URL split-brain; dependency có CVE.
- **Confirmed supplemental:** tracked `docker-compose.yml` chứa direct values cho DB/JWT/internal key. Việc các giá trị này có từng được dùng trên production hay không phải được xác minh bằng deployment history/secret fingerprint, không suy đoán.
- **Not confirmed:** production bị chiếm hoặc default dev secret forge được JWT/internal request trên production. Audit mới xác nhận production **từ chối** hai default này.
- **Not confirmed:** demo-topup đang bật trên production. Chỉ local runtime được xác nhận bật.
- **Legacy findings cần retest:** password policy, inactive-account enforcement, order existence oracle, public seller email và constant-time comparison cho internal key.
- **Test baseline trước remediation:** `603 passed, 10 failed`; 10 failure cùng do fixture adapter không gán `review_status="approved"`. **Final local:** `669 passed, 0 failed`.

## Critical path — không đổi thứ tự

```text
P0-01 Patch Next/RSC và redeploy sạch
  -> P0-02 Xác minh secret exposure; rotate nếu có reuse/exposure
  -> P0-03 Fail-fast default secret + tắt demo-topup + khóa CORS
  -> P0-04 Auth-gate operations + chặn brute-force login
  -> P0-05 Chạy test/retest và xác nhận artifact/build SHA
  -> P1 SSRF egress + split-brain + dependency/secret hygiene
  -> P2 Authorization matrix + session/header/docs hardening
```

> Không rotate secret mới vào process Next.js còn vulnerable. Vá/contain RCE trước, rồi mới phát hành secret thay thế.

### P0 execution board

| Work item | Owner | Ticket/PR | Deadline | Status / runtime evidence |
|---|---|---|---|---|
| P0-01 Next/RSC patch | Eng | local workspace | +4h | Code/build/audit **done**; production deploy/roll pending Ops |
| P0-02 Secret exposure triage/conditional rotate | Ops/Sec | cần ticket incident | +8h | Local encryption rotation done; production fingerprint/rotate **pending** |
| P0-03 Default secret + demo + CORS | Eng | local workspace | +16h | Code + local blackbox **done**; production runtime retest pending |
| P0-04 Operations auth + login limiter | Eng/Ops | local workspace + edge ticket | +24h | App layer **done**; edge/WAF limiter pending Ops |
| P0-05 Full tests + blackbox retest | Eng/Ops | local workspace + deploy ticket | +24h | Local full suite cuối `669 passed`; build/audit/blackbox pass; deployed artifact retest pending |

---

## P0-01. Vá Next.js RSC/Flight RCE

- [x] Nâng Next.js khỏi `15.5.4`; hiện dùng `16.3.0`
- [x] Update lockfile; local build/runtime kiểm tra dùng Next `16.3.0` (production runtime vẫn cần Ops xác nhận)
- [x] Chạy `npm audit --omit=dev`; kết quả local: 0 vulnerability
- [x] Rebuild artifact local bằng Webpack thành công; production vẫn phải build/deploy sạch
- [ ] Deploy canary, smoke test App Router/RSC, auth, checkout/order và rollback path
- [ ] Roll toàn bộ instance cũ; ghi build SHA/digest đã triển khai
- [ ] Kiểm tra log/WAF/process telemetry cho request RSC bất thường trước thời điểm vá
- [ ] Nếu có dấu hiệu exploit, kích hoạt P0-02 incident branch và coi secret process đọc được là exposed

**Definition of done:** runtime đã vá trên mọi instance; artifact digest được ghi nhận; smoke test pass; advisory áp dụng không còn.

---

## P0-02. Secret exposure & conditional incident response

Không mặc định kết luận production compromised. Kích hoạt incident/rotate bắt buộc nếu xảy ra ít nhất một điều kiện: secret production trùng/reuse với Git/compose/default; secret từng có trong image/log/CI artifact; telemetry có token/request giả; hoặc process Next vulnerable có quyền đọc secret đó.

### 0.0 Triage trước khi rotate

- [ ] So sánh fingerprint/hash của secret đang deploy với compose/default/history mà không in giá trị ra log/ticket
- [ ] Kiểm tra secret có từng nằm trong image layer, CI log/artifact, backup hoặc máy share
- [ ] Xác định process/service nào có quyền đọc từng secret, đặc biệt process Next.js vulnerable
- [ ] Ghi quyết định: `incident-confirmed`, `exposure-confirmed-no-abuse`, hoặc `no-production-reuse` kèm evidence
- [ ] Nếu không có production reuse/exposure, vẫn xử lý gỡ direct values và default tại §1; không đóng việc chỉ bằng lời xác nhận

### 0.1 Incident branch — rotate/revoke khi trigger được xác nhận

- [ ] Rotate `JWT_SECRET` (mọi JWT cũ tự invalid; chuẩn bị thông báo đăng nhập lại)
- [ ] Rotate `INTERNAL_API_KEY`
- [ ] Lập migration/rollback rồi rotate `ENCRYPTION_KEY`; re-encrypt và verify toàn bộ provider credentials, không đổi key mù làm mất dữ liệu
- [ ] Rotate `POSTGRES_PASSWORD` (+ cập nhật connection string mọi service)
- [ ] Rotate PayOS keys nếu từng nằm file/compose/`backend.env` trên máy share
- [ ] Rotate Cloudflare Tunnel token (nếu token comment trong compose từng deploy thật)
- [ ] Rotate TopProxy / ScrapeCreators / DProxy API keys nếu từng decrypt được hoặc nằm seed/env
- [ ] Xác nhận không còn process nào dùng secret cũ (restart toàn bộ pod/container)

### 0.2 Incident branch — kiểm tra abuse

- [ ] Audit log: thay đổi role (`/admin/accounts/*/roles`)
- [ ] Audit log: manual topup / demo-topup / deposit lạ
- [ ] Audit log: `/internal/resources/acquire|release` và `/internal/usage/charge`
- [ ] Rà wallet balance admin/seller bất thường
- [ ] Rà inventory resource bị claim/assign bất thường
- [ ] Rà order `delivered_data` / gateway key lộ
- [ ] Disable/rotate seller API keys nếu nghi ngờ
- [ ] Thông báo nội bộ (owner + ops) — không public disclosure cho đến khi rotate xong

### 0.3 Chặn surface theo rủi ro

- [ ] **P0:** Không expose `/internal/*` ra internet; chặn ở ingress/network trước application auth
- [ ] **P0:** Xác nhận runtime production `ENABLE_DEMO_TOPUP=false`
- [ ] **P0:** Xác nhận production không dùng JWT/internal/encryption default dev
- [ ] **P2:** Tắt hoặc auth-gate `/docs`, `/redoc`, `/openapi.json` trên production
- [ ] **P2:** Remove hoặc auth-gate source route `/version`; không trả DB/schema/exception detail

---

## P0-03. Đóng chuỗi default-secret + CORS + demo-topup

- [x] Backend fail startup nếu JWT/internal/encryption key thiếu, quá ngắn hoặc thuộc denylist default
- [x] Xóa default usable khỏi `marketplace-svc/src/config.py`; test inject secret riêng
- [x] Tắt demo-topup mặc định; staging/production validator từ chối bật flag
- [x] CORS dùng allowlist origin theo environment; không dùng wildcard/credentials
- [x] Application là owner CORS duy nhất trong artifact; edge production cần xác nhận không chèn duplicate
- [x] Evil-origin preflight local không có `Access-Control-Allow-Origin`; production cần retest sau deploy
- [ ] Token ký bằng key cũ/default trả 401; internal key cũ/default trả 403

**Definition of done:** không thể tái hiện chuỗi trang độc hại → localhost → token tự ký; production và local shared environment đều fail-safe.

## P0-04. Chặn exposure và credential attacks trực tiếp

- [x] Auth-gate `GET /products/{product_id}/operations`; chỉ admin hoặc seller owner, anonymous 401
- [ ] Tách DTO public nếu business thật sự cần một phần dữ liệu; không public provider adapter/health/pricing params/revenue/dispute stats
- [ ] Thêm rate limit tạm thời ở edge cho `POST /auth/login` theo IP/subnet
- [x] Thêm limiter application theo IP + normalized email/account, local fallback khi Redis lỗi, security event/metric
- [ ] Không hard-lock account chỉ theo email để tránh DoS; có phương án chống distributed password spray
- [x] Burst login sai xuất hiện 429 + `Retry-After`; thông báo lỗi generic; event phục vụ alert

## P0-05. Release gate trước khi đóng P0

- [x] Sửa fixture `_make_provider()` mặc định approved; thêm case pending riêng
- [x] Backend full suite cuối chạy `669 passed, 0 failed` trên snapshot đã gồm thay đổi observability
- [x] Frontend TypeScript + production build pass trên lockfile đã vá
- [ ] Chạy blackbox retest theo §10 trên đúng build SHA/artifact digest
- [ ] Không đóng P0 chỉ dựa trên source diff; phải có runtime evidence từ instance đã deploy

---

## P1-01. Secrets & configuration hygiene

### 1.1 Gỡ secret khỏi git / repo

- [ ] Xóa direct plaintext secret khỏi `docker-compose.yml`; thay đổi đã được revert theo quyết định owner
- [x] Thêm `*.env.example` placeholder; production vẫn phải cấp từ secret manager/runtime
- [x] `backend.env`, backend `.env*` đã ignore; file secret local hiện hữu đặt mode 0600
- [ ] Di chuyển secret production khỏi workspace sang secret manager/runtime injection
- [x] File secret tạm giữ đã đặt mode 0600; việc xóa `.env.production.bk` chờ Ops backup/rotate production
- [x] Frontend/backend `.dockerignore` loại `.env*` (giữ `.env.example`), key/cert, dependency/build cache và test artifact khỏi Docker build context
- [ ] Chạy secret scan lịch sử Git (`gitleaks` / `trufflehog`); nếu phải purge remote history, rotate trước và phối hợp toàn team thay vì rewrite tùy tiện
- [ ] Scan cả image layer, CI artifact, log và backup; Git sạch không đồng nghĩa artifact sạch
- [ ] Thêm CI gitleaks gate; tạm bỏ vì production compose được giữ nguyên và sẽ làm gate fail

### 1.2 Defaults an toàn

- [x] Fail startup nếu `JWT_SECRET` vẫn là default cũ
- [x] Fail startup nếu `INTERNAL_API_KEY` vẫn là default cũ
- [x] Fail startup nếu `ENCRYPTION_KEY` default cũ
- [x] Không còn fallback usable; local test inject secret riêng qua fixture
- [x] README + `.env.example` document secret bắt buộc trước khi serve traffic
- [ ] Tách secret dev / staging / prod — **không** share JWT/internal key giữa môi trường

### 1.3 Dev proxy không trỏ prod

- [x] Frontend local `API_URL` trỏ backend local; không còn target production hard-code
- [x] README document browser same-origin `/api` và server-only `API_URL`
- [ ] Compose bắt buộc inject `API_URL` theo environment; production compose hiện đã về bản hard-code cũ
- [x] Browser bundle chỉ gọi same-origin `/api`; upstream chỉ tồn tại server-side
- [x] Production build fail nếu `API_URL` là localhost/dev origin
- [ ] Ghi build SHA vào health/version response tối giản để đối chiếu source/runtime drift

---

## P1/P2. Authentication & session

### 2.1 Password & account

- [x] Password register min length 12, max bcrypt-safe, block tập common password cơ bản
- [ ] **Legacy retest:** validate password nhất quán trên register/reset/change-password
- [x] `authenticate`, JWT và seller API-key path reject account inactive
- [ ] (Optional) email verification trước khi dùng wallet/order

### 2.2 JWT & session storage

- [x] JWT secret bắt buộc ≥32 bytes
- [x] Access token TTL giảm còn 60 phút; refresh rotation/store vẫn là follow-up nếu cần long-lived session
- [x] Bearer token đã chuyển khỏi `localStorage` sang HttpOnly Secure(production) SameSite=Strict cookie qua same-origin BFF
- [x] Logout xóa HttpOnly session cookie ở BFF; chưa có refresh store cần revoke
- [ ] Không embed quyền nhạy cảm chỉ trong JWT claim (giữ check DB roles như hiện tại)

### 2.3 Brute force / abuse

- [x] **P0:** Rate limit `POST /auth/login` (IP + normalized email hash)
- [x] Rate limit `POST /auth/register` (IP)
- [x] Rate limit `POST /auth/refresh` (account)
- [x] Rate limit `POST /affiliate/click` (IP + campaign hash)
- [x] Response login fail generic
- [x] Structured security events/metrics cho auth fail/rate-limit; alert routing production cần Ops cấu hình

---

## P1/P2. Authorization & API surface

### 3.1 Admin / seller / buyer

- [x] **P0:** Protect `GET /products/{product_id}/operations`; chỉ owner/admin đọc DTO operational
- [ ] Giữ `require_role` trên mọi `/admin/*` (review OpenAPI vs code — không sót route mới)
- [ ] Lập authorization matrix cho toàn bộ 77 route có ID parameter: anonymous/buyer A/buyer B/seller owner/seller khác/admin
- [ ] Dùng ít nhất hai account mỗi role trên staging cô lập để dynamic BOLA/IDOR retest
- [ ] **Legacy retest:** uniform 404 khi non-owner đụng order/resource nếu API cần chống existence oracle
- [ ] Review seller deliver/accept/dispute paths cho IDOR ngang hàng
- [x] Public product/seller DTO không còn trả `seller_email`; trường này chỉ giữ ở admin/owner workflow cần thiết

### 3.2 Internal API

- [ ] **P0:** `/internal/*` chỉ bind internal network (NetworkPolicy / private listener)
- [ ] Compose bind backend host port vào loopback/private listener; production compose đã được khôi phục về publish trên mọi host interface
- [x] Internal key dùng `hmac.compare_digest`
- [ ] (Optional) mTLS hoặc signed service identity thay shared static key
- [x] Audit log mọi internal acquire/release/charge
- [x] BFF trả 404 cho mọi `/api/internal/*`

### 3.3 Docs & debug

- [x] Prod/default: `/docs`, `/redoc`, `/openapi.json` không mount
- [x] `/version` chỉ tồn tại khi explicit debug flag; production validator cấm bật
- [ ] Staging: docs chỉ VPN / basic auth
- [x] Artifact mặc định không có OpenAPI route; CDN/edge production cần retest

### 3.4 Gateway & webhooks

- [x] Giữ endpoint regex + body/response size limit trên `/gw/*`
- [x] Rate limit gateway theo TCP peer IP + gateway-key hash
- [x] IP throttle chạy trước DB lookup, giới hạn amplification từ random key
- [x] Redis lỗi dùng bounded local fallback; gateway/auth không fail-open
- [ ] PayOS webhook: giữ verify signature; monitor 401 spikes
- [x] Provider task webhook fail-closed khi thiếu `webhook_secret`
- [x] Provider webhook dùng cùng 401/detail cho provider không tồn tại và signature sai
- [x] Gateway key chỉ dùng dạng hash trong limiter/log; provider calls không log api_key/body

### 3.5 Public catalog & affiliate abuse

- [x] Enforce `page/per_page` server-side; blackbox local `per_page=1` trả đúng 1/43 item
- [ ] Review DTO public: exact stock, seller ID và pricing params chỉ trả khi business cần
- [x] Affiliate click rate-limit theo IP+campaign, không chỉ `visitor_id`
- [x] Dedupe theo visitor **hoặc** IP trong cửa sổ 24h; event/alert production cần threshold Ops

---

## P1/P2. Money & inventory integrity

### 4.1 Demo topup

- [ ] Prod: `ENABLE_DEMO_TOPUP=false` (verify env thật, không chỉ file mẫu)
- [ ] Local/dev: document khi bật; không bật trên shared staging có data gần-prod
- [ ] (Optional) xóa hẳn route demo-topup khỏi binary prod build
- [ ] Alert nếu demo-topup được gọi khi flag lỡ bật

### 4.2 Wallet / deposit / withdraw

- [ ] Admin topup chỉ admin + audit log (đã có — review retention/alert)
- [ ] Deposit min/max / pending limit giữ nguyên; test bypass
- [ ] Withdraw: tier limit + bank field validation
- [ ] Reconcile job PayOS chạy và monitored

### 4.3 Resources / orders

- [ ] Internal acquire không gọi được từ public internet (xem 3.2)
- [ ] Buyer chỉ thấy resource/order của mình (test regression IDOR)
- [ ] `delivered_data` / gateway key chỉ trả owner (và admin có lý do)

---

## P0/P2. CORS, headers, frontend

### 5.1 CORS backend

- [x] Bỏ wildcard CORS và credentials
- [x] Whitelist từ `FRONTEND_BASE_URL`/`CORS_ALLOWED_ORIGINS`; production chỉ chấp nhận public HTTPS
- [x] Evil origin không được reflect
- [ ] Chỉ edge hoặc app set CORS; không để nginx/FastAPI tạo header trùng

### 5.2 Security headers (Next.js)

- [x] CSP đã bật; production bỏ `unsafe-eval`, `unsafe-inline` còn là hardening follow-up cho Next hydration/style
- [x] `X-Frame-Options: DENY` + `frame-ancestors 'none'`
- [x] `X-Content-Type-Options: nosniff`
- [x] `Referrer-Policy: strict-origin-when-cross-origin`
- [x] `Permissions-Policy` tối thiểu
- [x] HSTS bật theo `NODE_ENV=production` chuẩn của Next.js; không cần đổi production env hiện hữu
- [x] Tắt `X-Powered-By`

### 5.3 Client secrets

- [x] Source/frontend build không dùng `NEXT_PUBLIC_*` cho secret hoặc upstream; browser chỉ gọi same-origin `/api`
- [x] Token XSS surface: CSP + HttpOnly SameSite cookie; không còn auth token trong browser storage

---

## P1-02. SSRF, cryptography & provider credentials

- [ ] `ENCRYPTION_KEY` unique per env, backup offline an toàn
- [x] Provider response mask mọi sensitive config thành `********`; không trả plaintext/ciphertext
- [x] Admin/seller update dùng write-only secret; omitted/empty/mask = giữ ciphertext cũ
- [ ] **Containment:** chặn egress tới loopback, RFC1918, link-local, metadata IP và internal CIDR ở network/firewall layer
- [x] Resolve toàn bộ A/AAAA, reject nếu bất kỳ answer private, TCP connect pin đúng public IP; URL hostname vẫn dùng cho Host/SNI/cert
- [x] Custom httpcore backend loại DNS resolve lần hai ở connect, đóng TOCTOU application-layer
- [x] `follow_redirects=false`; ambient proxy env bị tắt cho seller-owned request
- [x] Unit test mixed public/private DNS và transport từ chối hostname ngoài pin
- [x] `SENSITIVE_CONFIG_KEYS` gồm api_key/api_secret/secret_key/token/webhook_secret và response mask toàn bộ

---

## P1-03. Dependency remediation

- [x] Next.js nâng lên `16.3.0`
- [x] `cryptography` nâng `50.0.0`; provider encryption/mask/rotation regression pass
- [x] Upgrade PostCSS/Tailwind transitive; production CSS build pass
- [x] `npm audit --omit=dev`: 0 vulnerability
- [x] `pip-audit --strict`: no known vulnerabilities
- [x] CI export production requirements từ `uv.lock` rồi audit file đó; npm/pip audit chạy mỗi PR/push và lịch hàng tuần

---

## P2. Logging, monitoring, ops

- [ ] Alert: admin role change
- [ ] Alert: internal API usage
- [ ] Alert: wallet topup (manual + large deposit)
- [ ] Alert: burst 401/403/429
- [x] Access log không ghi query/body/header; security event dùng principal hash; gateway key không ghi plaintext
- [x] Gateway JSON recursively redact/bound; non-JSON body không lưu; retention mặc định 7 ngày
- [ ] Retention log admin đủ để điều tra (và không leak PII quá mức)
- [ ] Runbook: “compromised JWT_SECRET / INTERNAL_API_KEY”

---

## P0/P2. Test & CI regression

### 8.1 Automated tests

- [x] Sửa 10 failure adapter fixture; full suite sign-off cuối `669 passed, 0 failed`
- [x] Test provider approved được dùng; pending_review bị chặn
- [x] Test default/short secret bị startup validator từ chối
- [x] Test demo-topup bị chặn khi flag off (suite hiện hữu)
- [x] Test buyer không vào admin surface (suite hiện hữu)
- [x] Test owner/non-owner order/resource paths (suite hiện hữu)
- [x] Test internal missing/wrong key
- [x] Test weak/common password → 422
- [x] Test inactive account login/token → 401
- [x] Test CORS evil origin không reflect
- [x] Test schema không mass-assign roles/password hash
- [x] Test anonymous operations → 401; non-owner → 404; owner/admin → 200
- [x] Test auth burst → 429 + Retry-After
- [x] Test SSRF literal/mixed DNS private IP và TCP pin

### 8.2 CI / pre-deploy

- [ ] `gitleaks` trên PR/push; chỉ bật lại sau khi xử lý direct values/history theo quyết định owner
- [x] `uv export --frozen --no-dev` + `pip-audit --strict -r ...` và `npm audit --omit=dev --audit-level=high` trong CI/weekly schedule
- [ ] Production Settings đã fail-fast ở application code, nhưng production compose cũ chưa inject đầy đủ environment/secret bắt buộc
- [x] Local smoke: `/health` 200; `/docs`, `/openapi.json`, `/version` 404

---

## P3. Cleanup sau audit (local, chỉ khi record thực sự tồn tại)

- [ ] Xác minh audit trước có thật sự tạo user `audit_*@example.com`; chỉ xóa local record đã định danh chắc chắn
- [ ] Xác minh account id=17 có bị audit trước đổi role; không revert nếu đó là role hợp lệ của user
- [ ] Xác minh demo topup/order #111 là dữ liệu audit trước khi điều chỉnh; backup và ghi audit trail
- [ ] Không commit token/PoC script chứa secret prod

---

## 10. Verification sign-off

Trước khi đóng remediation wave:

### Evidence local đã hoàn tất

| Gate | Kết quả 2026-08-04 |
|---|---|
| Backend regression | Full `669 passed, 0 failed` (`28:02`) trên snapshot hiện tại |
| Auth/security targeted | `29 passed`; security/regression targeted bổ sung `30 passed` |
| Frontend | TypeScript pass; production-mode Next `16.3.0` build pass 35 routes |
| Dependency | npm production 0 vulnerability; pip audit trên requirements export từ `uv.lock` không có vulnerability đã biết |
| BFF blackbox | `/api/internal/*` 404; evil-origin unsafe POST 403; public pagination được enforce; không forward `Server` |
| Backend blackbox | health 200; docs/OpenAPI/version 404; operations anonymous 401; evil CORS không được reflect |
| Production-mode headers | CSP không có `unsafe-eval`; HSTS, DENY, nosniff, referrer/permissions/COOP có mặt; không `X-Powered-By`/`Server` |
| Local runtime `:3000` | Đã thay process Next `15.5.4` bằng Next `16.3.0`; root/catalog 200, pagination enforce, `/api/internal/*` 404 |
| Config/container | Dockerfiles giữ nguyên nên non-root/server-header hardening không áp dụng; secret file local 0600; Docker contexts loại env/key/cache. Production compose/network hardening không áp dụng |

Hai Dockerfile và production compose được giữ nguyên theo quyết định owner. Production Next build ngoài container đã pass với `API_URL` hiện hữu, nhưng CI/registry vẫn phải build artifact từ reviewed SHA, chạy smoke test và ghi digest trước deploy. Container non-root/debug-tool/server-header và compose secret/network findings vẫn mở.

### Evidence production còn bắt buộc

- [ ] Runtime Next.js trên mọi instance không còn `15.5.4`; RSC advisory áp dụng đã hết
- [ ] Artifact/image digest đang chạy đúng với build SHA được review
- [ ] Forge JWT bằng secret **cũ** (compose/default) → **401** trên prod
- [ ] Internal key **cũ** → **403** trên prod
- [x] Backend fail startup khi thiếu/default JWT/internal/encryption secret (validator + automated test local)
- [ ] `GET https://api-…/openapi.json` → **404/401** (không public)
- [ ] `GET https://api-…/version` → **404/401** hoặc chỉ trả build ID tối giản đã duyệt
- [ ] `POST /wallet/demo-topup` trên prod → **403**
- [ ] CORS evil origin → không `ACA-Origin: evil`
- [ ] Login brute (burst) → eventual **429**
- [ ] Anonymous `GET /products/{id}/operations` → **401/403/404**, không còn operational data
- [x] DNS-rebinding SSRF simulation application-layer → reject mixed/private DNS và pin TCP vào IP public đã validate; network egress production vẫn pending
- [ ] Production bundle không chứa `localhost:8001`; request API chỉ đi một upstream đã định nghĩa
- [x] `npm audit --omit=dev` và locked-requirements `pip-audit` đạt policy không Critical/High fixable
- [x] Register password `"a"` → **422**
- [x] Buyer token → admin surface được test **403**; authorization matrix toàn route vẫn pending staging
- [ ] Owner-only order paths không leak existence (404)
- [x] Full backend suite **0 failed** (`669 passed`); frontend TypeScript/production build pass
- [ ] Pen-test nhanh lại auth, CORS, operations, SSRF và internal surface trên artifact deploy

**Sign-off**

| Role | Name | Date | Notes |
|------|------|------|-------|
| Eng | | | |
| Ops | | | |
| Owner | | | |

---

## Quick reference — finding → priority/work package

| ID | Severity | Issue | Priority / sections |
|---|---|---|---|
| SEC-01 | Critical | Next.js RSC/Flight RCE | **P0-01**, P1-03, §10 |
| SEC-02 | Critical | Default JWT/internal key accepted local; demo-topup chain | **P0-02/P0-03**, §1, §4.1 |
| SEC-03 | High | Không có login rate limit | **P0-04**, §2.3 |
| SEC-04 | High | SSRF DNS rebinding/TOCTOU | **P1-02**, §8, §10 |
| SEC-05 | High | Production secret plaintext/0644/backup | **P0-02 conditional**, P1-01 |
| SEC-06 | High | Arbitrary/duplicate CORS | **P0-03**, §5.1 |
| SEC-07 | Medium, high business impact | Public product operations data | **P0-04**, §3.1 |
| SEC-08 | Medium | Split-brain API URL/source-runtime drift | **P1-01 §1.3** |
| SEC-09 | Medium | Python/transitive frontend CVEs | **P1-03** |
| SEC-10 | Medium | Thiếu security headers + localStorage token | **P2**, §2.2, §5.2 |
| SEC-11 | Medium latent | Public source route `/version` | **P2**, §3.3 |
| SEC-12 | Low | Public OpenAPI/docs | **P2**, §3.3 |
| SEC-13 | Low | Affiliate/gateway/webhook/log/pagination abuse | **P3**, §2.3, §3.4, §7 |

### Legacy checklist items chưa được audit mới xác nhận

| Item | Xử lý |
|---|---|
| Production admin JWT đã bị forge | Không coi là fact; chạy P0-02 triage. Nếu fingerprint/reuse/log match thì kích hoạt incident branch |
| Demo-topup production đang bật | Verify runtime; local bật không chứng minh production bật |
| Password policy / inactive account thiếu | Retest rồi mới tạo finding/PR |
| Order 403 oracle / public seller email | Đưa vào authorization matrix, không tuyên bố confirmed trước retest |
| Internal key comparison không constant-time | Đọc/trace implementation và test timing-safe compare trước khi sửa |
| Audit user/id=17/order #111 | Chỉ cleanup nếu record được xác nhận là do audit cũ tạo |

---

## Suggested order of work (engineering)

```text
0–4h    → P0-01 patch/contain Next RCE; inventory artifact và process exposure
4–8h    → P0-02 secret triage; kích hoạt rotate/revoke nếu trigger confirmed
8–16h   → P0-03 default-secret fail-fast + demo-topup off + CORS single-owner
16–24h  → P0-04 operations auth-gate + edge/app login limiter
Day 2   → P0-05 test gate/retest; P1-01 secret storage + split-brain URL
Day 2–3 → P1-02 SSRF network egress trước, DNS/IP pinning sau
Day 3   → P1-03 cryptography/postcss/sharp + CI audit gate
Week 1  → 77-route authorization matrix, internal network boundary, headers/session/docs
≤30d    → Affiliate/gateway/webhook/log/pagination abuse + legacy retest + cleanup
```

### Parallel work packages

| Package | Scope | Có thể chạy song song | Blocker/Dependency |
|---|---|---|---|
| WP-A | Next upgrade + clean deploy | Có | Phải xong trước khi cấp secret mới cho process frontend |
| WP-B | Secret triage/manager/rotation | Triage có; rotate sau WP-A nếu frontend đọc secret | Cần owner Ops + migration encryption key |
| WP-C | CORS/default/demo/operations/login | Có | Cần biết origin production và policy rate-limit |
| WP-D | SSRF egress + DNS pin | Có | Cần staging DNS-rebinding harness/network owner |
| WP-E | Dependency + CI + failing tests | Có | Backend fixture phải pass trước backend deploy |
| WP-F | Authorization matrix/headers/session/docs | Sau P0 | Cần test accounts cô lập và product decision cho public DTO |
