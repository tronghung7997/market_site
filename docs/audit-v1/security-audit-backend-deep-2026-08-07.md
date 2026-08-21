# Backend Deep Security Audit — marketplace-svc

> **Classification:** Confidential — Internal Use Only
> **Date:** 2026-08-07
> **Scope:** 141 HTTP routes · 24 modules · 20 ORM models · 4 security modules · 9 adapters · 10 scheduled jobs
> **Overall Risk:** 🔴 CRITICAL
> **Basis:** White-box full source analysis (follows initial audit `security-audit-whitebox-2026-08-07.md`)

---

## Summary

| Severity | New findings |
|----------|-------------|
| Critical | 3 (BE-C-1, BE-C-2, BE-C-3) |
| High | 7 (BE-H-1 … BE-H-7) |
| Medium | 12 (BE-M-1 … BE-M-12) |
| Low/Info | 10 (BE-L-1 … BE-L-10) |
| **Total** | **32** |

Three new money-affecting flaws beyond the four already known, plus a role-revocation bypass that makes seller demotion ineffective.

### Status re-validation — 2026-08-18

Re-checked against `main` HEAD `0558bcc796c26914467937f34c94f2835fc54fa4` plus the 2026-08-18 remediation working tree:

- **BE-C-1, BE-C-2, BE-C-3 are DONE LOCAL.** Units/price guards, DB CHECK constraints, order transition locks and unique ledger references are implemented; negative and concurrent-confirm regressions pass. Production deploy/retest remains open.
- **BE-H-1 is DONE LOCAL.** Both credential paths re-check seller role and expiry; signed credentials have endpoint scopes, a 90-day TTL and a five-active-key cap. Expired/out-of-scope/cap/demotion tests pass.
- **BE-H-2, BE-H-5 and BE-H-6 are DONE LOCAL.** Seller lifecycle schema excludes status, withdrawal rows are locked with a concurrency regression, and affiliate ranges reject reversed/over-366-day input.
- **BE-H-3 and BE-H-7 remain PARTIAL.** Self-dealing/rate bounds and the financial constraint set are in; negative affiliate fund, clawback/collusion controls, full schema sweep and body-size caps remain.
- Remediation status is tracked canonically in `security-audit-remediation-checklist.md`; this report preserves the original finding IDs and evidence.

---

## Critical Findings

### BE-C-1 — Negative `units` on usage charge grants unlimited free gateway quota
- **Endpoint:** `POST /orders/{order_id}/usage` (buyer) · `POST /internal/usage/charge`
- **CVSS:** ~8.6 · **OWASP:** A04/A01
- **Evidence:**
  ```python
  # src/usage/schemas.py:8
  class ChargeUsageRequest(BaseModel):
      units: int = 1          # no ge=1

  # src/usage/service.py:87-95
  if balance.units_used + units > balance.units_total:   # -1_000_000 passes
      raise QuotaExceeded()
  balance.units_used += units                            # goes negative
  ```
- **Impact:** Buyer sets `units=-100000000` → `units_remaining` becomes effectively unlimited → hammers `/gw/{key}/<endpoint>` for free. Every forwarded call is a real, billed request against the seller's backend. `refund_usage` correctly clamps at 0 — only the charge path is missing the guard.
- **Remediation:** `units: int = Field(1, ge=1, le=<max>)` on both request models. Add `if units < 1: raise HTTPException(422)` at top of `charge_usage()`.

---

### BE-C-2 — Seller-settable negative variant price mints wallet balance
- **Endpoints:** `POST /seller/products/{id}/variants` → `POST /orders`
- **CVSS:** ~9.1 · **OWASP:** A04/A08
- **Evidence:**
  ```python
  # src/products/schemas.py:61-66
  class VariantCreate(BaseModel):
      price: int          # no ge=0

  # src/orders/service.py:56
  total = variant.price * quantity   # price=-50_000_000 → total negative

  # src/wallet/service.py:91-95
  if wallet.available_balance < amount:  # 0 < -50_000_000 is False → passes
      raise InsufficientCredit()
  wallet.available_balance -= amount     # credit instead of debit
  ```
