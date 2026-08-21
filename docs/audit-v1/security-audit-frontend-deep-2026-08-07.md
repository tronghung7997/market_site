# Frontend Deep Security Audit — Next.js

> **Classification:** Confidential — Internal Use Only
> **Date:** 2026-08-07
> **Scope:** Next.js 16.3.0 (App Router) · 2 API routes · 41 pages · React 19.1.0 · TanStack Query 5
> **Overall Risk:** 🔴 CRITICAL
> **Basis:** White-box full source analysis

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 (FE-C-1, FE-C-2) |
| High | 2 (FE-H-1, FE-H-2) |
| Medium | 7 (FE-M-1 … FE-M-7) |
| Low | 8 (FE-L-1 … FE-L-8) |

The frontend application code itself is unusually well-written from a security standpoint — zero XSS sinks, `httpOnly` session cookie, real CSP, zero `NEXT_PUBLIC_*` secrets, clean `npm audit`. The critical risk comes from **secrets committed to git** and a **path-traversal bypass in the API proxy** that chains with the leaked `INTERNAL_API_KEY` to reach backend-internal endpoints from the public internet.

### Status re-validation — 2026-08-18

- **FE-C-1 remains OWNER EXCEPTION / OPS OPEN:** committed secret values and history are intentionally unchanged per owner direction; production fingerprint/reuse/rotation is not signed off.
- **FE-C-2 and FE-H-1 are DONE LOCAL:** normalized path containment, hostile segment rejection and request-header allowlisting are implemented. Five raw/encoded/backslash traversal probes returned 404 on the standalone production build.
- **FE-H-2 is PARTIAL:** compose binds backend to `127.0.0.1:8001`; production deploy and external-port probe remain open.
- **FE-M-3 is DONE LOCAL:** login/register validate `next` as a same-origin relative path. **FE-M-7 is PARTIAL:** frontend now uses `npm ci` and drops debug tools, but image digest pinning remains open.

Canonical status/evidence lives in `security-audit-remediation-checklist.md`; finding text below preserves the original audit snapshot.

---

## Critical Findings

### FE-C-1 — Live production secrets committed to git
**CVSS 9.8 (AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H)**

`docker-compose.yml` is tracked in git and contains live secrets:

```yaml
# docker-compose.yml:11
POSTGRES_PASSWORD: 3ivYYwOP27U2vF9Z
# :39-41
DATABASE_URL: postgresql+asyncpg://marketplace:3ivYYwOP27U2vF9Z@postgres:5432/marketplace
JWT_SECRET: 567fbb317c8d42956c452f353045c8baddeca9b4736040261c715f0e87a04a57
INTERNAL_API_KEY: 7w8EAM76idmctHxtg1820VIzk7N85nDU
# :72 (commented but in history)
TUNNEL_TOKEN=eyJhIjoiM2I3ZDFhZDFhYWJlMzliZGJiYmU3YzgzMjJjZTI1ZjUi...
```

`JWT_SECRET` is the HS256 signing key (`marketplace-svc/src/config.py:30`). Anyone with repo access can forge a JWT with `roles: ["admin"]` set it as `dx_session` cookie → become platform admin. Grants: `POST /admin/withdrawals/{id}/approve`, `POST /wallet/topup` (mint arbitrary balance), `PATCH /admin/accounts/{id}/roles`.

**Remediation:** Rotate all four values immediately (JWT rotation invalidates all sessions). Purge from history (`git filter-repo`), then `git rm --cached docker-compose.yml`. Move secrets to Docker secrets or secret manager. Add `gitleaks` to Jenkinsfile as blocking stage.

---

### FE-C-2 — API proxy `internal/` blocklist bypassable via path traversal
**CVSS 9.1 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:L)**

`frontend/app/api/[...path]/route.ts:59-69`:

```ts
const path = segments.join("/");
if (path === "internal" || path.startsWith("internal/")) {
  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}
const target = new URL(`${API_TARGET}/${path}`);
```

Blocklist validates raw joined string, but `new URL()` performs dot-segment normalization. None of these strings satisfy the guard, yet all resolve to `/internal/*` after normalization:

