# Security Audit Report — market_site Marketplace

> **Classification:** Confidential — Internal Use Only  
> **Date:** 2026-08-07  
> **Branch:** check-security  
> **Stack:** FastAPI 0.115 · Next.js · PostgreSQL · Redis · Docker  
> **Overall Risk:** 🔴 CRITICAL — Do not deploy in current state  
> **Auditor:** White-box static analysis (full source access)

---

## 01 Executive Summary

**Do not deploy in current state.** Four critical vulnerabilities exist: live secrets committed to the git repository, a working admin credential seeded into the production database, a business-logic flaw that lets any authenticated buyer mint unlimited wallet balance, and a race condition that enables double-spending.

| Severity | Count |
|----------|-------|
| Critical | 4     |
| High     | 5     |
| Medium   | 9     |
| Low/Info | 6     |
| **Total**| **24**|

The codebase demonstrates clear evidence of deliberate threat modelling: SSRF protection with DNS-pinning, fail-closed webhook verification, Fetch-Metadata CSRF defence, startup-time configuration validation, and near-complete auth-dependency coverage across ~20 routers. The critical risk is concentrated in **secret hygiene** and **financial logic**.

### Positive Security Controls

- ✅ Startup config validation rejects known-insecure secrets, enforces ≥32-byte entropy on three independent secrets
- ✅ SSRF guard with DNS-pinning re-validates on every outbound call; closes DNS-rebinding TOCTOU; `trust_env=False` blocks proxy bypass
- ✅ PayOS webhook: `compare_digest`, explicit empty-key refusal, negative-amount rejection, `paymentLinkId` cross-check, idempotency via unique constraint, `FOR UPDATE` locking
- ✅ Provider webhook fails closed — no configured secret means every callback is rejected
- ✅ httpOnly + `sameSite: strict` + `secure` cookie; no token in `localStorage`; CSRF via Fetch-Metadata with Origin fallback
- ✅ Auth-dependency coverage complete across all protected routers
- ✅ Gateway path traversal blocked: `^[A-Za-z0-9_-]{1,64}$` + explicit endpoint allowlist
- ✅ Security event telemetry with keyed HMAC principal fingerprints
- ✅ Auth rate limiting bucketed by both IP and hashed email; `fail_open=False`
- ✅ Sentry scrubbing: `send_default_pii=False`, drops body/query/cookies, redacts gateway keys from URL paths
- ✅ Provider credentials encrypted at rest with Fernet; selective field encryption; idempotent re-encryption
- ✅ All SQL parameterized — no string-concatenated queries found
- ✅ Metrics cardinality guard collapses unmatched routes to prevent scanner-driven memory exhaustion

---

## 02 System Architecture Review

```
Internet
   |
   |--- :3001 --► frontend (Next.js)
   |                  |  /api/[...path] proxy -> marketplace-svc:8001
   |
   └--- :8001 --► marketplace-svc (FastAPI)   <- direct host exposure, no TLS proxy
                     |
              [market_site bridge network]
                     |
           +---------+-----------+
           |                     |
        postgres:5432         redis:6379
        (port not published    (no auth,
         in prod compose)       port not published)

Cloudflare Tunnel — token committed to git (commented out, but in history)
Private registry: registry.k7:5000 (plaintext HTTP, no digest pinning)
```

**Attack surface:** Direct exposure of FastAPI on port 8001 bypasses any WAF/TLS layer. Combined with `DEPLOYMENT_ENVIRONMENT` defaulting to `development` (H-1), HSTS and production guardrails are inactive. Redis has no authentication — any process on the Docker network can flush rate-limit counters.

---

## 03 Frontend Audit Report

| ID  | Title | Severity | File |
|-----|-------|----------|------|
| M-6 | API proxy forwards arbitrary client headers upstream | Medium | `frontend/app/api/[...path]/route.ts:71` |
| L-1 | CSP permits `unsafe-inline` scripts and styles | Low | `frontend/next.config.mjs:26` |
| L-2 | Markdown URL safety depends on library internals | Low | `frontend/components/MarkdownContent.tsx:51` |

**M-6:** Only `host`, `cookie`, `content-length`, `connection`, `authorization` are stripped. Headers including `x-internal-key`, `x-seller-api-key`, `x-forwarded-*` pass through — making the public Next.js proxy a relay to every backend route including `/internal/*` and `/webhooks/payos`. Fix: switch to an allowlist of forwarded headers.

