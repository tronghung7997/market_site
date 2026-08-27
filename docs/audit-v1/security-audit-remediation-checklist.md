# Security Remediation Checklist — Consolidated Audit v1

Checklist hợp nhất và chuẩn hóa từ:

- `docs/audit-v1/security-audit-whitebox-2026-08-07.md`
- `docs/audit-v1/security-audit-backend-deep-2026-08-07.md`
- `docs/audit-v1/security-audit-frontend-deep-2026-08-07.md`
- `docs/audit-v1/security-audit-tong-hop-2026-08-07.md`
- `docs/security-audit-blackbox-graybox-2026-08-04.md`
- Bản checklist remediation trước đó

**Audit reports:** 2026-08-07 (`check-security`) · **Source re-validation/execution:** 2026-08-18 trên `main` HEAD `0558bcc796c26914467937f34c94f2835fc54fa4` + remediation working tree
**Continue branch:** 2026-08-26 `audit-v1-continue` (merge `main` với conflict lấy main, rồi gắn lại BFF traversal/HMAC + khóa escrow job)
**Risk hiện tại:** High (P0 app-layer local đã vá; Ops/infra và token revoke còn mở) · **Wave local 08-04:** hoàn tất theo evidence cũ · **Wave findings 08-07:** một phần đã đóng trên continue branch · **Production sign-off:** chưa hoàn tất

Đánh dấu `[x]` chỉ khi có evidence/retest trên đúng source hoặc artifact. `[ ]` là open. `PARTIAL` nghĩa là một phần finding đã đóng nhưng residual risk vẫn còn. Ghi owner + PR/ticket + build SHA/digest + bằng chứng triển khai.

> **Owner decision — secret trong Git:** Giữ nguyên các giá trị credential hiện có trong repository và audit artifacts. Đây là ngoại lệ đã biết, **không đồng nghĩa finding C-2/FE-C-1 đã đóng**. Phần Ops vẫn phải xác minh fingerprint của secret đang chạy; nếu trùng/reuse thì rotate/revoke và kiểm tra abuse.

## Delta register quan trọng — audit 2026-08-07

Đây là nguồn trạng thái chính cho toàn bộ Critical/High mới. Các section phía dưới giữ evidence và work item của wave 08-04; nếu mâu thuẫn thì register này được ưu tiên.

### Critical — canonical, đã loại duplicate

| Canonical ID | Finding / aliases | Priority | Trạng thái 2026-08-18 | Điều kiện đóng |
|---|---|:---:|---|---|
| C-1 | Demo admin/seed mount trong production compose | P0 | **OPEN** — bản compose vá chỉ giữ local và bị loại khỏi commit/release; DB production chưa dry-run/purge/retest | Release compose đã review bỏ seed mount; dry-run rồi disable/purge demo account; xác nhận còn admin thật và không hard-delete platform wallet khi còn dùng `account_id=1` |
| C-2 | Credential committed (`FE-C-1`) | P0/Ops | **OWNER EXCEPTION / OPS OPEN** — nội dung repo giữ nguyên; production reuse chưa fingerprint | Ghi kết quả fingerprint; nếu match/reuse thì rotate/revoke, restart toàn bộ consumer và audit abuse |
| C-3 | Negative order `quantity` mint balance | P0 | **DONE LOCAL** — `quantity` 1..100, wallet mutator reject non-positive, DB CHECK, HTTP regression giữ nguyên wallet | Deploy migration/artifact và retest production |
| C-4 | Wallet debit/withdraw race | P0 | **DONE LOCAL** — wallet rows đã lock; 10 concurrent order-create chỉ 1 thắng, concurrent withdraw cũng chỉ 1 thắng; balance/ledger nhất quán | Deploy migration/artifact và retest production |
| BE-C-1 | Negative usage `units` tạo quota | P0 | **DONE LOCAL** — schema + service + DB CHECK; buyer/internal `units=-1` đều 422, quota không đổi | Deploy migration/artifact |
| BE-C-2 | Negative variant `price` mint balance | P0 | **DONE LOCAL** — create/update `ge=0` + DB CHECK; hai HTTP regression 422 | Deploy migration/artifact |
| BE-C-3 | Concurrent order confirm/release | P0 | **DONE LOCAL** — confirm/dispute/job lock order `FOR UPDATE SKIP LOCKED`; unique ledger key; concurrent confirm + concurrent refund/reject; job không release đơn đã rời `delivered` | Deploy migration/artifact |
| FE-C-2 | BFF traversal vào `/internal/*` | P0 | **DONE LOCAL** — `buildUpstreamTarget` + HMAC signing trên header allowlist; unit test raw/encoded/backslash | Deploy artifact và blackbox lại public edge |

