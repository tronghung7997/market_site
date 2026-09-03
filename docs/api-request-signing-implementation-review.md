# Kế hoạch triển khai API Request Signing Authentication

> Trạng thái: **Phase 1 in review — hardening pass applied** (2026-08-07)
> Phạm vi reviewer: Review thiết kế, implementation, migration, test và rollout.
> Quyết định replay: **chỉ bounded timestamp window** (±300s) — không nonce store ở v1; tài liệu/UI không claim chống replay hoàn toàn.
> **Chưa “complete/verified”** cho đến khi reviewer re-review + suite xanh ổn định (không deadlock).

## Tiến độ (cập nhật 2026-08-07)

| Hạng mục | Trạng thái ``| Ghi chú |
|----------|------------|---------|
| Protocol + module ký | ✅ Hardened | ASCII path contract; bytes HMAC; dummy Fernet decrypt |
| DB migration | ✅ Hardened | downgrade **fails** if signed-only rows exist (no silent DELETE) |
| Auth dependency | ✅ Hardened | header *presence* (incl. empty) → no JWT/legacy fallback |
| Credential API | ✅ Done | create returns `api_key` + `api_secret` once |
| Rate limit IP | ✅ Hardened | `TRUSTED_PROXY_CIDRS` + right→left XFF; startup CIDR validate; empty = peer only |
| CORS (app) + Sentry scrub | ✅ Done | positive preflight test for signing headers |
| Unit / integration tests | ✅ **77 passed** (hardening subset) | signing + seller keys + client_ip + migration + security + observability |
| Frontend tsc + i18n + build | ✅ Prior pass | path ASCII note added to EN/VI copy |
| Production deploy | ⏳ Pending | Prod still legacy-only |
| Phase 2–4 rollout | ⏳ Pending | Client migration → deny legacy → cleanup |

### Reviewer findings fixed (this pass)

1. **High** — migration downgrade no longer `DELETE`s signed credentials; raises `RuntimeError` with count.
2. **Medium** — empty signing headers detected via `name in request.headers`; no JWT/legacy fallback.
3. **Medium** — `client_ip()` only honors `X-Forwarded-For` when peer ∈ `TRUSTED_PROXY_CIDRS`;
   XFF walked **right→left**, skip trusted hops (anti left-hop spoof). `TRUSTED_PROXY_CIDRS` validated at startup.
4. **Medium** — canonical path is raw ASGI bytes; non-ASCII rejected; HMAC over ASCII octets.
5. Dummy secret always Fernet-decrypted (cached ciphertext) — no “skip decrypt on miss”.
6. Positive CORS preflight test for `X-API-Key` / `X-Timestamp` / `X-Signature`.

### Verification log

**Backend (local)**

```text
pytest tests/test_request_signing.py tests/test_seller_api_keys.py \
  tests/test_observability.py tests/test_security_hardening.py \
  tests/test_auth.py tests/test_orders.py
→ 108 passed (broader core suite; prior verification run)
```

API smoke against `http://127.0.0.1:8001`:

| Case | Result |
|------|--------|
| Valid signed `GET /seller/orders` | 200 |
| JWT `GET /seller/orders` | 200 |
| Partial signing headers | 401 missing headers |
| Bad signature | 401 generic |
| JWT + signing together | 401 credential confusion |
| Create credential | 201 `ak_live_` + `sk_live_` + `signing_version=v1` |
| List credentials | masked prefix only, no secret |

**Frontend**

| Check | Result |
|-------|--------|
| TypeScript | pass |
| i18n EN/VI parity | pass |
| Production build | pass (`/seller/api-settings` route present) |
| UI EN `/en/seller/api-settings` | credentials table, legacy banner, signing docs, Python/Node/shell, test vector |
| UI create modal | shows `api_key` + `api_secret` + version; warning once-only |
| UI VI | keys translated (`Tạo credentials`, `Cách ký request`, `Header cũ`) |
| Browser storage | no `sk_live_` in localStorage/sessionStorage |

