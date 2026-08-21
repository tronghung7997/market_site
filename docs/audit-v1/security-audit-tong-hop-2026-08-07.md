# Báo Cáo Tổng Hợp Security Audit — market_site Marketplace

> **Phân loại:** Confidential — Internal Use Only  
> **Ngày:** 2026-08-07  
> **Nhánh:** check-security  
> **Source re-validation/execution:** 2026-08-18 trên `main` HEAD `0558bcc796c26914467937f34c94f2835fc54fa4` + remediation working tree
> **Stack:** FastAPI 0.115 · Next.js 16.3.0 · PostgreSQL · Redis · Docker  
> **Rủi ro tổng thể:** 🔴 CRITICAL — Chưa được phép deploy production  
> **Phạm vi:** White-box (toàn bộ source) + Black/Gray-box (2026-08-04)

---

## 1. Phương Pháp Audit

```
BƯỚC 1 — RECON / XÁC ĐỊNH PHẠM VI
  ├── Map attack surface: endpoints, ports, auth boundaries
  ├── Xác định stack versions và dependencies
  └── Thu thập docker-compose, Dockerfile, CI/CD config

BƯỚC 2 — STATIC ANALYSIS (White-box)
  ├── Scan secrets: grep + gitleaks trong toàn bộ git history
  ├── Dependency audit: npm audit, pip-audit
  ├── Code review: auth/authz, SQL injection, eval/exec
  ├── Schema validation: Pydantic/Zod coverage
  ├── Business logic: money flows, race conditions
  └── Config review: CORS, headers, env vars

BƯỚC 3 — DYNAMIC ANALYSIS (Black/Gray-box)
  ├── Auth bypass attempts (JWT forge, session fixation)
  ├── Business logic abuse (wallet topup, affiliate farming)
  ├── SSRF probing và rate limiting
  └── Path traversal / header injection

BƯỚC 4 — THREAT MODELING
  ├── Data flow diagram theo kiến trúc thực
  ├── Trust boundaries (public internet / Docker network / DB)
  └── STRIDE per component

BƯỚC 5 — BÁO CÁO + REMEDIATION CHECKLIST
  ├── Phân loại severity: Critical → High → Medium → Low
  ├── Evidence + reproduction steps đầy đủ
  └── Fix guidance + retest criteria

BƯỚC 6 — RETEST / SIGN-OFF
  ├── Verify từng finding đã fix
  ├── Regression test suite pass
  └── Production deploy sign-off
```

---

## 2. Tổng Quan Findings

### 2.1 Kiến Trúc Hệ Thống

```
Internet
   |
   |--- :3001 ──► frontend (Next.js 16.3.0)
   |                  |  /api/[...path] proxy → marketplace-svc:8001
   |
   └--- :8001 ──► marketplace-svc (FastAPI)   ← EXPOSED TRỰC TIẾP, không TLS proxy
                     |
              [market_site bridge network]
                     |
           +---------+-----------+
           |                     |
        postgres:5432          redis:6379
        (port không public)    (no auth, port không public)

Cloudflare Tunnel — token committed vào git (đã comment nhưng còn trong history)
Private registry: registry.k7:5000 (HTTP plaintext, không digest pinning)
```

**Điểm yếu kiến trúc:** Port 8001 public bypasses toàn bộ proxy controls (CSRF, header stripping, internal blocklist). Redis không auth — mọi process trong Docker network đọc/ghi được.

---

### 2.2 Bảng Tổng Hợp Findings

| Severity   | Whitebox (08-07) | Backend Deep (08-07) | Frontend Deep (08-07) | Raw occurrences |
|------------|:---:|:---:|:---:|:---:|
| **Critical** | 4 | 3 | 2 | **9** |
| **High**     | 5 | 7 | 2 | **14** |
| **Medium**   | 9 | 12 | 7 | **28** |
| **Low/Info** | 6 | 10 | 8 | **24** |
| **Tổng**     | 24 | 32 | 19 | **75** |