### High — canonical, đã gộp alias

| Canonical ID | Finding / aliases | Priority | Trạng thái 2026-08-18 | Điều kiện đóng |
|---|---|:---:|---|---|
| H-1 | Production compose default sang development | P0 | **OPEN** — compose inject production + runtime encryption key chỉ là local patch, không nằm trong commit/release | Release compose, container startup và `/docs` retest pass với secret runtime thật |
| H-2 | Backend container root + debug tools | P1 | **OPEN** — Dockerfile non-root/bỏ debug tools chỉ là local patch, không nằm trong commit/release | Ship Dockerfile, tách migration khỏi app startup và inspect image runtime |
| H-3 | Token không revocable (`BE-H-4`) | P1 | **DONE LOCAL** — opaque refresh + rotation/reuse kills family; access JWT `jti`/`sid`; logout/logout-all/password-reset revoke; BFF `dx_refresh` | Deploy artifact; stolen-token logout retest |
| H-4 | Jenkins root SSH, thiếu host-key pinning/gates | P1 | **OPEN** | Non-root deploy, pinned host key, test/audit/image gates blocking |
| H-5 | Mutable image tags + build không locked | P1 | **OPEN** — `npm ci` chỉ có trong Dockerfile local chưa ship; mutable tags/Python install/artifact digest còn mở | Ship locked build, image digest + frozen Python install + artifact digest evidence |
| BE-H-1 | Seller API key role/expiry/scope | P1/P2 | **SUPERSEDED** — `main` drop table `seller_api_keys` (`db1a2b3c4d5e6`); conflict lấy main, không khôi phục credential store | Không reopen; incident rotate chuyển sang BFF signing secret |
| BE-H-2 | Seller undo admin suspension | P1 | **DONE LOCAL** — seller schema không nhận lifecycle status; regression giữ `suspended` | Deploy artifact |
| BE-H-3 | Affiliate self-dealing/fund abuse | P1 | **DONE LOCAL** — fund lock không âm; skip commission nếu hết quỹ; clawback khi refund; public registration-IP collusion skip; daily cap | Deploy migration/artifact |
| BE-H-5 | Withdrawal TOCTOU | P0 | **DONE LOCAL** — wallet/request rows lock, balance guard + ledger key; concurrent withdrawals chỉ một request thắng | Deploy migration/artifact |
| BE-H-6 | Affiliate date range memory DoS | P1 | **DONE LOCAL** — strict date, reversed/over-366-day trả 422 | Deploy artifact |
| BE-H-7 | Systemic input constraints/body size | P1 | **DONE LOCAL** — write schemas có Field/list/JSON caps; ASGI body-size 1 MiB | Deploy artifact; edge body limit still recommended |
| FE-H-1 | Proxy forward client headers (`M-6`) | P0 | **DONE LOCAL** — request headers dựng từ allowlist `Accept`, `Accept-Language`, `Content-Type`; auth do BFF inject | Deploy artifact; header-capture retest edge |
| FE-H-2 | Backend public `:8001` (`M-5`) | P0 | **OPEN** — bind loopback chỉ có trong compose local chưa ship; chưa external probe trên production host | Deploy compose hoặc siết firewall/ingress; external probe connection refused |

### Nguyên tắc remediation cho lỗi tiền/concurrency