**Production baseline (pre-deploy, 2026-08-07)**

- `GET /health` ok
- No-auth message still legacy: *"Yêu cầu đăng nhập hoặc API key"*
- Signing headers ignored; only `X-Seller-Api-Key` + JWT active
- Nginx CORS does **not** yet list `X-API-Key` / `X-Timestamp` / `X-Signature` (server-to-server unaffected)

---

## 1. Phạm vi

Triển khai request signing cho các Seller API:

- [x] `GET /seller/orders`
- [x] `POST /seller/orders/{order_id}/accept`
- [x] `POST /seller/orders/{order_id}/deliver`
- [x] `POST /seller/variants/{variant_id}/resources`
- [x] Giữ nguyên JWT authentication cho frontend/browser
- [x] Không thay đổi business logic của các endpoint

Headers mục tiêu:

```http
X-API-Key: ak_live_xxxxxxxxx
X-Timestamp: 1786089600
X-Signature: v1=<hmac-sha256-hex>
```

## 2. Chốt protocol ký request

### 2.1. Credential model

- [x] `X-API-Key` chỉ là public credential identifier
- [x] API secret được tạo riêng
- [x] API secret chỉ trả về một lần khi tạo credential
- [x] API secret không được gửi trong request
- [x] Không dùng `X-API-Key` làm HMAC secret
- [x] Signing version ban đầu là `v1`

### 2.2. Canonical request

```text
HTTP_METHOD
RAW_PATH_WITH_QUERY
X_TIMESTAMP
SHA256_HEX(RAW_BODY)

signature = HMAC_SHA256(api_secret, canonical_request)
X-Signature = "v1=" + HEX(signature)
```

- [x] Method uppercase; raw path+query; no sort/re-encode
- [x] Hash raw body (empty = SHA-256 of empty bytes)
- [x] Timestamp Unix seconds; lowercase hex; `v1=` prefix
- [x] `hmac.compare_digest`; fixed test vector in unit tests + UI

## 3. Chống replay

- [x] Tolerance default `300`s; reject past/future outside window; UTC
- [x] **Chỉ bounded timestamp window** (v1) — không nonce
- [x] Docs/UI explicitly say not full anti-replay

## 4. Database migration

- Files: `models/seller_api_key.py`, `alembic/versions/cl1a2b3c4d5e6_signed_api_credentials.py`
- [x] `key_id`, `signing_secret_encrypted`, `signing_version`
- [x] Legacy `key_hash` / `key_prefix` kept; `key_hash` nullable for signed-only rows
- [x] Prefixes `ak_live_` / `sk_live_`; secret encrypted at rest; unique `key_id`
- [x] Safe upgrade/downgrade; legacy auth uninterrupted

## 5. Module request signing

`marketplace-svc/src/auth/request_signing.py`

- [x] Header validation, timestamp, signature format
- [x] Active credential lookup; dummy secret for unknown keys
- [x] Raw body + canonical + HMAC + constant-time compare
- [x] Account active + seller role; `request.state.account_id` / `api_key_id`
- [x] `last_used_at` only after success; body re-readable by handlers

## 6. Auth dependency

`get_seller_account_jwt_or_signed_request` (+ alias `get_seller_account_jwt_or_api_key`)

- [x] JWT ok; full signing headers required when any present
- [x] No fallback after bad signature; no JWT+signing mix
- [x] Applied to seller orders list/accept/deliver + bulk resources

## 7. Credential management API

- [x] Create public key + secret; encrypt secret; show once
- [x] No secret in audit log / list / re-fetch
- [x] Revoke ownership-checked; UI once-only warning

## 8. Config và rate limiting

```env
API_SIGNING_TIMESTAMP_TOLERANCE_SECONDS=300
API_SIGNING_IP_LIMIT=120
API_SIGNING_KEY_LIMIT=60
LEGACY_SELLER_API_KEY_MODE=allow
```

