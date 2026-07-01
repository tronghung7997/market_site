# TASKS.md — Affiliate / Referral Feature

Spec reference: `docs/superpowers/specs/2026-07-01-affiliate-referral-design.md`

Each task is independently executable, 30–120 min, with explicit dependencies and acceptance criteria. Execute in dependency order; tasks with no shared dependency can run in parallel.

---

## T01 — Alembic migration: schema changes

**Depends on:** none

Add to a new alembic revision (parent: `g1b2c3d4e5f6_product_pricing_columns`):
- `accounts.affiliate_code` (String, unique, indexed, NOT NULL — backfill existing rows before adding NOT NULL constraint)
- `accounts.referred_by_id` (Integer, FK → accounts.id, nullable)
- `categories.commission_rate` (Float, nullable)
- `products.commission_rate` (Float, nullable)
- New table `affiliate_clicks` (id, affiliate_account_id FK, path, referrer, created_at)
- New table `affiliate_commissions` (id, order_id FK unique, affiliate_account_id FK, buyer_account_id FK, rate_percent, amount, created_at)
- Extend `transactiontype` enum (Postgres) with `affiliate_commission`

**Acceptance Criteria:**
- `alembic upgrade head` runs clean on a fresh DB and on the current seeded dev DB.
- `alembic downgrade -1` reverts cleanly, no orphaned constraints/enum values left (Postgres enum removal handled or documented as irreversible with a comment).
- Existing rows in `accounts` get a generated unique `affiliate_code` as part of the migration's data-backfill step (not left null before the NOT NULL constraint is applied).

---

## T02 — `affiliate_code` generation utility + wire into Account creation

**Depends on:** T01

Add a helper (e.g. `src/auth/utils.py` or `src/affiliate/service.py`) that generates an 8-char uppercase alphanumeric code and retries on unique-constraint collision. Wire it into account creation in `src/auth/service.py` so every new account gets a code at insert time.

**Acceptance Criteria:**
- Every account created via `register()` has a non-null, unique `affiliate_code`.
- Collision retry covered by a unit test (mock/force a collision, assert retry succeeds).
- No change to existing `register()` response shape beyond what's needed (code not necessarily returned yet — that's T06).

---

## T03 — Register endpoint: accept `referral_code`, set `referred_by_id`

**Depends on:** T02

Extend `src/auth/schemas.py` register request with optional `referral_code: str | None`. In `src/auth/service.py`, after creating the account, if `referral_code` resolves to an existing account, set `referred_by_id` on the new account. Invalid/unknown code → silently ignore (no error).

**Acceptance Criteria:**
- Register with valid `referral_code` → new account's `referred_by_id` equals the referring account's id.
- Register with missing/invalid `referral_code` → `referred_by_id` is `None`, request still succeeds (no error surfaced).
- `referred_by_id` is never modified after creation (no update path exists elsewhere).

---

## T04 — Product & Category schemas: `commission_rate` field

**Depends on:** T01

Add optional `commission_rate: float | None` to update/create schemas in `src/products/schemas.py` and `src/categories/schemas.py`, and thread through their `service.py` update functions.

**Acceptance Criteria:**
- `PATCH`/`PUT` on a product or category accepts `commission_rate` and persists it.
- Omitting the field leaves existing value unchanged (not reset to null).
- Existing product/category tests still pass.

---

## T05 — Scaffold `src/affiliate/` module + `POST /affiliate/click`

**Depends on:** T01

Create `src/affiliate/{__init__.py,router.py,schemas.py,service.py}` following the existing module pattern (see `src/disputes/` for reference structure). Implement `POST /affiliate/click` (public, no auth): body `{code: str}`, resolves `affiliate_code` → inserts `AffiliateClick` row (path/referrer optional, from request body or headers). Unknown code → return `204` without creating a row (no error).

**Acceptance Criteria:**
- Endpoint registered in `src/main.py` router includes.
- Valid code → `AffiliateClick` row created with correct `affiliate_account_id`.
- Unknown code → `204` returned, no row created, no exception raised.
- Endpoint requires no auth header.

---

## T06 — `GET /affiliate/me` with stats aggregation

**Depends on:** T05, T03