- `CHECK` constraints chỉ là backstop cho invariant dạng `amount >= 0`, `price >= 0`, `units_used >= 0`.
- `CHECK (balance >= 0)` **không** đóng lost-update, duplicate release hoặc duplicate withdrawal: hai transaction có thể cùng thành công mà số dư cuối vẫn không âm.
- Lỗi race phải có row lock hoặc atomic conditional update, state-transition guard, ledger idempotency/unique constraint và concurrency regression test.

## Cập nhật triển khai local — 2026-08-04

| Nhóm | Trạng thái | Evidence local |
|---|---|---|
| Next/dependency | **Đã xử lý code/build/runtime local** | Local `:3000` đã restart sang Next `16.3.0`; production-mode build 35 routes pass; `npm audit --omit=dev` = 0; locked production requirements `pip-audit` = 0 |
| Secret/CORS/demo/docs | **Đã xử lý application code** | Required secret + denylist/min length; demo off; allowlist CORS; docs/debug off; direct repo secret values giữ nguyên theo quyết định owner |
| Auth/operations/session | **Đã xử lý code** | Operations owner/admin-only; login/register/refresh limiter; inactive-account check; password ≥12; bearer chuyển sang HttpOnly SameSite cookie BFF |
| SSRF/provider credential | **Đã xử lý application layer** | Validate toàn bộ A/AAAA + TCP pin public IP, TLS giữ SNI/cert; API chỉ trả mask; write-only update giữ secret cũ |
| Abuse/logging | **Đã xử lý code** | Gateway IP+key limiter fail-safe; affiliate IP dedupe/limit; webhook auth response đồng nhất; payload log redaction + retention |
| Build/container/CI | **Container hardening chưa release** | Dockerfile/compose local có non-root/locked npm/no debug tools nhưng bị loại khỏi commit này; Jenkins chưa được sửa; CI/runtime gates vẫn là Ops open |
| Local encryption rotation | **Hoàn tất** | 15/15 provider credential re-encrypt sang key local mới; verify: 15 current, 0 pending |
| Backend regression | **Hoàn tất local** | Full suite cuối trên snapshot có observability mới: `669 passed, 0 failed`; targeted auth/security `29 passed`; targeted security/regression `30 passed` |

### Việc P0/P1 còn bắt buộc ở Ops/production

Các mục dưới đây **không thể đóng bằng source diff/local runtime** và vẫn giữ `[ ]`: deploy artifact đã vá; roll instance cũ; secret exposure triage bằng fingerprint; rotate/revoke secret production nếu trigger; production DB demo purge; ingress/NetworkPolicy chặn `/internal/*` và private egress; WAF/edge limiter; telemetry/history/image-layer scan; canary và blackbox trên đúng build SHA/digest. Direct repo secrets vẫn là accepted exception; compose/config/network chỉ được coi là đóng sau deploy. Đây là phần ảnh hưởng lớn nhất còn lại.

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

## Critical path hợp nhất

```text
Ngay lập tức: fingerprint secret production + contain :8001 và /internal/*
  -> Song song: P0-06 sign/input invariants + P0-07 concurrency/idempotency
               + P0-08 proxy/internal boundary + P0-09 prod compose/seed
  -> P0-05 full regression + security/concurrency tests trên reviewed SHA
  -> P0-01 build/deploy canary, roll toàn bộ instance, ghi image digest
  -> Nếu fingerprint match/reuse: P0-02 rotate/revoke trên artifact đã contain
  -> Blackbox retest production + sign-off
  -> P1/P2 auth lifecycle, infra hardening và medium/low backlog
```

> Triage/fingerprint và network containment làm ngay. Không cấp secret thay thế cho process/artifact chưa contain; khi reuse được xác nhận, rotate ngay sau khi consumer an toàn sẵn sàng.

### P0 execution board