**Positive:** `npm audit` = 0 vulnerabilities. Session cookies are httpOnly, sameSite strict, and secure. Frontend Dockerfile runs as non-root `app` user.

---

## 04 Backend API Audit Report

| ID  | Title | Severity | CVSS | File |
|-----|-------|----------|------|------|
| C-3 | Negative `quantity` mints unlimited wallet balance | Critical | 9.3 | `src/orders/schemas.py:8` |
| M-2 | Oversized login password triggers unhandled 500 | Medium | 5.3 | `src/auth/schemas.py:31` |
| M-9 | Latent SSRF sink in provider health probe | Medium | 4.0/7.5 | `src/scheduler.py:281` |
| L-6 | PayOS webhook endpoint has no rate limit | Low | 3.1 | `src/payments/router.py:42` |

**C-3 detail:**
```python
# src/orders/schemas.py:8
quantity: int = 1          # no ge=1 constraint

# src/orders/service.py:56
total = variant.price * quantity   # quantity=-100 → total negative

# src/wallet/service.py:93-95
if wallet.available_balance < amount:  # 0 < -500000 is False → passes
    raise InsufficientCredit()
wallet.available_balance -= amount     # -= -500000  →  +500000
```
Fix: `quantity: int = Field(1, ge=1, le=100)` + `if amount <= 0: raise` in all wallet mutators.

**M-9:** `scheduler.py:281` GETs `provider.config["health_endpoint"]` with no SSRF guard. Currently not exploitable (job unscheduled). One `scheduler.add_job` line from live (latent CVSS 7.5). Fix: apply SSRF guard before re-enabling.

---

## 05 Authentication & Authorization Audit

| ID  | Title | Severity | CVSS | File |
|-----|-------|----------|------|------|
| C-1 | Working admin account seeded into production database | Critical | 9.8 | `docker-compose.yml:18` |
| C-2 | Live production secrets committed to git history | Critical | 9.1 | `docker-compose.yml:11,39,41,42` |
| H-3 | No token revocation — stolen token refreshes indefinitely | High | 7.1 | `src/auth/router.py:80` |
| M-8 | Seller API keys never expire and carry no scopes | Medium | 4.8 | `src/seller_api_keys/service.py:11` |
| L-3 | JWT decode missing required-claims and iss/aud validation | Low | 3.1 | `src/auth/service.py:32` |

**C-1 detail:**
```yaml
# docker-compose.yml:18
- ./db/marketplace-seed.sql:/docker-entrypoint-initdb.d/02-seed.sql
```
```sql
-- db/marketplace-seed.sql:1006
-- admin@dxtrade.example.com  {buyer,admin,seller}  Password: DemoPass123!
-- Verified: bcrypt.checkpw(b'DemoPass123!', hash) == True
```
Runs on every fresh volume. Full admin access to any repo reader. Account ID 1 is also the platform fee wallet.

**C-2 detail:**
```
POSTGRES_PASSWORD: 3ivYYwOP27U2vF9Z              (docker-compose.yml:11)
JWT_SECRET: 567fbb317c8d429...                   (:41) — allows token forgery
INTERNAL_API_KEY: 7w8EAM76idmctHxtg1820VIzk7N85nDU (:42)
TUNNEL_TOKEN: eyJhIjoiM2I3ZDFh...               (:73, commented but in history)
```
`.gitignore:2` lists `docker-compose.yml` but file is already tracked — has no effect. All four values in git history.

**H-3:** No refresh-token model. `/auth/refresh` accepts valid access token, mints new 60-minute one, unlimited times. No `jti`, no denylist, no server-side logout. Access TTL 60 min (security.md mandates 15). Partial mitigation: `get_current_account` re-reads `is_active` from DB every request.

---

## 06 Database Security Review

| ID  | Title | Severity | CVSS | File |
|-----|-------|----------|------|------|
| C-4 | Wallet race condition — double-spend / over-withdraw | Critical | 8.6 | `src/wallet/service.py:91` |
| M-1 | No DB-level CHECK constraints on money columns | Medium | 5.9 | `src/models/wallet.py:78` |
| M-7 | Pending-deposit count check is not atomic | Medium | 4.3 | `src/payments/service.py:42` |
| L-4 | `marketplace_test` DB created on production Postgres | Low | 2.5 | `init-db.sql:1` |