```
"../internal/foo"
"a/../../internal/z"
"./../internal/x"
```

**Proof of concept:**
```bash
curl --path-as-is "/api/a/../../internal/metrics"
curl "/api/%2e%2e/internal/metrics" -H "X-Internal-Key: 7w8EAM76idmctHxtg1820VIzk7N85nDU"
```

**Reachable internal endpoints:**

| Endpoint | Impact |
|----------|--------|
| `POST /internal/usage/charge` | Charge any buyer's quota to zero (billing DoS) |
| `POST /internal/resources/acquire` | Steal seller resources |
| `POST /internal/ops/purge-demo-accounts` | Account deletion |
| `GET /internal/metrics` | Prometheus telemetry leak |

Standalone: backend's `verify_internal_key` (`hmac.compare_digest`) still fires — traversal alone only defeats defence-in-depth.
**Chained with FE-C-1** (leaked `INTERNAL_API_KEY`) and **FE-H-1** (proxy forwards `X-Internal-Key` verbatim) → complete unauthenticated access to internal billing/inventory APIs from the public internet.

**Remediation:** Validate after normalization, not before. Reject traversal segments first, then re-validate pathname:
```ts
if (segments.some(s => s === "." || s === ".." || s.includes("\\") || s.includes("\0"))) {
  return NextResponse.json({ detail: "Not found" }, { status: 404 });
}
const target = new URL(`${API_TARGET}/${path}`);
if (/^\/internal(\/|$)/.test(target.pathname)) { /* reject */ }
```
Better: replace blocklist with an allowlist of the ~40 route prefixes in `lib/api.ts`.

---

## High Priority

### FE-H-1 — Proxy forwards all client-controlled headers to backend
**CVSS 7.3**

`frontend/app/api/[...path]/route.ts:71-76`:
```ts
const headers = new Headers(request.headers);
for (const name of ["host", "cookie", "content-length", "connection", "authorization"]) {
  headers.delete(name);
}
```

Denylist of 5 headers. Every other client header (`X-Internal-Key`, `X-Forwarded-For`, `X-Real-IP`, `X-Rewrite-URL`, arbitrary `X-*`) is relayed verbatim to the internal service. Makes FE-C-2 exploitable by passing `X-Internal-Key` through the proxy.

**Remediation:** Invert to allowlist: `content-type`, `accept`, `accept-language`, `user-agent`, `idempotency-key`. Explicitly strip all `x-*` client headers, then inject trusted `X-Forwarded-For` from peer address.

---

### FE-H-2 — Backend exposed on `0.0.0.0:8001`, bypassing all proxy controls
**CVSS 7.5**

`docker-compose.yml:36-37`:
```yaml
marketplace-svc:
  ports:
    - "8001:8001"
```

The proxy is the only enforcement point for the CSRF check, `internal/` blocklist, header stripping, and cookie-only auth model. Attackers who call `:8001` directly bypass all of it — supply raw `Authorization: Bearer <forged_admin_jwt>` and call `/internal/*` with no traversal needed.

`postgres` and `redis` correctly have their `ports:` commented out. `marketplace-svc` does not.

**Remediation:** Remove `ports:` mapping. Frontend container reaches backend over Docker internal network. If ops access needed, bind `127.0.0.1:8001:8001`.

---

## Medium Priority

### FE-M-1 — CSP `script-src` includes `'unsafe-inline'`
**CVSS 5.4** — `frontend/next.config.mjs:26`

```js
`script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`
```

Negates the XSS containment purpose of CSP. Any injected inline script would execute unblocked.

**Remediation:** Nonce-based CSP via `proxy.ts` — generate per-request nonce, set `script-src 'self' 'nonce-{n}' 'strict-dynamic'`, pass through `x-nonce`.

---

### FE-M-2 — Auth enforced client-side only; no middleware gate
**CVSS 5.3**

`frontend/app/[locale]/admin/layout.tsx:15-22` and `seller/(dashboard)/layout.tsx:28-38` use `useEffect` redirect only. `proxy.ts` (Next middleware) has no auth check — only locale routing.

All 19 `/admin/*` and 9 `/seller/*` pages serve their full JS bundle (including admin field names, route structure) to unauthenticated visitors before the redirect fires.