| Work item | Owner | Ticket/PR | Deadline | Status / runtime evidence |
|---|---|---|---|---|
| P0-01 Next/RSC patch | Eng | local workspace | +4h | Code/build/audit **done**; production deploy/roll pending Ops |
| P0-02 Secret exposure triage/conditional rotate | Ops/Sec | cần ticket incident | +8h | Local encryption rotation done; production fingerprint/rotate **pending** |
| P0-03 Default secret + demo + CORS | Eng | local workspace | +16h | Code + local blackbox **done**; production runtime retest pending |
| P0-04 Operations auth + login limiter | Eng/Ops | local workspace + edge ticket | +24h | App layer **done**; edge/WAF limiter pending Ops |
| P0-05 Full tests + blackbox retest | Eng/Ops | local workspace + deploy ticket | +24h | Local full suite cuối `669 passed`; build/audit/blackbox pass; deployed artifact retest pending |
| P0-06 Financial sign/input invariants | Backend | local workspace | Block deploy | **DONE LOCAL** — guards + migration `cs1...`; negative regression pass; production deploy pending |
| P0-07 Concurrency + ledger idempotency | Backend/DB | local workspace | Block deploy | **DONE LOCAL** — create/confirm/withdraw/dispute/job locks; concurrent refund/reject + job skip tests; production deploy pending |
| P0-08 Proxy/internal boundary | Frontend/Ops | local workspace + deploy ticket | Block deploy | **PARTIAL** — traversal + header allowlist + BFF HMAC đã gộp; loopback compose / edge header/direct-port retest pending |
| P0-09 Production compose + demo seed | Ops/Backend | local workspace + deploy ticket | Block deploy | **OPEN** — production env/seed removal chỉ nằm ở compose local bị loại khỏi release; production DB/container retest pending |

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
- [x] Thêm và chạy regression cho negative `quantity`, `price`, `units`
- [x] Concurrent order-create + confirm + withdraw + dispute refund/reject dùng request/session DB độc lập
- [x] Standalone BFF traversal test raw/encoded/backslash; header-capture relay trên edge vẫn còn mở
- [ ] Chạy blackbox retest theo §10 trên đúng build SHA/artifact digest
- [ ] Không đóng P0 chỉ dựa trên source diff; phải có runtime evidence từ instance đã deploy

---

## P0-06. Financial sign/input invariants

- [x] `OrderCreate.quantity = Field(default=1, ge=1, le=100)`
- [x] `VariantCreate.price` và `VariantUpdate.price` reject giá âm; create/update đều có HTTP regression
- [x] `ChargeUsageRequest.units` reject `<1` cho buyer và internal model kế thừa; upper business cap vẫn là P1 input sweep
- [x] `deduct_credit()` và các wallet mutator reject `amount <= 0` trước mọi balance check
- [x] `charge_usage()`/`refund_usage()` reject `units < 1` ngay cả khi caller không đi qua Pydantic HTTP model
- [x] Migration `cs1a2b3c4d5e6` thêm DB CHECK backstop; apply lên DB test pass
- [x] Negative HTTP regression assert wallet/quota không đổi; exhaustive zero/upper-bound matrix còn nằm trong BE-H-7 sweep

**Definition of done:** C-3, BE-C-1 và BE-C-2 đều có test tái hiện fail trước fix, pass sau fix; không chỉ dựa vào một lớp validation.

## P0-07. Concurrency, state transitions và ledger idempotency

- [x] `deduct_credit()`/`request_withdraw()` lock wallet row trước balance check/update
- [x] `confirm_order()` lock order trước khi check `delivered -> completed`
- [x] Dispute create/refund/reject/partial/replace/extend và withdrawal approve/reject lock transition rows
- [x] Ledger có unique partial index `(type, reference_id)`; order/withdraw/affiliate mutator dùng stable reference
- [x] Lặp confirm trả conflict và không tạo release lần hai; withdrawal state guards giữ nguyên
- [x] Concurrent create/confirm/withdraw/dispute refund-vs-reject qua hai HTTP request với DB dependency/session độc lập pass
- [x] `escrow_release_job` / `sla_check_job` lock `FOR UPDATE SKIP LOCKED` và re-check status trước khi settle
- [x] DB `CHECK` chỉ dùng làm backstop; evidence race là row lock + unique index + concurrency tests