> `75` là số lần finding xuất hiện trong ba report, **không phải số unique**. Sau khi gộp alias rõ ràng: Critical còn **8 canonical findings** (`C-2 = FE-C-1`), High còn **13** (`H-3 = BE-H-4`). Medium/Low chưa có crosswalk đầy đủ nên không công bố một con số unique ước lượng. Trạng thái canonical nằm trong `security-audit-remediation-checklist.md`.

---

## 3. Critical Findings — Phân Tích Chi Tiết

### C-1 · Working admin account seeded vào production DB
- **CVSS:** 9.8 · **OWASP:** A07
- **File:** `docker-compose.yml:18` → `db/marketplace-seed.sql:1006`
- **Vấn đề:** Seed file mount vào production compose, chạy khi init volume mới. Tạo `admin@dxtrade.example.com / DemoPass123!` với roles `[buyer, admin, seller]`. Account ID 1 đồng thời là platform fee wallet.
- **Fix:** Xóa seed mount khỏi production compose. Chạy `python -m src.ops.purge_demo`. Thêm startup assertion từ chối `*@dxtrade.example.com` trên production.

---

### C-2 · Live production secrets committed vào git history
- **CVSS:** 9.1 (FE-C-1 / C-2) · **OWASP:** A02
- **File:** `docker-compose.yml:11,39,41,42`
- **Secrets bị lộ:**
  ```yaml
  POSTGRES_PASSWORD: 3ivYYwOP27U2vF9Z
  DATABASE_URL: postgresql+asyncpg://marketplace:3ivYYwOP27U2vF9Z@postgres:5432/marketplace
  JWT_SECRET: 567fbb317c8d42956c452f353045c8baddeca9b4736040261c715f0e87a04a57
  INTERNAL_API_KEY: 7w8EAM76idmctHxtg1820VIzk7N85nDU
  # TUNNEL_TOKEN: eyJhIjoiM2I3ZD... (commented, nhưng còn trong history)
  ```
- **Impact:** `JWT_SECRET` là HS256 signing key → bất kỳ ai có repo access có thể forge JWT với `roles: ["admin"]` → toàn quyền admin. Chain với FE-C-2 (path traversal) cho phép unauthenticated access vào `/internal/*`.
- **Fix:** Rotate ngay 4 secrets. Purge history (`git filter-repo`). `git rm --cached docker-compose.yml`. Thêm `gitleaks` vào Jenkinsfile blocking stage.

---

### C-3 · Negative `quantity` mints unlimited wallet balance
- **CVSS:** 9.3 · **OWASP:** A04
- **File:** `src/orders/schemas.py:8`, `src/wallet/service.py:93`
- **Vấn đề:**
  ```python
  quantity: int = 1   # no ge=1
  total = variant.price * quantity   # quantity=-100 → total âm
  if wallet.available_balance < amount:  # 0 < -500000 → False → pass
      raise InsufficientCredit()
  wallet.available_balance -= amount     # -= -500000 → +500000
  ```
- **Fix:** `quantity: int = Field(1, ge=1, le=100)`. Guard `if amount <= 0: raise` trong tất cả wallet mutators.

---

### C-4 + BE-C-3 · Hai race condition độc lập — wallet debit và order release
- **CVSS:** 8.6–8.1 · **OWASP:** A04
- **Files:** `src/wallet/service.py:91`, `src/orders/service.py:441`
- **Vấn đề:** Không có `FOR UPDATE`/atomic conditional update. N request có thể cùng pass check trên state stale. Tùy interleaving, kết quả có thể là lost update, duplicate release/ledger hoặc credit/payout lặp; balance cuối vẫn có thể không âm nên không được dùng làm bằng chứng race đã an toàn.
- **Fix:** Row lock hoặc atomic conditional update cho debit/withdraw; lock state transition cho confirm/dispute/approval; thêm ledger idempotency/unique key. `CHECK (available_balance >= 0)` chỉ là backstop cho scalar invariant, không đóng race.