Implement the endpoint per spec: `code`, `link`, `totals` (clicks/signups/orders/revenue/commission), `timeseries` (per-day), `commissions` (recent list with order/product info). Support optional `from`/`to` query params (date range) filtering clicks/commissions; signups/orders counts should also respect the range where applicable.

**Acceptance Criteria:**
- Returns correct `code` for the authenticated account.
- `totals.clicks` matches count of `affiliate_clicks` for that account (filtered by range if provided).
- `totals.signups` matches count of accounts with `referred_by_id == self.id` (filtered by `created_at` range if provided).
- `totals.commission` matches sum of `affiliate_commissions.amount` for that account.
- `timeseries` has one entry per day in range with zero-filled days (no gaps).
- Returns `401` for unauthenticated requests.

---

## T07 — Order completion hook: commission calculation

**Depends on:** T01, T02, T03, T04

In `src/orders/service.py`, at the point where an order transitions to `completed` (near existing escrow-release logic), add: load buyer, skip if `referred_by_id` is null or equals `buyer_id` (self-referral guard), resolve rate (product → category → `DEFAULT_AFFILIATE_COMMISSION_PERCENT` from `src/config.py`), compute `amount = round(total_amount * rate / 100)`, insert `AffiliateCommission`, insert `Transaction(type=affiliate_commission)`, credit affiliate's `wallet.balance`. All within the same DB transaction as the status change.

**Acceptance Criteria:**
- Order completed with a referred buyer → exactly one `AffiliateCommission` row created, correct `rate_percent` per product→category→default precedence (add 3 test cases, one per precedence level).
- Affiliate's `wallet.balance` increases by exactly `amount`; a matching `Transaction(type=affiliate_commission, reference_id=str(order.id))` exists.
- Order completed with `referred_by_id == buyer_id` → no commission row, no wallet change (self-referral blocked).
- Order completed with `referred_by_id is None` → no commission row.
- If the completion transaction fails/rolls back for any reason, no partial commission/transaction/wallet-balance rows persist (test via forced exception).
- Re-completing an already-completed order (if reachable) does not double-credit — enforced via `order_id` unique constraint on `affiliate_commissions`.

---

## T08 — Admin endpoints: `GET /admin/affiliates`, `GET /admin/affiliates/{id}`

**Depends on:** T06

Implement admin-only list endpoint with pagination and email search, aggregating clicks/signups/orders/commission per account. Implement detail endpoint reusing the aggregation logic from T06 for an arbitrary `account_id`.

**Acceptance Criteria:**
- Non-admin caller → `403`.
- List endpoint paginates and filters by email substring.
- Detail endpoint payload shape matches `/affiliate/me` (minus the requester-specific `link`/`code` framing, or with `account_id` explicit).
- Aggregation logic is shared (not duplicated) between T06 and T08 — extracted into a service function taking `account_id`.

---

## T09 — Backend tests: `test_affiliate.py`

**Depends on:** T02, T03, T05, T06, T07, T08

Write `marketplace-svc/tests/test_affiliate.py` covering all acceptance criteria from T02–T08 not already covered by tests written alongside those tasks. Update `test_auth.py` for the new register schema field; update `test_orders.py` if the completion flow's signature/fixtures changed.

**Acceptance Criteria:**
- Full test suite (`pytest`) passes.
- Coverage includes: valid/invalid referral_code registration, click tracking (known/unknown code), commission precedence (3 levels), self-referral block, wallet crediting, `/affiliate/me` and `/admin/affiliates` response shape and auth guards.

---

## T10 — Frontend: `lib/types.ts` + `lib/api.ts` additions

**Depends on:** T03, T06, T08 (needs finalized response shapes)

Add TypeScript types: `AffiliateStats`, `AffiliateCommissionRow`, `AffiliateSummary`. Extend `Account`/`Product`/`Category` types with new fields. Add API client functions: `affiliateClick(code)`, `affiliateMe(params)`, `adminAffiliates(params)`, `adminAffiliateDetail(id)`. Update `register()` signature to accept optional `referralCode`.

**Acceptance Criteria:**
- `tsc --noEmit` passes with no new type errors.
- API functions match backend request/response shapes exactly (field names, optionality).
- `register()` remains backward compatible for existing call sites (referralCode optional, defaults to omitted).

---

## T11 — Frontend: cookie helper + `ReferralCapture` component