- **Impact:** Seller creates variant `price=-50_000_000`, buys it with a second account → that account gets +50M VND immediately, withdrawable as real bank transfer. This is a **separate, independently exploitable path** from the known negative-`quantity` finding — the quantity fix does not close this.
- **Remediation:** `price: int = Field(ge=0)` on `VariantCreate`/`VariantUpdate`. `CheckConstraint("price >= 0")` on `product_variants`. DB `CheckConstraint` on all balance/amount columns (backstop for all C-class wallet findings).

---

### BE-C-3 — `confirm_order` has no row lock → duplicate release/ledger risk
- **Endpoint:** `POST /orders/{order_id}/confirm`
- **CVSS:** ~8.1 · **OWASP:** A04
- **Evidence:**
  ```python
  # src/orders/service.py:441-460
  order = await db.get(Order, order_id)          # no with_for_update=True
  if order.status != OrderStatus.delivered: ...
  order.status = OrderStatus.completed
  await release_escrow(order.id, order.seller_id, order.total_amount, platform_fee, db=db)
  await apply_affiliate_commission(order, db)
  await db.commit()
  ```
  `provision_pending_order` at line 384 does use `with_for_update` — the pattern exists but was not applied here.
- **Impact:** Two simultaneous `POST /orders/{id}/confirm` can both observe `delivered` and enter `release_escrow`. Depending on interleaving this produces a lost update or a duplicate credit/ledger side effect; a non-negative final balance does not prove only one release occurred. Same transition race exists in dispute and withdrawal approval paths.
- **Remediation:** Lock the order/state row before checking the transition, then make release idempotent with a unique ledger key such as `(reference_id, type)`. Apply the same pattern to dispute/withdrawal transitions and add multi-connection concurrency tests. A balance `CHECK` is only a scalar-invariant backstop and does not close this race.

---

## High Priority

### BE-H-1 — DONE LOCAL: role, expiry, scope and active-key cap
- **Endpoints affected:** `GET /seller/orders`, `POST /seller/orders/{id}/accept`, `POST /seller/orders/{id}/deliver`, `POST /seller/variants/{id}/resources`
- **CVSS:** ~7.1 · **OWASP:** A01
- **Original evidence:**
  ```python
  # Original audit snapshot: API-key path lacked this equivalent JWT-path check.
  if "seller" not in account.roles:
      raise HTTPException(403, detail="Yêu cầu quyền seller")
  ```
- **Current evidence (2026-08-18):** `_resolve_account_by_api_key` and signed verification reject expired/demoted credentials. `SellerApiKey` has `expires_at` and scopes; creation is capped under an account row lock. UI lists scope/expiry.
- **Residual impact:** Production migration/retest and a bulk revoke-all incident action remain operational follow-ups.
- **Verification:** expired key 401; out-of-scope write 403; sixth active key 409; demoted seller signed request 403.

---

### BE-H-2 — Seller can silently undo an admin product suspension
- **Endpoint:** `PATCH /seller/products/{product_id}`
- **CVSS:** ~6.5 · **OWASP:** A01
- **Evidence:**
  ```python
  # src/products/service.py:69-71
  for key, value in data.items():
      if value is not None:
          setattr(product, key, value)   # includes `status`
  ```
  `ProductUpdate.status: str | None` — no restriction. Admin sets `suspended`; seller sets it back to `active` with one PATCH.
- **Remediation:** Remove `status` from `ProductUpdate`. Expose explicit `POST /seller/products/{id}/publish|pause` endpoints that refuse to leave `suspended` state.

---