**C-4 detail:**
```python
# src/wallet/service.py:91-101
wallet = await get_wallet_by_account(account_id, db)  # plain SELECT, no FOR UPDATE
if wallet.available_balance < amount:
    raise InsufficientCredit()
wallet.available_balance -= amount  # lost update under concurrency
```
No wallet row is locked anywhere in the codebase. N concurrent orders all pass balance check, all deduct from same stale value — balance goes negative.

Fix: `.with_for_update()` in `deduct_credit` and `request_withdraw`. Or atomic: `UPDATE wallets SET available_balance = available_balance - :amt WHERE account_id = :id AND available_balance >= :amt RETURNING id`.

**Positive:** All SQL parameterized. SQLAlchemy 2.0 async patterns consistent. `expire_on_commit=False` correctly set.

---

## 07 Infrastructure Security Review

| ID  | Title | Severity | CVSS | File |
|-----|-------|----------|------|------|
| H-1 | Production runs in development mode — guardrails disabled | High | 7.5 | `docker-compose.yml:38` |
| H-2 | Backend container runs as root with curl/vim installed | High | 7.3 | `marketplace-svc/Dockerfile:18` |
| H-4 | Jenkins deploys as root via SSH, no host-key verification | High | 7.0 | `Jenkinsfile:19` |
| H-5 | No image pinning; mutable tags; unbounded Python deps | High | 6.8 | `docker-compose.yml:8,27,34` |
| M-3 | Redis has no authentication | Medium | 5.5 | `docker-compose.yml:26` |
| M-4 | Dev compose publishes databases on all interfaces | Medium | 5.8 | `docker-compose.dev.yml:13` |
| M-5 | FastAPI port published directly to host, no TLS proxy | Medium | 5.3 | `docker-compose.yml:36` |

**H-1:** `DEPLOYMENT_ENVIRONMENT` absent from production compose → defaults to `"development"`. Disables: HSTS, HTTPS-only CORS validation, demo-topup ban, API-docs ban, debug-routes ban. `ENCRYPTION_KEY` also absent.

**H-4:**
```groovy
ssh -tt root@172.16.89.2 << 'SSHEOF'
  cd /srv/market_site && git pull && docker-compose up -d --force-recreate
SSHEOF
```
Direct root SSH, no StrictHostKeyChecking (MITM → prod RCE), no test stage, no image scanning, heredoc exit status not propagated.

---

## 08 Vulnerability Register

| ID  | Title | Severity | OWASP | CVSS | File |
|-----|-------|----------|-------|------|------|
| C-1 | Working admin account seeded into production database | Critical | A07 | 9.8 | `docker-compose.yml:18` |
| C-2 | Live production secrets committed to git history | Critical | A02 | 9.1 | `docker-compose.yml:11,39,41,42` |
| C-3 | Negative `quantity` mints unlimited wallet balance | Critical | A04 | 9.3 | `src/orders/schemas.py:8` |
| C-4 | Wallet race condition — double-spend / over-withdraw | Critical | A04 | 8.6 | `src/wallet/service.py:91` |
| H-1 | Production runs in development mode — guardrails disabled | High | A05 | 7.5 | `docker-compose.yml:38` |
| H-2 | Backend container runs as root with curl/vim installed | High | A05 | 7.3 | `marketplace-svc/Dockerfile:18` |
| H-3 | No token revocation — stolen token refreshes indefinitely | High | A07 | 7.1 | `src/auth/router.py:80` |
| H-4 | Jenkins deploys as root via SSH, no host-key verification | High | A08 | 7.0 | `Jenkinsfile:19` |
| H-5 | No image pinning; mutable tags; unbounded Python deps | High | A08 | 6.8 | `docker-compose.yml:8,27,34` |
| M-1 | No DB-level CHECK constraints on money columns | Medium | A04 | 5.9 | `src/models/wallet.py:78` |
| M-2 | Oversized login password triggers unhandled 500 | Medium | A04 | 5.3 | `src/auth/schemas.py:31` |
| M-3 | Redis has no authentication | Medium | A05 | 5.5 | `docker-compose.yml:26` |
| M-4 | Dev compose publishes databases on all interfaces | Medium | A05 | 5.8 | `docker-compose.dev.yml:13` |
| M-5 | FastAPI port published directly to host, no TLS proxy | Medium | A05 | 5.3 | `docker-compose.yml:36` |
| M-6 | Next.js proxy forwards arbitrary headers upstream | Medium | A05 | 5.0 | `frontend/app/api/[...path]/route.ts:71` |
| M-7 | Pending-deposit count check is not atomic | Medium | A04 | 4.3 | `src/payments/service.py:42` |
| M-8 | Seller API keys never expire and carry no scopes | Medium | A07 | 4.8 | `src/seller_api_keys/service.py:11` |
| M-9 | Latent SSRF sink in provider health probe | Medium | A10 | 4.0/7.5 | `src/scheduler.py:281` |
| L-1 | CSP permits `unsafe-inline` scripts and styles | Low | A05 | 3.7 | `frontend/next.config.mjs:26` |
| L-2 | Markdown URL safety depends on library internals | Low | A03 | 3.5 | `frontend/components/MarkdownContent.tsx:51` |
| L-3 | JWT decode missing required-claims and iss/aud validation | Low | A02 | 3.1 | `src/auth/service.py:32` |
| L-4 | `marketplace_test` DB created on production Postgres | Low | A05 | 2.5 | `init-db.sql:1` |
| L-5 | `pyproject.toml` listed in .gitignore but is tracked | Info | — | — | `.gitignore:8` |
| L-6 | PayOS webhook endpoint has no rate limit | Low | A04 | 3.1 | `src/payments/router.py:42` |