- [x] Defaults; limits > 0; IP then opaque key hash; `fail_open=False`
- [x] `Retry-After` on 429; metrics for auth method + rejection

## 9. CORS và secret scrubbing

- [x] App CORS: `X-API-Key`, `X-Timestamp`, `X-Signature`, legacy header
- [x] Sentry redacts signing + legacy headers
- [ ] **Ops:** align prod nginx `Access-Control-Allow-Headers` if browser clients need CORS

## 10. UI / docs

`frontend/app/[locale]/seller/(dashboard)/api-settings/page.tsx`

- [x] Canonical docs; Python / Node / shell examples; test vector
- [x] Timestamp tolerance + raw body + query order rules
- [x] Signing version column; legacy migration banner
- [x] No real credentials in examples; secret not stored in browser

## 11–12. Tests

- [x] Unit: canonicalization, timestamp, signature, fixed vector
- [x] Integration: happy paths, missing/invalid, tampering, side effects, legacy

## 13. Rollout

### Phase 1 — Nền tảng ✅

- [x] Code + migration + signed credential create
- [x] Legacy still works (`allow`)
- [x] Metrics `jwt` / `signed_v1` / `legacy` + legacy usage warning logs
- [x] Local verification complete

### Phase 2 — Chuyển client ⏳

- [x] UI + client examples shipped in codebase
- [ ] Deploy FE/BE to staging/prod
- [ ] Sellers create signed credentials; monitor legacy metric
- [ ] Communicate legacy sunset deadline

### Phase 3 — Bắt buộc signing ⏳

```env
LEGACY_SELLER_API_KEY_MODE=deny
```

- [ ] Staging → suite → monitor → production; rollback to `allow` ready

### Phase 4 — Cleanup ⏳

- [ ] Drop legacy path, CORS header, columns, metrics after retention

## 14. Reviewer acceptance gates

- [x] Public key ≠ HMAC secret; secret not in request; encrypted at rest
- [x] Method, path+query, timestamp, raw body hash signed with HMAC-SHA256 + `compare_digest`
- [x] Revoked / inactive / non-seller rejected; no fallback after bad signature
- [x] Sentry scrub tests; JWT regression; tampering + fixed vector
- [x] Migration + rollback; legacy rollout period; no false anti-replay claims

## 15. Definition of Done

| Criterion | Status |
|-----------|--------|
| Migration on current DB | ✅ local/dev + test |
| Unit + seller integration tests | ✅ |
| Security hardening / observability scrub | ✅ |
| Frontend tsc + i18n + build | ✅ |
| Local UI + API smoke | ✅ |
| Staging soak | ⏳ |
| Production deploy + rollback verified | ⏳ |
| Legacy usage → 0 or exception | ⏳ |
| Reviewer security sign-off | ⏳ |

## Files touched (Phase 1)

**Backend**

- `marketplace-svc/src/auth/request_signing.py` (new)
- `marketplace-svc/src/auth/dependencies.py`
- `marketplace-svc/src/models/seller_api_key.py`
- `marketplace-svc/src/seller_api_keys/{service,schemas,router}.py`
- `marketplace-svc/src/config.py`, `main.py`, `rate_limit.py` (existing helper)
- `marketplace-svc/src/observability/{metrics,sentry}.py`
- `marketplace-svc/alembic/versions/cl1a2b3c4d5e6_signed_api_credentials.py`
- `marketplace-svc/tests/test_request_signing.py` (new)
- `marketplace-svc/tests/test_seller_api_keys.py`, `test_observability.py`
- `marketplace-svc/.env.example`

**Frontend**

- `frontend/app/[locale]/seller/(dashboard)/api-settings/page.tsx`
- `frontend/lib/types.ts`
- `frontend/messages/{en,vi}.json`