**Definition of done:** với N request đồng thời, đúng số operation hợp lệ thành công, balance/locked balance/ledger/order status nhất quán và không có duplicate payout.

## P0-08. BFF proxy và internal network boundary

- [x] Reject segment `.`, `..`, backslash, NUL và encoded/nested-percent equivalent trước khi tạo upstream URL
- [x] Validate origin + `target.pathname` nằm dưới normalized API base; chặn first segment `internal`
- [x] Tạo upstream headers từ allowlist; không clone toàn bộ client headers
- [x] `X-Internal-Key`, seller key, `X-Forwarded-*`, `X-Real-IP` và hop-by-hop headers không nằm trong allowlist
- [ ] Proxy tự inject forwarded identity chỉ từ trusted peer metadata nếu backend thực sự cần
- [ ] Compose bind backend `127.0.0.1:8001`; local patch bị loại khỏi release, ingress/NetworkPolicy production vẫn phải chặn `/internal/*`
- [x] Local standalone: raw/encoded/double-encoded/backslash traversal đều 404; direct-backend/header relay trên production còn mở

**Definition of done:** `/internal/*` không reachable từ public internet qua direct port, normalized traversal hay client-controlled headers.

## P0-09. Production compose, environment và demo seed

- [ ] Compose inject `DEPLOYMENT_ENVIRONMENT=production`, runtime-required `ENCRYPTION_KEY`, public frontend/backend base URL; local patch bị loại khỏi release
- [ ] Bỏ `db/marketplace-seed.sql` khỏi production init path; local patch bị loại khỏi release
- [ ] Chạy purge tool ở dry-run trước; tạo/xác nhận admin thật trước khi apply
- [ ] Không hard-delete account/platform wallet id 1 cho đến khi code bỏ hardcode `account_id=1` hoặc đã migrate platform wallet an toàn
- [ ] Verify production không còn demo login; `/docs`, `/redoc`, `/openapi.json`, `/version` đúng policy
- [ ] Ghi compose/config digest và DB verification evidence vào ticket deploy

**Definition of done:** fresh production volume không seed demo data; existing production DB không có demo credential hoạt động; platform fee flow vẫn chạy sau remediation.

---

## P1-01. Secrets & configuration hygiene

### 1.1 Gỡ secret khỏi git / repo

- [ ] Xóa direct plaintext secret khỏi `docker-compose.yml` — **owner hiện yêu cầu giữ nguyên; item này là accepted repository exception, không mark `[x]`**
- [x] Thêm `*.env.example` placeholder; production vẫn phải cấp từ secret manager/runtime
- [x] `backend.env`, backend `.env*` đã ignore; file secret local hiện hữu đặt mode 0600
- [ ] Di chuyển secret production khỏi workspace sang secret manager/runtime injection
- [x] File secret tạm giữ đã đặt mode 0600; việc xóa `.env.production.bk` chờ Ops backup/rotate production
- [x] Frontend/backend `.dockerignore` loại `.env*` (giữ `.env.example`), key/cert, dependency/build cache và test artifact khỏi Docker build context
- [ ] Chạy secret scan lịch sử Git (`gitleaks` / `trufflehog`); nếu phải purge remote history, rotate trước và phối hợp toàn team thay vì rewrite tùy tiện
- [ ] Scan cả image layer, CI artifact, log và backup; Git sạch không đồng nghĩa artifact sạch
- [ ] Thêm CI gitleaks gate; khi owner giữ direct values, cần baseline/allowlist đúng fingerprint và vẫn block mọi secret mới — không disable toàn bộ scanner

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
- [ ] Compose inject `API_URL` theo environment/deploy variable; tracked production compose vẫn hard-code public upstream
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
- [x] Access token TTL mặc định 15 phút; opaque refresh 7 ngày, rotate khi dùng, reuse phát hiện thì revoke cả family
- [x] Bearer token đã chuyển khỏi `localStorage` sang HttpOnly Secure(production) SameSite=Strict cookie qua same-origin BFF (`dx_session` + `dx_refresh`)
- [x] Logout/logout-all/password-reset revoke session trên backend; access JWT cũ trả 401; BFF xóa cả hai cookie
- [x] Không embed quyền nhạy cảm chỉ trong JWT claim (giữ check DB roles như hiện tại)