**Depends on:** none (parallelizable with backend work)

Add `getCookie`/`setCookie` helpers to `frontend/lib/utils`. Create `frontend/components/ReferralCapture.tsx` — client component, no visual output, reads `useSearchParams()` for `ref`, sets `aff_ref` cookie (365 days, path `/`), fires `api.affiliateClick(code)` best-effort (swallow errors). Mount it in `frontend/app/layout.tsx` (`RootLayout`).

**Acceptance Criteria:**
- Visiting any page with `?ref=CODE` sets a browser cookie `aff_ref=CODE` readable via `document.cookie`.
- No `?ref=` param → no cookie written, no API call made.
- Component renders nothing (`null`) and does not affect layout/hydration.
- API call failure (network error, bad code) does not throw or show any UI error.

---

## T12 — Frontend: register page reads referral cookie

**Depends on:** T10, T11

Update `frontend/app/register/page.tsx` to read the `aff_ref` cookie at submit time and pass it as `referralCode` to `api.register(...)`.

**Acceptance Criteria:**
- Registering with `aff_ref` cookie present sends `referral_code` in the request body.
- Registering with no cookie sends no `referral_code` field (or `undefined`), request still succeeds.
- Existing register flow (error handling, redirect on success) unchanged.

---

## T13 — Frontend: `/affiliate` dashboard page

**Depends on:** T10

New page `frontend/app/affiliate/page.tsx` (auth-gated via `useAuth`): referral link with copy button, 4 summary stat cards (clicks/signups/orders/commission), day-range filter, Recharts time-series chart, recent commissions table. Follow existing patterns from `components/admin/stats-card.tsx` and the admin dashboard chart.

**Acceptance Criteria:**
- Redirects to `/login` if not authenticated (consistent with other authed pages).
- Copy-link button copies the correct URL (`<origin>/?ref=<code>`) to clipboard.
- Stat cards and chart render from `api.affiliateMe()` data; date-range filter re-fetches with `from`/`to`.
- Empty state (new account, zero stats) renders without error.

---

## T14 — Frontend: `/admin/affiliates` list + detail

**Depends on:** T10

New pages `frontend/app/admin/affiliates/page.tsx` (list, search, pagination — reuse `components/admin/pagination.tsx` and `search-input.tsx`) and a detail view (either `frontend/app/admin/affiliates/[id]/page.tsx` or a slide-panel via `components/admin/slide-panel.tsx`, matching the pattern used elsewhere in admin).

**Acceptance Criteria:**
- List loads, paginates, and search-by-email filters results (debounced, matching existing admin search UX).
- Row click opens detail view with the same stat breakdown as `/affiliate` page for that account.
- Non-admin users are redirected/blocked from this route consistent with other `/admin/*` pages.

---

## T15 — Frontend: admin product/category forms — `commission_rate` input

**Depends on:** T10, T04

Add a `commission_rate` numeric input (%) to the admin product edit form (`frontend/app/admin/products/[id]/page.tsx`) and wherever categories are edited in admin.

**Acceptance Criteria:**
- Field is optional (blank = inherit from category/default), saves correctly via existing update calls.
- Input validates range 0–100 client-side.
- Existing product/category edit flows unaffected when field left blank.

---

## T16 — Frontend: `TopNav` affiliate link

**Depends on:** T13

Add an "Affiliate" nav link in `frontend/components/TopNav.tsx`, visible only to authenticated users, pointing to `/affiliate`.

**Acceptance Criteria:**
- Link visible only when logged in; hidden for anonymous visitors.
- Navigates to `/affiliate` and highlights as active per existing nav active-state logic.

---

## Dependency graph (summary)

```
T01 → T02 → T03 → T06 → T08 → T09
T01 → T04 ─────────────────↗
T01 → T05 → T06
T02,T03,T04 → T07 → T09
T03,T06,T08 → T10 → T12, T13, T14, T15
T11 (independent) → T12
T13 → T16
T04 → T15
```

## Suggested execution order for Cursor

1. T01, T11 (parallel — no shared deps)
2. T02, T04
3. T03, T05
4. T06
5. T07, T08
6. T09 (backend done — run full suite before touching frontend)
7. T10
8. T12, T13, T14, T15 (parallel)
9. T16