---

## 09 Risk Matrix

```
Likelihood \ Impact | Negligible | Minor    | Moderate   | Major          | Catastrophic
---------------------|------------|----------|------------|----------------|-------------
Very High            |            |          |            | C-1, C-2       |
High                 |            |          | H-1        | C-3            |
Medium               |            | M-2      | H-5, M-6   | C-4, H-2, H-3  |
Low                  |            | L-1, L-2 | M-7, M-8   | H-4, M-9       |
Very Low             |            | L-3, L-4 |            |                |
```

---

## 10 Remediation Roadmap

### Phase 1 — Block Deploy (0–24 hours)

1. **Rotate all committed secrets** (C-2) — JWT_SECRET, INTERNAL_API_KEY, POSTGRES_PASSWORD, Cloudflare tunnel token. Treat all as compromised. Purge git history with `git filter-repo`. Move to CI secret manager or Docker secrets.
2. **Remove seed mount from production compose** (C-1). Run `python -m src.ops.purge_demo`. Add startup assertion rejecting `*@dxtrade.example.com` accounts in production.
3. **Fix order quantity validation** (C-3) — `quantity: int = Field(1, ge=1, le=100)`. Add `if amount <= 0: raise` in `deduct_credit`, `release_escrow`, `refund_escrow`, `credit_affiliate_commission`.
4. **Fix wallet race condition** (C-4) — `.with_for_update()` in `deduct_credit` and `request_withdraw`. DB `CHECK (available_balance >= 0)` via Alembic.
5. **Set `DEPLOYMENT_ENVIRONMENT=production`** (H-1) in production compose. Supply `ENCRYPTION_KEY`.

### Phase 2 — Infrastructure Hardening (Within 1 week)

6. **Non-root backend container** (H-2) — `useradd -m app && USER app`. Remove `curl`, `nano`, `vim`. Separate migration step from app CMD.
7. **Token revocation** (H-3) — `RefreshToken` model with rotation + reuse detection. `jti` claim + Redis denylist. `DELETE /auth/logout`. Reduce `JWT_EXPIRE_MINUTES` default to 15.
8. **Harden Jenkins** (H-4) — non-root deploy user, SSH host-key pinning, blocking stages: `pytest -x`, `pip-audit`, `npm audit --audit-level=high`, `trivy image --exit-code 1 --severity CRITICAL,HIGH`.
9. **Pin images and dependencies** (H-5) — all `FROM` and `image:` by `sha256` digest. `uv sync --frozen` in backend Dockerfile. `gitleaks detect` in CI.
10. **Redis auth + dev port binding** (M-3, M-4) — `requirepass` on Redis. Bind dev compose to `127.0.0.1`.
11. **Reverse proxy for backend** (M-5) — Nginx + TLS termination. Remove direct port binding.

### Phase 3 — Code Improvements (Current sprint)