### 2.3 Brute force / abuse

- [x] **P0:** Rate limit `POST /auth/login` (IP + normalized email hash)
- [x] Rate limit `POST /auth/register` (IP)
- [x] Rate limit `POST /auth/refresh` (IP)
- [x] Rate limit `POST /affiliate/click` (IP + campaign hash)
- [x] Response login fail generic
- [x] Structured security events/metrics cho auth fail/rate-limit; alert routing production cần Ops cấu hình

### 2.4 Seller API-key lifecycle (BE-H-1)

- [x] Bearer/signed seller credential path re-read account và reject account không còn role `seller`
- [x] Signed credential regression: gỡ role seller trả 403 ngay; bearer path dùng cùng DB role check nhưng nên bổ sung test riêng
- [x] `expires_at` + TTL 90 ngày; signed/legacy query reject key hết hạn
- [x] Scope `orders:read`, `orders:write`, `resources:write`; key ngoài scope trả 403
- [x] Cap 5 active credentials/account, serialized bằng account row lock
- [ ] Hỗ trợ revoke-all khi incident

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
- [ ] Compose bind backend host port vào loopback/private listener; local patch bị loại khỏi release, production vẫn cần xác minh listener/ingress thật
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
- [x] Không trả commission khi affiliate là buyer, seller của chính order hoặc account inactive; rate phải trong `(0, 100]`
- [x] Global affiliate fund lock không âm; skip commission nếu hết quỹ; clawback khi hoàn; collusion IP public; daily cap

---

## P1/P2. Money & inventory integrity

### 4.1 Demo topup

- [ ] Prod: `ENABLE_DEMO_TOPUP=false` (verify env thật, không chỉ file mẫu)
- [ ] Local/dev: document khi bật; không bật trên shared staging có data gần-prod
- [ ] (Optional) xóa hẳn route demo-topup khỏi binary prod build
- [ ] Alert nếu demo-topup được gọi khi flag lỡ bật

### 4.2 Wallet / deposit / withdraw

- [x] Admin topup chỉ admin + audit log; production retention/alert vẫn cần Ops verify
- [ ] Deposit min/max / pending limit giữ nguyên; test bypass
- [x] Withdraw: tier limit + bank field validation
- [x] Withdraw balance/request row-locked + stable ledger reference; concurrent overdraw regression pass
- [ ] Reconcile job PayOS chạy và monitored

### 4.3 Resources / orders

- [ ] Internal acquire không gọi được từ public internet (xem 3.2)
- [ ] Buyer chỉ thấy resource/order của mình (test regression IDOR)
- [ ] `delivered_data` / gateway key chỉ trả owner (và admin có lý do)
- [x] Order quantity/variant price/usage units có sign/range guard + DB CHECK — xem P0-06
- [x] Confirm/dispute release escrow có transition lock + ledger idempotency; dispute concurrency regression riêng còn mở

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
- [x] Login/register `next` chỉ chấp nhận normalized same-origin relative path; external/protocol-relative/backslash/control input về fallback
- [x] Referral cookie value được URL-encode/decode; query value không thể chèn cookie attributes

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
- [x] Test negative quantity/price/units → 422 và wallet/quota không đổi
- [x] Test concurrent order-create/confirm/withdraw → đúng một operation thắng, không double-debit/duplicate release/overdraw
- [x] Test seller không unsuspend product và không nhận affiliate commission trên sale của chính mình
- [x] Test affiliate reversed/over-366-day range → 422
- [x] Test API key expiry, scope, cap và seller-role revocation
- [x] Test BFF traversal raw/encoded/double-encoded/backslash trên standalone build → 404

### 8.2 CI / pre-deploy