---

### BE-C-1 · Negative `units` trên usage charge → unlimited free gateway quota
- **CVSS:** 8.6 · **OWASP:** A04/A01
- **File:** `src/usage/schemas.py:8`, `src/usage/service.py:87`
- **Vấn đề:** `units: int = 1` không có `ge=1`. `units=-1000000` pass quota check, `units_remaining` trở thành effectively unlimited.
- **Fix:** `units: int = Field(1, ge=1, le=<max>)` trên cả hai request models. Guard `if units < 1: raise HTTPException(422)` đầu `charge_usage()`.

---

### BE-C-2 · Seller-settable negative variant price → mint wallet balance
- **CVSS:** 9.1 · **OWASP:** A04/A08
- **File:** `src/products/schemas.py:61`, `src/orders/service.py:56`
- **Vấn đề:** `price: int` không có `ge=0`. Seller tạo variant `price=-50_000_000`, buyer mua → wallet += 50M VND, rút được ngay. Path riêng biệt với C-3, fix C-3 không đóng được.
- **Fix:** `price: int = Field(ge=0)` trên `VariantCreate`/`VariantUpdate`. `CheckConstraint("price >= 0")` trên DB.

---

### FE-C-2 · API proxy `internal/` blocklist bypass qua path traversal
- **CVSS:** 9.1 · **OWASP:** A01
- **File:** `frontend/app/api/[...path]/route.ts:59`
- **Vấn đề:** Blocklist validate raw string trước khi `new URL()` normalize. `"../internal/foo"` bypass guard, sau normalize trỏ vào `/internal/*`.
  ```bash
  curl --path-as-is "/api/a/../../internal/metrics"
  curl "/api/%2e%2e/internal/metrics" -H "X-Internal-Key: 7w8EAM76idmctHxtg1820VIzk7N85nDU"
  ```
- **Fix:** Validate AFTER normalization. Reject traversal segments trước (`..`, `.`, `\0`). Chuyển sang allowlist ~40 route prefixes.

---

## 4. High Priority Findings

| ID | Title | CVSS | File |
|----|-------|:----:|------|
| H-1 | Production chạy development mode — guardrails disabled | 7.5 | `docker-compose.yml:38` |
| H-2 | Backend container chạy root, có curl/vim | 7.3 | `marketplace-svc/Dockerfile:18` |
| H-3 / BE-H-4 | Token không revocable — stolen token refresh vô hạn | 7.1 | `src/auth/router.py:80` |
| H-4 | Jenkins deploy bằng root SSH, không verify host key | 7.0 | `Jenkinsfile:19` |
| H-5 | Image tags mutable, Python deps không pin | 6.8 | `docker-compose.yml` |
| BE-H-1 | Seller API key bypass `seller` role check, không expire | 7.1 | `src/auth/dependencies.py:67` |
| BE-H-2 | Seller undo admin product suspension | 6.5 | `src/products/service.py:69` |
| BE-H-3 | Affiliate commission farming: self-dealing loop | 7.5 | `src/affiliate/service.py:71` |
| BE-H-5 | Withdrawal TOCTOU — balance không lock | 7.1 | `src/wallet/service.py:181` |
| BE-H-6 | Unbounded date range affiliate stats → memory DoS | 6.5 | `src/affiliate/service.py:487` |
| BE-H-7 | Systemic thiếu Field constraints trên Pydantic schemas | 7.0 | `*/schemas.py` (nhiều files) |
| FE-H-1 | Proxy forward tất cả client headers lên backend | 7.3 | `frontend/app/api/[...path]/route.ts:71` |
| FE-H-2 | Backend exposed `0.0.0.0:8001` — bypass toàn bộ proxy | 7.5 | `docker-compose.yml:36` |

**H-1 detail:** `DEPLOYMENT_ENVIRONMENT` thiếu trong production compose → default `"development"` → vô hiệu hóa: HSTS, HTTPS-only CORS, demo-topup ban, API docs ban, debug routes ban. `ENCRYPTION_KEY` cũng thiếu.