12. **Next.js header allowlist** (M-6) — forward only `content-type`, `accept`, `accept-language`, `accept-encoding`.
13. **Login password size guard** (M-2) — 72-byte validator on `LoginRequest`. Generic `Exception` handler in `src/errors/handlers.py`.
14. **Seller API key expiry/scopes** (M-8) — `expires_at` default 90 days, scopes column.
15. **SSRF guard on health endpoint** (M-9) — apply guard before re-enabling `health_check_job`.
16. **JWT required-claims** (L-3) — `options={"require": ["exp", "sub"]}` in `jwt.decode`.
17. **Nonce-based CSP** (L-1) + **markdown URL sanitizer** (L-2).
18. **Cleanup** (L-4, L-5) — remove test DB from init script. Fix `.gitignore` for tracked file.

---

## 11 Retest Checklist

| ID  | Verification Method | Pass Criteria | Done |
|-----|---------------------|---------------|------|
| C-1 | `SELECT email FROM accounts WHERE email LIKE '%@dxtrade.example.com';` Login with `admin@dxtrade.example.com / DemoPass123!`. | Zero rows. Login returns 401. | ☐ |
| C-2 | `git log --all -S "3ivYYwOP27U2vF9Z" --oneline`. `gitleaks detect` in CI. | Zero commits match. gitleaks passes. | ☐ |
| C-3 | `POST /api/v1/orders {"quantity": -100}` with valid buyer token. Check wallet. | Returns 422. Wallet unchanged. | ☐ |
| C-4 | Fund wallet 1 unit. 10 concurrent orders each requiring 1 unit. Check balance. | 1 order succeeds. Balance = 0. No negative. | ☐ |
| H-1 | `docker inspect marketplace-svc` for DEPLOYMENT env. `GET /docs`. | `production` env set. `/docs` returns 404. | ☐ |
| H-2 | `docker exec marketplace-svc id`. `docker exec marketplace-svc which curl`. | Non-root UID. curl not found. | ☐ |
| H-3 | Login → `DELETE /auth/logout` → use original token on `GET /auth/me`. | Post-logout returns 401. Refresh also 401. | ☐ |
| H-4 | Review Jenkinsfile. Check Jenkins logs for audit stages. | Non-root deploy. Host key pinned. Blocking stages present. | ☐ |
| H-5 | Check all `FROM` and `image:` entries in Dockerfiles and compose files. | Every reference includes `@sha256:` digest. | ☐ |
| M-1 | `SELECT conname, consrc FROM pg_constraint WHERE conrelid = 'wallets'::regclass;` | `available_balance >= 0` constraint present. | ☐ |
| M-2 | `POST /auth/login` with valid email + 200-character password. | Returns 422, not 500. | ☐ |
| M-3 | `redis-cli -h <host> ping` without auth. | `NOAUTH Authentication required`. | ☐ |
| M-4 | `grep -E "5432:|6379:" docker-compose.dev.yml` | All bindings start with `127.0.0.1:`. | ☐ |
| M-5 | `curl -v http://<host>:8001/health` from outside Docker network. | Connection refused. | ☐ |
| M-6 | Proxied request with `x-internal-key: anything`. Check backend receives it. | Backend receives no `x-internal-key`. | ☐ |
| M-7 | 10 concurrent deposit requests when account has 3 pending. | All beyond limit rejected. DB count stays at limit. | ☐ |
| M-8 | Code review: `seller_api_keys` model for `expires_at` column. | Column present. Expired keys rejected at auth. | ☐ |
| M-9 | Code review: `scheduler.py:281` uses SSRF-guarded transport. | Guard applied before job re-enabled. | ☐ |
| L-1 | Check `Content-Security-Policy` header in production response. | No `unsafe-inline`. Nonce-based CSP. | ☐ |
| L-2 | Code review: `MarkdownContent.tsx` has `overrides.a` with href validation. | Rejects `javascript:` and `data:` schemes. | ☐ |
| L-3 | Send JWT with no `sub` claim to protected endpoint. | Returns 401, not 500. | ☐ |
| L-4 | `docker exec postgres psql -U marketplace -lqt` on fresh volume. | `marketplace_test` does not exist. | ☐ |
| L-6 | 200 rapid requests to `POST /webhooks/payos` with invalid signatures. | Rate-limited after threshold. | ☐ |

> **Sign-off:** All Phase 1 items must pass before any production deployment. Retain completed checklist with dates and tester initials for audit trail.

---

*Companion HTML artifact: https://claude.ai/code/artifact/78ee1f3d-2488-4e49-9a6d-da90ff3a26d6*