No data exposure — backend re-enforces `require_role` on every API call. This is defence-in-depth and information-disclosure only.

**Remediation:** Add JWT verification in `proxy.ts` for `/admin/*` and `/seller/*` before bundle is served.

---

### FE-M-3 — Open redirect via unvalidated `next` parameter
**CVSS 6.1**

`frontend/app/[locale]/login/page.tsx:25,39` and `register/page.tsx:25,37`:
```tsx
const next = searchParams.get("next");
router.push(next || "/admin");
```

No scheme/host validation. `?next=https://evil.tld` redirects immediately after successful login — highest-trust moment in the session. Potent phishing primitive on a financial site.

**Remediation:**
```ts
const safeNext = next && /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/.test(next) ? next : null;
```
Reject anything starting with `//`, `/\`, or containing `:`.

---

### FE-M-4 — React Query cache never cleared on logout
**CVSS 5.5**

`frontend/lib/query-client.ts:3-12` exports a module-level singleton (`gcTime: 5 * 60 * 1000`). `frontend/lib/auth.tsx:64-67`:
```tsx
const logout = () => {
  void api.logout();
  setAccount(null);      // no queryClient.clear()
};
```

After logout, wallet balances, transaction history, orders, disputes cached in memory for up to 5 minutes. Shared/kiosk device: second user sees previous user's financial data before refetch resolves.

**Remediation:** `queryClient.clear()` in both `logout()` and `handleExpired()`.

---

### FE-M-5 — Attacker-controlled URL in TikTok profile link
**CVSS 4.7** — `frontend/app/[locale]/solutions/tiktok-id/page.tsx:99`

```tsx
<a href={profile.bio_link} target="_blank" rel="noreferrer">{profile.bio_link}</a>
```

`bio_link` comes from TikTok API with no scheme validation. Attacker sets `javascript:` in their own profile → public lookup page renders it. React 19 throws on `javascript:` URLs but that is a framework-layer protection, fragile.

**Remediation:** Server-side scheme validation (`http:`/`https:` only) in the route handler before returning.

---

### FE-M-6 — Per-IP rate limiting collapses to single bucket through proxy
**CVSS 5.3**

Backend uses `request.client.host` — all proxied requests arrive from the frontend container IP. `auth_login_ip_limit: 20` and `auth_register_ip_limit: 10` become single shared limits for the entire user base. One attacker exhausts both, denying auth to all users.

**Remediation:** Proxy sets trusted `X-Forwarded-For` (after stripping client-supplied value); backend parses it with `ProxyHeadersMiddleware` behind trusted-proxy CIDR.

---

### FE-M-7 — Production image built without lockfile; debug tools in runtime
**CVSS 5.3** — `frontend/Dockerfile`

```dockerfile
COPY package.json ./
RUN npm install                              # no lockfile, fresh semver resolution
RUN apk update && apk add --no-cache curl nano vim  # attack tools in runtime
ARG NODE_IMAGE=registry.k7:5000/node:22-alpine      # floating tag
```

`npm audit` clean result applies to the lockfile, not what actually ships.

**Remediation:** `COPY package.json package-lock.json ./` + `RUN npm ci`. Remove `apk add` line. Pin base image by digest. Add `trivy image` to Jenkinsfile.

---

## Low / Informational

| ID | Title | File | Note |
|----|-------|------|------|
| FE-L-1 | `.env` committed to git despite being in `.gitignore` | `frontend/.env` | Exposes backend hostname `api-market.taskforces.info` |
| FE-L-2 | Cookie value not URL-encoded; attacker injects cookie attributes via `?ref=` | `frontend/lib/utils/cookies.ts:10`, `components/ReferralCapture.tsx:36` | `encodeURIComponent(value)` |
| FE-L-3 | CSRF `Origin` check derived from client-supplied `X-Forwarded-Host` | `app/api/[...path]/route.ts:27-28` | Low impact: `SameSite=Strict` prevents cross-site cookie |
| FE-L-4 | `LOOKUP_API_KEY` vs `TIKTOK_LOOKUP_API_KEY` naming drift | `app/api/internal/tiktok/route.ts:74` vs `.env.example:5` | Operator following example gets permanent 503 |
| FE-L-5 | CSP `img-src` permits any HTTPS host | `next.config.mjs:28` | Partial image-beacon exfiltration channel |
| FE-L-6 | Jenkinsfile deploys as `root` over SSH | `Jenkinsfile:19` | `ssh -tt root@172.16.89.2` |
| FE-L-7 | No refresh-token rotation; 60-min access token never refreshed | `app/api/[...path]/route.ts:18` | Users hard-logout hourly; violates `security.md` 15-min guidance |
| FE-L-8 | `BUILT_API_URL` baked into build via `next.config.mjs env:` block | `next.config.mjs:41-43` | Future client-side reference would expose internal URL in public bundle |

---

## Positive Findings — Preserve These

1. **Zero XSS sinks** — no `dangerouslySetInnerHTML`, `.innerHTML`, `eval()`, `document.write` anywhere
2. **Seller-supplied markdown correctly sandboxed** — `MarkdownContent.tsx:51` sets `disableParsingRawHTML: true` with explicit threat-model comment
3. **Rich editor preview routed through safe renderer** — `MDRichEditor.tsx:32` uses `preview="edit"` instead of the upstream rehype pipeline
4. **Token never exposed to JavaScript** — `httpOnly`, `secure` (prod), `SameSite=Strict`, `path=/` cookie
5. **Proxy correctly injects cookie token and strips client `Authorization`** — correct BFF pattern
6. **`Set-Cookie` stripped from upstream responses** — backend cannot hijack the public-origin cookie jar
7. **Session cookie deleted on 401** — clean invalidation
8. **No SSRF** — host-escape (`//evil.com`, `/\evil.com`, `@evil.com`) all stay on configured target; `redirect: "manual"` prevents redirect-chaining
9. **Build fails if `API_URL` is not http/https or targets localhost in production** — fail-secure config validation
10. **Real CSP** with `X-Content-Type-Options`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, HSTS, COOP, Referrer-Policy, Permissions-Policy
11. **`npm audit` clean** — 0 vulnerabilities across 379 dependencies
12. **No `console.*` statements** in production source
13. **No `NEXT_PUBLIC_*` secrets** — only `NEXT_PUBLIC_ENABLE_VI` (feature flag)
14. **API client hard-pinned to same-origin** (`lib/api.ts:7-9`)
15. **TikTok route correctly SSRF-guarded** — strict username regex + `tiktok.com` host allowlist + server-side API key
16. **Frontend Dockerfile runs as non-root** — `adduser -S app` + `USER app`
17. **No file upload surface** — eliminates entire vulnerability class
18. **All `target="_blank"` links carry `rel="noreferrer"`**