- [ ] `gitleaks` trên PR/push; chỉ bật lại sau khi xử lý direct values/history theo quyết định owner
- [x] `uv export --frozen --no-dev` + `pip-audit --strict -r ...` và `npm audit --omit=dev --audit-level=high` trong CI/weekly schedule
- [ ] Compose inject production mode + runtime-required encryption key; local patch bị loại khỏi release. Production Settings fail-fast/container smoke vẫn là Ops gate
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

| Gate | Kết quả 2026-08-18 |
|---|---|
| Backend remediation | Focused audit regression `12 passed`; concurrent order-create bổ sung `1 passed`; suite mở rộng lần đầu `177 passed, 2 failed`, sửa hai lỗi rồi rerun toàn bộ module liên quan `80 passed`; 99 case còn lại đã xanh ở lượt đầu |
| Migration | DB test upgrade `cr1... -> cs1... -> ct1...` pass; Alembic có một head `ct1a2b3c4d5e6` |
| Frontend | `tsc --noEmit`, EN/VI parity và production-mode Next `16.3.0` build đều pass |
| Dependency | npm production 0 vulnerability; pip audit trên requirements export từ `uv.lock` không có vulnerability đã biết |
| BFF blackbox | Standalone build trả 404 cho direct internal, dot traversal, double-encoded traversal, backslash và encoded slash; prior CSRF/public pagination/header tests giữ nguyên |
| Backend blackbox | health 200; docs/OpenAPI/version 404; operations anonymous 401; evil CORS không được reflect |
| Production-mode headers | CSP không có `unsafe-eval`; HSTS, DENY, nosniff, referrer/permissions/COOP có mặt; không `X-Powered-By`/`Server` |
| Local runtime `:3000` | Đã thay process Next `15.5.4` bằng Next `16.3.0`; root/catalog 200, pagination enforce, `/api/internal/*` 404 |
| Config/container | Local-only validation: compose config pass với runtime encryption key; loopback bind, non-root/debug-tool removal và `npm ci` bị loại khỏi commit/release này — không được dùng làm evidence production |
| Secret preservation | Direct secret values/history/audit artifacts không bị xóa hay rotate theo quyết định owner; C-2/FE-C-1 vẫn là accepted exception + Ops open |

Dockerfile/compose hardening được giữ local và **bị loại khỏi commit/release này**. CI/registry phải build artifact từ reviewed SHA, inspect runtime UID/tools, chạy smoke và ghi digest trước deploy; các finding container/compose vẫn OPEN. Secret plaintext được giữ nguyên theo chỉ đạo owner; không được diễn giải thành finding đã đóng.

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
- [ ] Negative `quantity`, `price`, `units` đều trả 422 trên artifact deploy; wallet/quota/ledger không đổi
- [ ] Concurrent create/confirm/withdraw/dispute tests pass với connection độc lập; không duplicate ledger/payout
- [ ] BFF raw/encoded traversal trả 400/404 và không forward internal/forwarded headers từ client
- [ ] External probe tới backend `:8001` connection refused; `/internal/*` chỉ reachable từ trusted network
- [ ] Seller bị gỡ role không dùng được bearer/signed API credential; expiry/scope/cap phải retest trên artifact deploy
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

### Audit v1 Critical/High → work package

| IDs | Work package |
|---|---|
| C-1, H-1 | **P0-09** production compose, environment và demo seed |
| C-2 / FE-C-1 | **P0-02** fingerprint/incident branch; repository content giữ theo owner exception |
| C-3, BE-C-1, BE-C-2 | **P0-06** financial sign/input invariants |
| C-4, BE-C-3, BE-H-5 | **P0-07** concurrency, state transition và ledger idempotency |
| FE-C-2, FE-H-1, FE-H-2 | **P0-08** BFF proxy và internal network boundary |
| H-2, H-4, H-5 | P1 infra/container/CI hardening |
| H-3 / BE-H-4, BE-H-1 | §2.2 và §2.4 credential/session lifecycle |
| BE-H-2 | §3.1 product lifecycle authorization |
| BE-H-3 | §3.5 affiliate fraud controls |
| BE-H-6, BE-H-7 | P1 input/range/body-size hardening |

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