### BE-H-3 — Affiliate commission farming: self-dealing loop with no fraud controls
- **Endpoints:** `POST /auth/register` (referral_code) → `POST /orders` → `POST /orders/{id}/confirm`
- **CVSS:** ~7.5 · **OWASP:** A04
- **Evidence:**
  ```python
  # src/affiliate/service.py:71-132
  # Only guards: direct self-referral + per-order dedupe
  # No: affiliate≠seller check, per-affiliate cap, minimum order age, clawback on refund
  # Documented to always pay even when fund goes negative
  ```
  `commission_rate: float | None` in `ProductOperationsUpdate` — no `ge/le` bounds.
- **Impact:** Attacker controls accounts A (affiliate), B (buyer with A's referral), S (seller). B buys S's own product → platform pays A from the global fund. Loop is self-financing with BE-C-2 (free balance). `apply_affiliate_commission` also fires from `reject_dispute` and `partial_refund_dispute`.
- **Remediation:** Reject commission when `order.seller_id == buyer.referred_by_id`. Block when affiliate/buyer share registration IP. Hard-fail when fund balance would go negative. Clamp `commission_rate` to `0 <= x <= 50`. Add clawback on `refund_dispute` and `OrderStatus.refunded`.

---

### BE-H-4 — Access tokens are self-renewing forever with no revocation
- **Endpoint:** `POST /auth/refresh`
- **CVSS:** ~6.8 · **OWASP:** A07
- **Evidence:**
  ```python
  # src/auth/router.py:80-87
  async def refresh(request, account=Depends(get_current_account)):
      token = service.create_access_token(account.id, account.roles)
  # No jti, no iat, no token family, no logout endpoint in all 141 routes
  ```
- **Impact:** Stolen token can be traded for a fresh one indefinitely. No per-session revocation, no "sign out all devices". Only kill switch is deactivating the whole account.
- **Mitigating:** Roles and `is_active` re-read from DB on every request — role revocation is immediate on JWT path (not API-key path, see BE-H-1).
- **Remediation:** Real refresh token (separate secret, rotation on use, stored/hashed, revocable). Add `jti` + Redis denylist. Add `POST /auth/logout`.

---

### BE-H-5 — Withdrawal request TOCTOU and no DB-level balance invariants
- **Endpoint:** `POST /wallet/withdraw`
- **CVSS:** ~7.1 · **OWASP:** A04
- **Evidence:**
  ```python
  # src/wallet/service.py:181-220
  wallet = await get_wallet_by_account(account_id, db)   # plain SELECT, no lock
  if wallet.available_balance < amount: raise InsufficientCredit()
  wallet.available_balance -= amount
  wallet.locked_balance += amount
  # Code comment at line 198 says lock was intended but was never applied
  ```
- **Impact:** Parallel requests drive `available_balance` negative. Admin approving multiple pending withdrawals pays out money that does not exist.
- **Remediation:** `SELECT ... FOR UPDATE` on wallet row. `Field(ge=1)` on `amount`. Rate limit on this endpoint.

---

### BE-H-6 — Unbounded date range on affiliate stats → memory-exhaustion DoS
- **Endpoints:** `GET /affiliate/me?date_from=...&date_to=...` (any authenticated user) · `GET /admin/affiliates/{id}`
- **CVSS:** ~6.5 · **OWASP:** A04
- **Evidence:**
  ```python
  # src/affiliate/service.py:487-503
  d = cur
  while d <= last:
      days.append({...})    # one dict per calendar day, unbounded
      d = d + timedelta(days=1)
  ```
  `_parse_range` validates ISO format but not span. `?date_from=0001-01-01&date_to=9999-12-31` → ~3.6M dicts.
- **Remediation:** Clamp span in `_parse_range` (max 366 days), return 422 beyond it.

---

### BE-H-7 — Systemic absence of input constraints on Pydantic schemas
- **CVSS:** ~7.0 (aggregate) · **OWASP:** A03/A04
- **Evidence:** Only **16 fields** across all `*/schemas.py` carry any `Field()` constraint. Notable unbounded inputs:
  ```
  src/orders/schemas.py:8       quantity: int = 1              # no ge=1
  src/orders/schemas.py:24      ManualDeliverRequest.data: str # unbounded, written to DB
  src/orders/schemas.py:10      user_config: dict | None       # arbitrary JSONB → adapters
  src/products/schemas.py:8-16  title/description → String(255) # overflow → 500
  src/products/schemas.py:63-67 sla_hours, sort_order, duration_days # unbounded ints
  src/disputes/schemas.py:7-9   reason: str, evidence: dict    # stored JSONB → admin page (XSS sink)
  src/reviews/schemas.py:8      comment: str | None            # unbounded → public product page
  src/resources/schemas.py:7    items: list[str]               # no max_length → millions of rows
  ```
  No request body-size middleware anywhere in the stack.
- **Remediation:** Add `Field(min_length/max_length)` mirroring every column width. `ge/le` on every numeric field. `max_length` on every list. Body-size limit at ASGI/reverse-proxy layer.

---

## Medium Priority

| ID | Title | CVSS | File |
|----|-------|------|------|
| BE-M-1 | Auth rate limiting collapses to single bucket behind reverse proxy | 6.5 | `src/auth/router.py:18-21` |
| BE-M-2 | Unauthenticated `/debug/version` leaks build, migration, DB exception detail | 5.8 | `src/debug/router.py:84` |
| BE-M-3 | Buyer can freeze seller funds indefinitely (dispute griefing) | 5.3 | `src/disputes/service.py:19-56` |
| BE-M-4 | Unvalidated pagination on admin resource listing → negative OFFSET → 500 | 5.0 | `src/resources/router.py:106` |
| BE-M-5 | Raw user strings compared against PG enums → 500s | 4.8 | multiple routers |
| BE-M-6 | Gateway keys travel in the URL path → nginx/proxy logs | 4.5 | `src/gateway/router.py:80` |
| BE-M-7 | Memory DoS on unauthenticated pricing calculator | 5.3 | `src/pricing/router.py:58` |
| BE-M-8 | Money stored in 32-bit Integer columns — max ~$85k, overflow at ~22 deposits | 5.5 | `src/models/wallet.py:78-82` |
| BE-M-9 | Category `commission_rate` exposed on public catalog | 4.0 | `src/categories/service.py:80` |
| BE-M-10 | Category tree accepts cycles → infinite recursion on public `GET /categories` | 5.3 | `src/categories/service.py:38-40` |
| BE-M-11 | Non-deterministic webhook idempotency key (Python hash salted per process) | 4.8 | `src/adapters/seller_task_webhook.py:96` |
| BE-M-12 | Hardcoded platform wallet `account_id=1` — 404 blocks order confirmation | 4.5 | `src/wallet/service.py:113` |

**BE-M-1 detail:** `request.client.host` behind nginx/Apache is the proxy IP for every request. `auth_login_ip_limit=20 / 5 min` becomes a platform-wide limit — trivial login DoS. Fix: `--proxy-headers --forwarded-allow-ips=<proxy CIDR>` in uvicorn, or `ProxyHeadersMiddleware` with trusted-proxy list.

**BE-M-8 detail:** `Wallet.available_balance`, `Transaction.amount`, `Order.total_amount`, `DepositIntent.amount` are `Integer` (PG `int4`, max 2,147,483,647 VND ≈ $85k). `deposit_max_amount = 100,000,000` → 22 max deposits overflow. Fix: migrate money columns to `BigInteger`.

**BE-M-10 detail:** `update_category` allows `parent_id` pointing to a descendant. `list_categories_tree` recurses without a visited set → `RecursionError` → 500 on public `GET /categories`. Fix: reject cycles in update; add visited-set guard in `build_tree`.

**BE-M-11 detail:**
```python
# src/adapters/seller_task_webhook.py:96
idempotency_key = f"order-{order_id}-task-{hash(target) & 0xFFFFFFFF}"
# Python hash() is salted per process — different key on restart → seller deduplication breaks
```
Fix: `hashlib.sha256(target.encode()).hexdigest()[:16]`

---

## Low / Informational

| ID | Title | File |
|----|-------|------|
| BE-L-1 | Dockerfile: no USER, curl/vim installed, alembic races on multi-replica start | `marketplace-svc/Dockerfile` |
| BE-L-2 | `except (ValueError, Exception)` swallows programming bugs in orders; wallet returns `[]` masking 403/500 | `src/orders/router.py:161`, `src/wallet/router.py:126-129` |
| BE-L-3 | `int(payload["sub"])` raises KeyError/ValueError → 500 instead of 401 | `src/auth/dependencies.py:25` |
| BE-L-4 | Public review listing returns `buyer_id` — enables buyer correlation across products | `src/reviews/router.py:23` |
| BE-L-5 | Seed failure returns `output[-600:]` subprocess stdout to client | `src/providers/router.py:164,225` |
| BE-L-6 | `POST /seller/providers/{id}/test` has no rate limit (SSRF-bounded, but free request gen) | `src/providers/router.py:327` |
| BE-L-7 | No email verification on register, no account lockout, no MFA for admin | `src/auth/` |
| BE-L-8 | Seller alerts use `get_current_account` not `require_role("seller")` | `src/alerts/router.py:23,28` |
| BE-L-9 | SSRF guard returns `None` (allow) when DNS fails at write-time — correct but needs test | `src/security/ssrf_guard.py:119-121` |
| BE-L-10 | `tasks/service.py` uses raw `product.escrow_days` instead of `tier_escrow_days()` | `src/tasks/service.py:161` |

---

## Positive Findings — Preserve These

1. **PayOS integration** — HMAC with `compare_digest`, empty-key refusal, idempotency via `UNIQUE + ON CONFLICT DO NOTHING`, `FOR UPDATE` on intent, **atomic** `UPDATE wallets SET balance = balance + X` (not read-modify-write), `paymentLinkId` cross-validation, bool/negative-amount rejection.
2. **`charge_usage` locking** (`src/usage/service.py:47-66`) — locked read, inline post-mortem explaining why a preceding unlocked read broke correctness, regression test named.
3. **SSRF defence** — https-only, port 443 only, userinfo/query rejected, private/loopback blocked, re-validated on every outbound call, DNS pinned in transport (closes rebinding TOCTOU), `trust_env=False`.
4. **Provider credential handling** — Fernet at rest, `MASKED_SECRET` sentinel fails closed, field-name-only audit logging, forced re-review after config edit.
5. **Gateway hardening** — strict endpoint regex, seller-declared `endpoint_map`, order-status gate, request/response size caps, dual rate limits, response-header whitelist, resolution through provider snapshot.
6. **Startup config validation** — rejects known-insecure defaults, short secrets, wildcard CORS, non-HTTPS prod origins, demo topup outside dev, disabled rate limiting in staging/prod.
7. **Security telemetry** — HMAC-keyed fingerprints, blocklist preventing passwords/tokens/emails from entering logs.
8. **Gateway call-history sanitizer** — recursive redaction by key pattern, depth/collection/string bounds, byte-bounded JSON preview.
9. **Correct locking** in `provision_pending_order`, `_sync_order_status`, `rotate_proxy`, `set_proxy_whitelist`, `deposit_expire_job` (`skip_locked`) — pattern exists and documented.
10. **Admin role check reads from DB** on every request, not JWT claim — role escalation via token tampering is impossible.
11. **Retention jobs** — batched, bounded, never touch money ledgers.
12. **Auth rate limiter fails closed** with bounded in-memory fallback when Redis is down.

---

## Complete Endpoint Inventory (141 routes)

Auth: `PUBLIC` = no auth · `JWT` = get_current_account · `SELLER`/`ADMIN` = require_role · `TIER` = require_min_seller_tier("trusted") · `JWT|KEY` = JWT or X-Seller-Api-Key · `INTERNAL` = X-Internal-Key

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/auth/register` | PUBLIC | rate-limited per IP |
| POST | `/auth/login` | PUBLIC | rate-limited per IP + email |
| POST | `/auth/refresh` | JWT | **BE-H-4** |
| GET | `/me` | JWT | |
| GET | `/health` | PUBLIC | |
| GET | `/internal/metrics` | INTERNAL | |
| GET | `/debug/version` | PUBLIC | **BE-M-2** (when DEBUG_ROUTES_ENABLED) |
| GET | `/openapi.json`, `/docs`, `/redoc` | PUBLIC | only when API_DOCS_ENABLED |
| GET | `/products` | PUBLIC | |
| GET | `/products/{id}` | PUBLIC | 404s non-active ✔ |
| GET | `/products/{id}/pricing-options` | PUBLIC | |
| POST | `/products/{id}/calculate` | PUBLIC | **BE-M-7** |
| GET | `/products/{id}/reviews` | PUBLIC | **BE-L-4** |
| GET | `/products/{id}/operations` | JWT | owner-or-admin, 404s others ✔ |
| GET | `/categories` | PUBLIC | **BE-M-9**, **BE-M-10** |
| GET | `/sellers/top`, `/sellers/{id}` | PUBLIC | |
| POST | `/affiliate/click` | PUBLIC | rate-limited; stores IP |
| POST | `/webhooks/payos` | PUBLIC | HMAC-verified ✔ |
| POST | `/webhooks/providers/{pid}/tasks/{tid}` | PUBLIC | per-provider HMAC, fails closed ✔ |
| GET,POST,PUT,DELETE | `/gw/{gateway_key}/{endpoint:path}` | gateway key | **BE-M-6**; well hardened otherwise ✔ |
| POST | `/orders` | JWT | **BE-C-2** (negative price), **C-3 known** (negative qty) |
| GET | `/orders`, `/orders/stats`, `/orders/{id}` | JWT | ownership ✔ |
| POST | `/orders/{id}/confirm` | JWT | **BE-C-3** (no row lock) |
| GET | `/orders/{id}/dashboard` | JWT | buyer-or-seller ✔ |
| GET | `/orders/{id}/resources` | JWT | buyer-or-seller ✔ |
| POST | `/orders/{id}/usage` | JWT | **BE-C-1** (negative units) |
| POST | `/orders/{id}/review` | JWT | ownership + completed ✔ |
| POST,GET | `/orders/{id}/dispute` | JWT | ownership ✔ |
| POST | `/orders/{id}/gateway-key/rotate` | JWT | ownership ✔, no rate limit |
| POST,GET,PUT | `/orders/{id}/proxy/*` | JWT | ownership + FOR UPDATE + cooldown ✔ |
| GET | `/orders/action-items` | JWT | |
| GET | `/wallet`, `/wallet/transactions` | JWT | |
| POST | `/wallet/demo-topup` | JWT | blocked in prod by config ✔ |
| POST,GET | `/wallet/deposits*` | JWT | ownership ✔, no rate limit |
| POST | `/wallet/withdraw` | SELLER | **BE-H-5** |
| GET | `/wallet/withdrawals` | SELLER | |
| GET,POST | `/seller/alerts*` | JWT | **BE-L-8** (ownership enforced in service) |
| POST,GET | `/seller/apply`, `/seller/applications/me` | JWT | |
| GET | `/seller/action-items`, `/seller/stats` | SELLER | |
| GET | `/seller/products`, `/seller/products/{id}/detail` | SELLER | ownership ✔ |
| POST,PATCH,DELETE | `/seller/products*`, `/seller/variants*` | SELLER | **BE-H-2** on PATCH status |
| PUT | `/seller/products/{id}/pricing` | SELLER | provider-ownership validated ✔ |
| POST | `/seller/variants/{id}/resources` (bulk) | JWT\|KEY | **BE-H-1**, **BE-H-7** (unbounded list) |
| GET,POST | `/seller/orders*`, `/seller/orders/{id}/accept`, `/seller/orders/{id}/deliver` | JWT\|KEY | **BE-H-1** (key bypasses role check) |
| GET,POST | `/seller/disputes*` | SELLER | ownership ✔ |
| POST,GET,PUT | `/seller/providers*` | TIER(trusted) | SSRF-guarded ✔ |
| POST | `/seller/api-keys` | TIER(trusted) | no per-account cap |
| DELETE | `/seller/api-keys/{id}` | SELLER | ownership ✔ |
| GET | `/seller/api-keys` | SELLER | |
| POST | `/seller/inventory/summary` | SELLER | |
| POST | `/internal/resources/acquire`, `/internal/resources/release` | INTERNAL | |
| POST | `/internal/usage/charge` | INTERNAL | **BE-C-1** |
| POST | `/internal/ops/purge-demo-accounts` | INTERNAL | one-shot + advisory lock ✔ |
| * | `/admin/**` (58 routes) | ADMIN | all correctly gated; issues in logic, not auth |
| POST | `/wallet/topup` | ADMIN | admin-gated ✔ |
| GET | `/providers*` | ADMIN | correctly gated ✔ |

**Admin endpoint verification:** All 58 `/admin/*` routes carry `Depends(require_role("admin"))`. `require_role` reads roles from the **database** on every request — JWT tampering cannot escalate privileges. No admin route reachable without the check. Residual risk is blast radius: `PATCH /admin/accounts/{id}/roles` can grant admin to anyone, `POST /wallet/topup` mints unlimited balance, `POST /admin/providers/*/seed` executes a subprocess, `POST /admin/withdrawals/{id}/approve` releases funds — all with no second approver, no MFA, no dual-control.

---

## Remediation Order

### Before next deploy
- **BE-C-1** — `Field(ge=1)` on `ChargeUsageRequest.units` + sign guard in `charge_usage()`
- **BE-C-2** — `Field(ge=0)` on `VariantCreate.price`
- **BE-C-3** — lock state transitions in `confirm_order`, dispute and withdrawal paths; add ledger idempotency/unique keys
- **BE-H-7** — DB `CheckConstraint` sweep for scalar sign/range invariants; do not use it as the fix for concurrency findings

### Within 24 hours
- **BE-H-1** — role check is present; add demotion regression now, track expiry/scope/cap in credential-lifecycle work
- **BE-H-2** — remove `status` from `ProductUpdate`
- **BE-H-5** — `with_for_update` on withdraw path
- **BE-H-6** — clamp affiliate date range to 366 days
- **BE-M-10** — cycle guard in `update_category` + visited-set in `build_tree`

### This sprint
- **BE-H-3** — affiliate fraud controls + clawback
- **BE-H-4** — real refresh tokens + logout + `jti` denylist
- **BE-H-7** — schema constraint sweep (mechanical pass across all `*/schemas.py`)
- **BE-M-1** — proxy-header configuration in uvicorn (config change, outsized impact)
- **BE-M-7** — body-size limit + pricing calculator caps
- **BE-M-8** — migrate money columns to `BigInteger`
- **BE-M-11** — deterministic idempotency key in `seller_task_webhook.py`

### Next iteration
- BE-M-2 through BE-M-6, BE-M-9, BE-M-12, all BE-L items
- BE-L-1 (Dockerfile USER + drop curl/vim + separate migrations) is cheap and worth bundling early

### Two structural recommendations
1. **Global request body-size limit** — nothing in the stack enforces one today
2. **Layered money integrity** — DB `CHECK` constraints enforce scalar sign/range invariants; row locks or atomic conditional updates protect concurrent balance transitions; unique idempotency keys prevent duplicate ledger/release/payout side effects. None of these layers substitutes for the others.

---

*Previous audit (high-level): [security-audit-whitebox-2026-08-07.md](./security-audit-whitebox-2026-08-07.md)*
*HTML artifact: https://claude.ai/code/artifact/78ee1f3d-2488-4e49-9a6d-da90ff3a26d6*