---

## Remediation Order

### Before next deploy
- **FE-C-1** — Rotate all secrets, purge git history, untrack `docker-compose.yml`
- **FE-C-2** — Fix path guard in proxy: reject traversal segments, re-validate post-normalization
- **FE-H-2** — Remove `ports: "8001:8001"` from `marketplace-svc`

### Within 24 hours
- **FE-H-1** — Convert proxy header forwarding from denylist to allowlist; strip `x-internal-key`
- **FE-M-3** — Validate `next` param as same-site-relative path
- Add `gitleaks detect` + `trivy image` to Jenkinsfile as blocking stages

### Current sprint
- **FE-M-1** — Nonce-based CSP (drop `'unsafe-inline'`)
- **FE-M-2** — Server-side auth gate in `proxy.ts` for `/admin/*` and `/seller/*`
- **FE-M-4** — `queryClient.clear()` on logout and session expiry
- **FE-M-6** — End-to-end IP propagation
- **FE-M-7** — `npm ci` with lockfile, drop debug tools from Dockerfile

### Next iteration
- FE-M-5, FE-L-1 through FE-L-8, refresh-token rotation

---

*Previous audit (high-level): [security-audit-whitebox-2026-08-07.md](./security-audit-whitebox-2026-08-07.md)*
*Backend deep audit: [security-audit-backend-deep-2026-08-07.md](./security-audit-backend-deep-2026-08-07.md)*