**BE-H-7 detail:** Chỉ 16 fields trên toàn bộ `*/schemas.py` có `Field()` constraint. Notable: `quantity`, `price`, `units`, `sla_hours`, `commission_rate`, `items: list[str]` đều unbounded. Không có body-size middleware.

---

## 5. Medium Priority Findings (Tóm tắt)

| ID | Title | CVSS |
|----|-------|:----:|
| M-1 | Không có DB-level CHECK constraints trên money columns | 5.9 |
| M-2 | Oversized login password → unhandled 500 | 5.3 |
| M-3 | Redis không authentication | 5.5 |
| M-4 | Dev compose publish DB ra all interfaces | 5.8 |
| M-5 / FE-H-2 | FastAPI port public, không TLS proxy | 5.3 |
| M-6 / FE-H-1 | Next.js proxy forward arbitrary headers | 5.0 |
| M-7 | Pending-deposit count check không atomic | 4.3 |
| M-8 | Seller API keys không expire, không scope | 4.8 |
| M-9 | Latent SSRF sink trong provider health probe | 4.0/7.5 |
| BE-M-1 | Rate limiting collapse về 1 bucket sau reverse proxy | 6.5 |
| BE-M-2 | `/debug/version` unauthenticated → leak build info | 5.8 |
| BE-M-3 | Buyer freeze seller funds vô hạn (dispute griefing) | 5.3 |
| BE-M-8 | Money lưu trong 32-bit Integer — overflow ở ~22 deposits | 5.5 |
| BE-M-10 | Category tree cho phép cycle → infinite recursion | 5.3 |
| FE-M-2 | Auth enforced client-side only, không middleware gate | 5.3 |
| FE-M-3 | Open redirect qua unvalidated `next` parameter | 6.1 |
| FE-M-4 | React Query cache không xóa khi logout | 5.5 |

---

## 6. Positive Security Controls (Giữ Nguyên)

✅ Startup config validation từ chối insecure secrets, enforce ≥32-byte entropy  
✅ SSRF guard với DNS-pinning, re-validate mỗi outbound call, `trust_env=False`  
✅ PayOS webhook: `compare_digest`, empty-key refusal, `FOR UPDATE` locking, `paymentLinkId` cross-check, idempotency via unique constraint, reject negative amount  
✅ Provider webhook fail closed — không configured secret → reject mọi callback  
✅ `httpOnly + sameSite:strict + secure` cookie; không token trong `localStorage`  
✅ CSRF qua Fetch-Metadata với Origin fallback  
✅ Auth dependency coverage đầy đủ ~20 routers  
✅ Gateway path traversal blocked: `^[A-Za-z0-9_-]{1,64}$` + explicit endpoint allowlist  
✅ Security event telemetry với keyed HMAC principal fingerprints  
✅ Auth rate limiting bucketed theo cả IP và hashed email; `fail_open=False`  
✅ Sentry scrubbing: `send_default_pii=False`, drop body/query/cookies  
✅ Provider credentials encrypted at rest với Fernet  
✅ Tất cả SQL parameterized — không có string-concatenated queries  
✅ Zero XSS sinks trong frontend (không `dangerouslySetInnerHTML`, `eval`, `innerHTML`)  
✅ Token không expose ra JavaScript — httpOnly cookie only  
✅ Seller markdown sandboxed với `disableParsingRawHTML: true`  
✅ `npm audit` = 0 vulnerabilities  

---

## 7. Trạng Thái Remediation

### 7.1 Đã Fix (Local — 2026-08-04 đến 08-07)

| Nhóm | Trạng thái | Evidence |
|------|-----------|---------|
| Next.js RSC patch | ✅ Done | 15.5.4 → 16.3.0; `npm audit` = 0; build pass |
| Demo topup tắt | ✅ Done | Code disabled; local blackbox confirm |
| CORS lockdown | ✅ Done | Allowlist thay vì `*` |
| Default secret fail-fast | ✅ Done | Startup validation enforce entropy |
| Auth gate operations | ✅ Done | owner/admin-only |
| Rate limiting login/register | ✅ Done | IP + hashed email bucket |
| Inactive-account check | ✅ Done | |
| Password ≥12 chars | ✅ Done | |
| Session cookie httpOnly/SameSite/Secure | ✅ Done | BFF pattern |
| SSRF guard DNS-pinning | ✅ Done | |
| Provider credential Fernet encryption | ✅ Done | 15/15 re-encrypted |
| Local provider key rotation | ✅ Done | 15 current, 0 pending |
| Backend regression suite | ✅ Done | **669 passed, 0 failed** |
| Security regression suite | ✅ Done | 29 + 30 passed |
| `.dockerignore` loại `.env` | ✅ Done | |
| CI npm/pip audit + full pytest | ✅ Done | |

### 7.1b Wave thực thi audit v1 — 2026-08-18

| Nhóm | Trạng thái local | Evidence |
|---|---|---|
| C-3, BE-C-1, BE-C-2 | ✅ Done local | Quantity/price/units guards + migration DB CHECK; negative HTTP regressions giữ wallet/quota nguyên |
| C-4, BE-C-3, BE-H-5 | ✅ Done local | Transition/wallet locks + unique ledger reference; 10 concurrent order-create chỉ 1 thắng, confirm/withdraw cũng chỉ một operation thắng |
| FE-C-2, FE-H-1 | ✅ Done local | Normalized target containment + header allowlist; 5 traversal PoC standalone trả 404 |
| BE-H-1, BE-H-2, BE-H-6 | ✅ Done local | API-key TTL/scope/cap, seller không unsuspend, affiliate max 366 ngày; regression pass |
| BE-H-3, BE-H-7 | ⚠️ Partial | Self-dealing/rate bounds + financial DB invariants đã có; fund/clawback/collusion và full input/body sweep còn mở |
| Compose/container | ⚠️ Partial | Production env/runtime encryption key, seed removal, loopback backend, non-root/no-debug Dockerfiles; deploy/inspect/probe còn mở |
| Secret committed | ⏸ Owner exception | Giá trị/history giữ nguyên theo chỉ đạo owner; fingerprint/reuse/rotation production vẫn open |
| Verification | ✅ Local | 12 focused pass + 1 concurrent order-create pass; 99 unaffected pass ở suite mở rộng; 80/80 module liên quan pass sau fix; frontend type/i18n/build và compose config pass |

### 7.2 Còn Pending (Ops / Production)

| Mục | Priority | Ghi chú |
|-----|:--------:|---------|
| Deploy artifact mới lên production | **P0** | Chưa có confirmation build SHA |
| Conditional rotate JWT/DB/internal/tunnel credentials | **P0/Ops** | Chỉ thực hiện nếu fingerprint xác nhận production reuse/exposure; repository values giữ nguyên theo owner exception |
| Purge git history (`git filter-repo`) | **Owner exception** | Không thực hiện trong wave này; chỉ mở lại khi owner đổi quyết định và team đã phối hợp |
| `git rm --cached docker-compose.yml` | **Owner exception** | Không thực hiện; tracked secret values được giữ nguyên theo chỉ đạo owner |
| Deploy compose có `DEPLOYMENT_ENVIRONMENT=production` | **P0** | Source đã sửa; production inspect/smoke chưa có |
| Cấp `ENCRYPTION_KEY` runtime thật | **P0** | Compose fail-fast nếu thiếu; secret manager/deploy pending |
| Purge demo account khỏi production DB | **P0** | Seed mount đã bỏ; existing DB chưa dry-run/purge |
| Deploy loopback bind cho port 8001 | **P1** | Source bind `127.0.0.1`; external production probe pending |
| Ingress/NetworkPolicy chặn `/internal/*` | **P1** | |
| Redis requirepass | **P1** | Hiện unauthenticated |
| WAF/edge rate limiter | **P1** | Rate limit collapse sau proxy |
| Canary + blackbox retest trên production SHA | **P1** | |
| Jenkins: non-root deploy, host-key pinning | **P1** | |
| Jenkins: blocking stages (trivy, gitleaks, audit) | **P1** | |
| Image digest pinning (Dockerfiles + compose) | **P2** | |
| Refresh token model + jti + Redis denylist | **P2** | |
| Seller API key deploy + revoke-all incident action | **P2** | TTL/scope/cap đã xong local; production migration/retest pending |
| BigInteger migration cho money columns | **P2** | Overflow ở ~$85k |
| Nonce-based CSP | **P3** | |

---

## 8. Critical Path (Không Đổi Thứ Tự)

```
P0-01  Deploy artifact đã vá lên production
  └──► P0-02  Xác minh secret exposure; rotate nếu reuse/exposure
         └──► P0-03  Set DEPLOYMENT_ENVIRONMENT=production; xóa seed mount
                └──► P0-04  Chặn port 8001; thiết lập ingress rules
                       └──► P0-05  Blackbox retest trên production build SHA
                              └──► P1  SSRF/Redis/Jenkins hardening
                                     └──► P2  Auth revocation + business logic fixes
```

> ⚠️ **Không rotate secret mới vào process còn vulnerable.** Patch/contain trước, rotate sau.

---

## 9. Retest Checklist (Tóm Tắt)

| ID | Verify bằng | Pass khi |
|----|-------------|---------|
| C-1 | `SELECT email FROM accounts WHERE email LIKE '%@dxtrade.example.com'` | Zero rows; login trả 401 |
| C-2 | `git log --all -S "3ivYYwOP27U2vF9Z" --oneline` + `gitleaks detect` | Zero commits match; CI pass |
| C-3 | `POST /api/v1/orders {"quantity": -100}` | Returns 422; wallet không đổi |
| C-4 | Fund 1 unit, 10 concurrent orders | 1 order pass; balance = 0; không âm |
| H-1 | `docker inspect` env + `GET /docs` | `production` set; `/docs` → 404 |
| H-2 | `docker exec id` + `which curl` | Non-root UID; curl not found |
| H-3 | Login → logout → dùng token cũ | 401 post-logout |
| BE-C-1 | `POST /orders/{id}/usage {"units": -1}` | 422 |
| BE-C-2 | Tạo variant `price=-1`, mua, check wallet | 422 trên create hoặc wallet không tăng |
| FE-C-2 | `curl --path-as-is "/api/a/../../internal/metrics"` | 404 hoặc 400 |
| FE-H-1 | Request qua proxy với `X-Internal-Key: anything` | Backend không nhận header |
| FE-H-2 | `curl http://<host>:8001/health` từ ngoài Docker | Connection refused |
| FE-M-3 | Login với `?next=https://evil.tld` | Redirect đến `/` hoặc 400; không về evil.tld |

---

## 10. Tài Liệu Tham Khảo

| File | Nội dung |
|------|---------|
| `docs/security-audit-whitebox-2026-08-07.md` | White-box full (24 findings) |
| `docs/security-audit-backend-deep-2026-08-07.md` | Backend deep dive (32 findings) |
| `docs/security-audit-frontend-deep-2026-08-07.md` | Frontend deep dive (19 findings) |
| `docs/security-audit-blackbox-graybox-2026-08-04.md` | Black/gray-box 08-04 |
| `docs/security-audit-remediation-checklist.md` | Checklist P0–P3 có tracking |

---

*Báo cáo tổng hợp này hợp nhất nội dung từ 4 audit docs riêng lẻ. Mọi thay đổi trạng thái phải cập nhật vào `security-audit-remediation-checklist.md`.*  
*Sign-off: Tất cả P0 phải pass trước khi bất kỳ production deployment nào được phép.*
