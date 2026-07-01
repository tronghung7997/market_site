# Cursor Execution Briefs — Affiliate / Referral Feature

Spec: `docs/superpowers/specs/2026-07-01-affiliate-referral-design.md`
Task list: `TASKS.md`

Feed Cursor **one brief at a time**, in the order below. Do not skip ahead — later briefs assume earlier ones landed (schemas, endpoints, response shapes). After each task, run the acceptance criteria before moving to the next brief.

---

## Brief T01 — Alembic migration: schema changes

**Task:** Create a new Alembic migration adding the affiliate/referral schema.

**Context:** This is a FastAPI + SQLAlchemy(async) + Alembic project. Latest migration head is `g1b2c3d4e5f6_product_pricing_columns` in `marketplace-svc/alembic/versions/`. Follow the exact style of that file (revision id format, `upgrade()`/`downgrade()` structure, `op.add_column`, `op.create_table`).

**Files to modify:**
- New file `marketplace-svc/alembic/versions/<new_revision>_affiliate_referral.py`

**Implementation Notes:**
- Add columns: `accounts.affiliate_code` (String, unique, indexed), `accounts.referred_by_id` (Integer, FK `accounts.id`, nullable), `categories.commission_rate` (Float, nullable), `products.commission_rate` (Float, nullable).
- Add `affiliate_commission` value to the existing Postgres enum backing `TransactionType` (find how the enum is currently declared/migrated in earlier revisions and mirror that approach — likely `op.execute("ALTER TYPE transactiontype ADD VALUE ...")`, which must run outside a transaction block if using autocommit-sensitive Postgres versions).
- Add `affiliate_code` as nullable first, backfill existing rows with a generated unique 8-char uppercase alphanumeric code via a data migration step (raw SQL or Python loop over rows), THEN alter to NOT NULL + unique constraint in the same migration.
- New tables `affiliate_clicks` and `affiliate_commissions` exactly as specified in the spec's Data Model section (field types, FKs, `order_id` unique on `affiliate_commissions`).
- Write a working `downgrade()` — note in a code comment if the enum value removal is a no-op/irreversible (Postgres can't drop enum values easily); do not fake a working rollback for that part.

**Acceptance Criteria:**
- `alembic upgrade head` succeeds on the current dev DB (seeded with existing data) without manual intervention.
- After upgrade, every existing row in `accounts` has a non-null, unique `affiliate_code`.
- `alembic downgrade -1` runs without error (enum-value caveat documented, not silently broken).

**Potential Pitfalls:**
- Adding a NOT NULL + UNIQUE column to a populated table in one step will fail — must backfill first.
- Postgres `ALTER TYPE ... ADD VALUE` cannot run inside the same transaction as other DDL in some Postgres versions/Alembic configs — check how prior enum migrations in this repo handled it (search `alembic/versions/` for existing enum alterations) and match that pattern exactly.
- Do not touch unrelated tables/columns.

---

## Brief T02 — `affiliate_code` generation + wire into account creation

**Task:** Generate a unique affiliate code for every new account.

**Context:** `src/auth/service.py` handles registration. Account model now has `affiliate_code` (T01 landed). No such generator exists yet.

**Files to modify:**
- New or existing utility module, e.g. `marketplace-svc/src/auth/utils.py`
- `marketplace-svc/src/auth/service.py` (registration function)

**Implementation Notes:**
- Generator: 8-char uppercase alphanumeric (`string.ascii_uppercase + string.digits`), using `secrets.choice` (not `random`) for unpredictability.
- On collision (unique constraint violation on insert, or a pre-check query), retry generation up to a small bounded number of attempts (e.g. 5) before raising — do not loop forever.
- Wire into wherever `Account(...)` is constructed during registration, so `affiliate_code` is set before insert.

**Acceptance Criteria:**
- Every account created through `register()` has a non-null, unique `affiliate_code` immediately after creation.
- A unit test forces a collision (e.g. monkeypatch the generator to return a fixed value once, then a real one) and asserts the retry produces a working unique code.

**Potential Pitfalls:**
- Don't use `random` module for the code (weak PRNG) — use `secrets`.
- Don't swallow the exception silently after exhausting retries — raise a clear error.

---

## Brief T03 — Register endpoint: `referral_code` → `referred_by_id`

**Task:** Accept an optional referral code at registration and attribute the new account to the referring affiliate.

**Context:** `src/auth/schemas.py` defines the register request model; `src/auth/service.py` implements the registration logic. `Account.referred_by_id` column landed in T01.

**Files to modify:**
- `marketplace-svc/src/auth/schemas.py`
- `marketplace-svc/src/auth/service.py`

**Implementation Notes:**
- Add `referral_code: str | None = None` to the register request schema.
- In the service, after generating the new account's own `affiliate_code` (T02) but before/at insert, if `referral_code` is provided: look up an account by `affiliate_code == referral_code`. If found, set `referred_by_id` to that account's id. If not found, proceed without error (silent ignore — do not raise 400).
- `referred_by_id` must only ever be set at creation time — do not add any update endpoint or code path that modifies it afterward.

**Acceptance Criteria:**
- Register with a valid `referral_code` → new account's `referred_by_id` equals the referring account's `id`.
- Register with an invalid/unknown `referral_code` → registration still succeeds, `referred_by_id` is `None`.
- Register with no `referral_code` at all (field omitted) → succeeds as before, `referred_by_id` is `None`.

**Potential Pitfalls:**
- Do not raise an error for unknown codes — this must fail silently per spec (avoid leaking which codes are valid).
- Watch for self-referral at this stage being structurally impossible (new account doesn't exist yet to reference itself) — no special-case needed here, the guard belongs in T07 (order completion), not registration.

---

## Brief T04 — Product & Category schemas: `commission_rate`

**Task:** Allow `commission_rate` to be set via existing product/category update endpoints.

**Context:** `src/products/schemas.py` + `src/products/service.py`, and `src/categories/schemas.py` + `src/categories/service.py`. Columns landed in T01.

**Files to modify:**
- `marketplace-svc/src/products/schemas.py`
- `marketplace-svc/src/products/service.py`
- `marketplace-svc/src/categories/schemas.py`
- `marketplace-svc/src/categories/service.py`

**Implementation Notes:**
- Add `commission_rate: float | None = None` to the relevant update (and create, if applicable) schemas for both Product and Category.
- Ensure partial updates (`PATCH`-style, using `exclude_unset` or equivalent pattern already used in this codebase) leave `commission_rate` untouched when the field isn't included in the request — do not default it to `None` on every update call. Follow whatever partial-update pattern the existing service functions already use for other optional fields.

**Acceptance Criteria:**
- Updating a product/category with `commission_rate` in the payload persists the value.
- Updating a product/category WITHOUT `commission_rate` in the payload leaves any previously-set value unchanged.
- Existing product/category tests still pass unmodified.

**Potential Pitfalls:**
- Don't accidentally make this field required or give it a non-null default — nullable is intentional (nullable = "inherit from parent level").

---

## Brief T05 — Scaffold `src/affiliate/` module + `POST /affiliate/click`

**Task:** Create the new `affiliate` backend module and implement public click tracking.

**Context:** Existing modules (e.g. `src/disputes/`, `src/wallet/`) follow a `__init__.py` / `router.py` / `schemas.py` / `service.py` structure, registered in `src/main.py`. Mirror that structure exactly.

**Files to modify:**
- New: `marketplace-svc/src/affiliate/__init__.py`
- New: `marketplace-svc/src/affiliate/router.py`
- New: `marketplace-svc/src/affiliate/schemas.py`
- New: `marketplace-svc/src/affiliate/service.py`
- New: `marketplace-svc/src/models/affiliate.py` (if not already added in T01 — check first; if T01 put the models elsewhere, keep consistent placement)
- `marketplace-svc/src/main.py` (register the new router)

**Implementation Notes:**
- `POST /affiliate/click`: no auth required. Request body `{code: str}`. Look up account by `affiliate_code`. If found, insert an `AffiliateClick` row (`affiliate_account_id`, optional `path`/`referrer` from request body/headers if you choose to accept them — keep minimal per spec). If not found, do nothing and still return `204`.
- Look at how other public (non-auth) endpoints are declared in this codebase (e.g. product listing) for the dependency-injection pattern to copy for the DB session.

**Acceptance Criteria:**
- Endpoint is reachable at `POST /affiliate/click` and included in the OpenAPI schema (`/docs`).
- Valid code → one `AffiliateClick` row created with correct `affiliate_account_id`.
- Unknown code → `204` response, zero rows created, no exception/log noise.
- No `Authorization` header required to call this endpoint.

**Potential Pitfalls:**
- Do not accidentally require auth via a shared dependency default — double check the router's dependencies list.
- Do not leak whether a code exists via response differences (status code, timing-observable errors) — same `204` either way.

---

## Brief T06 — `GET /affiliate/me`

**Task:** Implement the authenticated affiliate stats endpoint.

**Context:** Builds on T05's module and T03's `referred_by_id` attribution. Auth dependency pattern already exists elsewhere in the codebase (check `src/auth/dependencies.py` for the current-user dependency used by other authed routes like `/wallet`).

**Files to modify:**
- `marketplace-svc/src/affiliate/router.py`
- `marketplace-svc/src/affiliate/schemas.py`
- `marketplace-svc/src/affiliate/service.py`

**Implementation Notes:**
- Route: `GET /affiliate/me`, auth required, optional query params `from_date`/`to_date` (or match this repo's existing date-range param naming convention — check `orders/router.py` or `wallet/router.py` for precedent).
- Response fields per spec: `code`, `link` (construct from a configurable frontend base URL — check `src/config.py` for an existing base-URL setting to reuse, or add one), `totals` (`clicks`, `signups`, `orders`, `revenue`, `commission`), `timeseries` (per-day, zero-filled — no missing days in range), `commissions` (recent list joined with order/product info).
- `totals.clicks`: count of `affiliate_clicks` for `affiliate_account_id == current_user.id`, filtered by range if given.
- `totals.signups`: count of accounts where `referred_by_id == current_user.id`, filtered by `created_at` range if given.
- `totals.orders` / `totals.revenue` / `totals.commission`: derived from `affiliate_commissions` rows for this affiliate (join to `orders` for revenue/product info), filtered by range if given.
- Structure the aggregation logic as a standalone service function taking `account_id` + optional date range — T08 (admin detail endpoint) will reuse it, don't inline it directly in the router handler.

**Acceptance Criteria:**
- Authenticated request returns the caller's own `code` correctly.
- All `totals` fields match direct DB counts/sums for known test fixtures.
- `timeseries` has no gaps — every day in the requested range appears, with zero values where there's no activity.
- Unauthenticated request → `401`.

**Potential Pitfalls:**
- Don't let a day with zero activity simply disappear from `timeseries` — the frontend chart depends on continuous dates.
- Watch timezone handling — use whatever `datetime` convention (naive UTC vs timezone-aware) is already standard in this codebase (check `created_at` columns elsewhere, they use `DateTime(timezone=True)`).

---

## Brief T07 — Order completion hook: commission calculation

**Task:** When an order completes, credit the referring affiliate's wallet with a commission.

**Context:** `src/orders/service.py` already has logic transitioning orders to `completed` alongside escrow release (`src/scheduler.py`'s `escrow_release` job and/or the direct confirm/complete order flow — locate the exact function(s) where `Order.status` is set to `completed`; there may be more than one code path, e.g. manual confirm vs scheduled escrow release — both need this hook).

**Files to modify:**
- `marketplace-svc/src/orders/service.py`
- Possibly `marketplace-svc/src/scheduler.py` if escrow auto-release is a separate code path that also completes orders
- `marketplace-svc/src/config.py` (add `DEFAULT_AFFILIATE_COMMISSION_PERCENT` setting)

**Implementation Notes:**
- At every point `Order.status` transitions to `completed`, after that assignment but within the same DB transaction/session commit boundary:
  1. Load the buyer account (`order.buyer_id`).
  2. If `buyer.referred_by_id` is `None` → skip, no commission.
  3. If `buyer.referred_by_id == order.buyer_id` → skip (defensive self-referral guard, should be structurally impossible but check anyway).
  4. Resolve rate: `product.commission_rate` if set, else the product's `category.commission_rate` if set, else `settings.DEFAULT_AFFILIATE_COMMISSION_PERCENT`.
  5. `amount = round(order.total_amount * rate / 100)`.
  6. Insert `AffiliateCommission(order_id=order.id, affiliate_account_id=buyer.referred_by_id, buyer_account_id=buyer.id, rate_percent=rate, amount=amount)`.
  7. Insert `Transaction(type=affiliate_commission, wallet_id=<affiliate's wallet id>, amount=amount, reference_id=str(order.id))` and increment that wallet's `balance` — follow the exact pattern used for `purchase_release`/`refund` transactions elsewhere in `wallet/service.py` (reuse that helper function if one exists, don't duplicate the balance-update logic).
- All of the above must be part of the same DB transaction as the order status change — if anything after step 1 raises, the whole transaction (including the order status change) must roll back. Do not use a separate commit for the commission logic.
- Rely on the `order_id` unique constraint on `affiliate_commissions` as a hard guard against double-crediting if this code path is ever re-entered for the same order.

**Acceptance Criteria:**
- Order completes with a referred buyer, no product/category override → commission = `DEFAULT_AFFILIATE_COMMISSION_PERCENT` of `total_amount`, wallet credited exactly that amount, one `AffiliateCommission` row created.
- Same, with only category `commission_rate` set → uses category rate.
- Same, with product `commission_rate` set (category also set) → product rate wins.
- Order completes with `buyer.referred_by_id is None` → no commission row, no wallet change.
- Order completes with `buyer.referred_by_id == order.buyer_id` → no commission row, no wallet change.
- Forcing an exception after the order-status change but before the transaction commits → order status change itself also rolls back (no partial state).
- If this hook fires twice for the same order (simulate by calling the completion path twice), the `order_id` unique constraint prevents a duplicate `AffiliateCommission` row (test should assert an integrity error is raised/handled, not that it silently double-credits).

**Potential Pitfalls:**
- There may be two code paths that mark an order `completed` (manual confirm + scheduled escrow release in `scheduler.py`) — miss one and commissions silently don't fire for that path. Search for all assignments of `OrderStatus.completed` before starting.
- Don't create a new/separate DB transaction for the commission insert — it must share the transaction with the order update, or a partial-failure test will catch it.
- Use integer rounding consistent with how `total_amount`/`amount` are handled elsewhere (this repo stores money as `Integer`, likely smallest currency unit — check existing rounding conventions in `wallet/service.py` before choosing `round()` vs `int()` vs floor).

---

## Brief T08 — Admin endpoints: affiliate list + detail

**Task:** Add admin-only endpoints to list and drill into affiliate performance.

**Context:** Admin-only routes elsewhere in this codebase use a `require_role` dependency (referenced in the architecture summary as `require_role` — check `src/auth/dependencies.py` for the exact name/usage and copy the pattern from an existing admin router, e.g. `src/disputes/router.py`'s admin resolve endpoint or `src/providers/router.py`).

**Files to modify:**
- `marketplace-svc/src/affiliate/router.py`
- `marketplace-svc/src/affiliate/schemas.py`
- `marketplace-svc/src/affiliate/service.py`

**Implementation Notes:**
- `GET /admin/affiliates`: admin-only, paginated, optional `search` (email substring match), returns list of accounts with aggregated stats (reuse the service function built for T06, called per-account or via one efficient aggregate query — prefer a single query with GROUP BY over N+1 per-account calls if the account list is paginated to a reasonable page size).
- `GET /admin/affiliates/{account_id}`: admin-only, returns the same shape as `/affiliate/me` but for an arbitrary account id (reuse the T06 service function directly, passing the path param's `account_id` instead of the current user's id).
- Do NOT duplicate the totals/timeseries aggregation logic — both this and T06 must call the same underlying service function.

**Acceptance Criteria:**
- Non-admin caller (buyer/seller role) → `403` on both endpoints.
- `GET /admin/affiliates` supports pagination params consistent with other paginated admin endpoints in this codebase (check `orders/router.py`'s admin list for the existing pagination param convention — likely `page`/`page_size` or `skip`/`limit`) and email search.
- `GET /admin/affiliates/{account_id}` for a nonexistent id → `404`.
- Detail response for a given account matches what `/affiliate/me` would return if that account itself called it (verified by a test comparing both for the same account/data).

**Potential Pitfalls:**
- Watch N+1 queries if computing aggregates per-row for a paginated list — check query count in a test if this codebase has a query-counting test helper already (check `tests/conftest.py`).

---

## Brief T09 — Backend tests: `test_affiliate.py`

**Task:** Write comprehensive backend tests for the whole affiliate feature and patch any existing tests broken by the schema/behavior changes.

**Context:** Test patterns live in `marketplace-svc/tests/`, using fixtures from `tests/conftest.py`. Follow the style of `test_wallet.py` and `test_orders.py` closely (fixture usage, async client patterns, DB session handling).

**Files to modify:**
- New: `marketplace-svc/tests/test_affiliate.py`
- `marketplace-svc/tests/test_auth.py` (if register schema change breaks existing assertions)
- `marketplace-svc/tests/test_orders.py` (if order completion flow signature/fixtures changed)

**Implementation Notes:**
- Cover every "Acceptance Criteria" bullet from briefs T02–T08 that isn't already a standalone test written during those tasks — this brief is the consolidation/gap-fill pass, not a from-scratch duplicate.
- Include explicit test cases for: valid/invalid `referral_code` at registration, click tracking for known/unknown codes, all three commission-rate precedence levels, self-referral block, wallet balance correctness after commission, `/affiliate/me` response correctness (including zero-filled timeseries), `/admin/affiliates` auth guard + pagination + search, `/admin/affiliates/{id}` 404 case.

**Acceptance Criteria:**
- `pytest` (full suite) passes with zero failures/errors.
- No skipped or `xfail`-marked tests were added as a workaround for a real bug — if a test can't pass, fix the underlying code, don't mark it skip.

**Potential Pitfalls:**
- Don't test implementation details (private helper function internals) — test observable behavior through the API/service boundary, consistent with the rest of this test suite's style.

---

## Brief T10 — Frontend: `lib/types.ts` + `lib/api.ts`

**Task:** Add TypeScript types and API client functions for the affiliate feature.

**Context:** `frontend/lib/api.ts` is a thin fetch wrapper (`request<T>()` helper already defined) exporting an `api` object of named functions. `frontend/lib/types.ts` holds all shared interfaces. Match existing naming/style exactly (see how `wallet()`, `products()` etc. are defined in `api.ts`).

**Files to modify:**
- `frontend/lib/types.ts`
- `frontend/lib/api.ts`

**Implementation Notes:**
- Add types: `AffiliateStats` (totals + timeseries + commissions list, matching T06's exact response shape — do not guess, copy field names from the finalized backend response), `AffiliateCommissionRow`, `AffiliateSummary` (for admin list rows).
- Extend `Account` type with `affiliate_code` and `referred_by_id`; extend `Product`/`Category` types with `commission_rate`.
- Add to the `api` object: `affiliateClick(code: string)`, `affiliateMe(params?: {from?: string; to?: string})`, `adminAffiliates(params?: {search?: string; page?: number})`, `adminAffiliateDetail(id: number)`.
- Update `register(email, password, referralCode?)` to include `referral_code` in the request body only when `referralCode` is provided (don't send the key with `undefined`).

**Acceptance Criteria:**
- `npx tsc --noEmit` (or the project's existing typecheck script) passes with no new errors.
- New API functions' request/response types exactly match the backend contracts from T05/T06/T08 (field names and optionality checked against the actual backend response, not assumed).
- Existing call sites of `api.register(...)` continue to compile without modification (new param is optional and appended, not inserted).

**Potential Pitfalls:**
- Don't invent field names — pull the exact response shape from the finalized backend code/OpenAPI schema (`/docs`) for T06/T08 before writing these types.

---

## Brief T11 — Frontend: cookie helper + `ReferralCapture`

**Task:** Capture `?ref=CODE` from any page into a cookie and fire a click-tracking call, without rendering anything.

**Context:** No cookie utilities exist yet in this frontend (`frontend/lib/utils/`). `frontend/app/layout.tsx` is the root layout where global providers/components are mounted (check existing pattern — `AuthProvider`, `QueryProvider` etc. are likely already wrapped there).

**Files to modify:**
- `frontend/lib/utils/` (new file or add to existing, e.g. `cookies.ts`, then re-export from `index.ts`)
- New: `frontend/components/ReferralCapture.tsx`
- `frontend/app/layout.tsx`

**Implementation Notes:**
- `getCookie(name: string): string | null` and `setCookie(name: string, value: string, days: number)` using `document.cookie` directly (no library needed).
- `ReferralCapture`: `"use client"` component, reads `ref` via `useSearchParams()` (Next.js App Router hook — requires being inside a `Suspense` boundary per Next.js 15 rules, check how other client components using `useSearchParams` in this app handle that, e.g. `RouteProgress.tsx` if it does something similar). On mount, if `ref` present: `setCookie('aff_ref', ref, 365)`, then call `api.affiliateClick(ref).catch(() => {})` (never throw, never show UI).
- Component returns `null`.
- Mount once in `RootLayout`, not per-page.

**Acceptance Criteria:**
- Visiting `/?ref=ABC123` sets `document.cookie` to include `aff_ref=ABC123`.
- Visiting any page without `?ref=` sets no cookie and makes no network call.
- A failed click API call (simulate offline/network error) produces no console error surfaced to the user and no thrown exception.
- Component contributes zero visible DOM output.

**Potential Pitfalls:**
- `useSearchParams()` in the App Router requires a `Suspense` boundary around the component tree using it, or the build will error/warn — check how the existing codebase handles this (search for other `useSearchParams` usages first).
- Don't re-fire the click call on every re-render — guard with a ref/effect dependency so it only fires once per page load when `ref` is present.

---

## Brief T12 — Frontend: register page reads referral cookie

**Task:** Pass the stored referral code through when submitting registration.

**Context:** `frontend/app/register/page.tsx` currently calls `register(email, password)` from `useAuth()`. `useAuth` wraps `api.register` — check `frontend/lib/auth.tsx` for how `register` is exposed by the hook, since the hook's signature may also need updating to pass the extra param through to `api.register`.

**Files to modify:**
- `frontend/app/register/page.tsx`
- `frontend/lib/auth.tsx` (if `register` in the auth context needs its signature extended)

**Implementation Notes:**
- At submit time, read `getCookie('aff_ref')` and pass it as the third arg to `register(email, password, referralCode)`.
- Don't read the cookie at component mount and cache it in state unnecessarily — reading at submit time is simplest and avoids staleness, but either is acceptable as long as the value at submit reflects the current cookie.

**Acceptance Criteria:**
- With `aff_ref` cookie present at submit time, the network request body includes `referral_code`.
- With no cookie, the request succeeds exactly as before (no `referral_code` key, or `undefined` — matching whatever T10's `api.register` does with an omitted value).
- Existing error handling and redirect-on-success behavior unchanged.

**Potential Pitfalls:**
- Don't break the existing register page's error/loading state handling — this is an additive change only.

---

## Brief T13 — Frontend: `/affiliate` dashboard page

**Task:** Build the authenticated affiliate stats page.

**Context:** Auth-gated pages in this app use `useAuth()` from `frontend/lib/auth.tsx`. Stat cards use `frontend/components/admin/stats-card.tsx`. Charts elsewhere (e.g. admin overview) use Recharts — check `frontend/app/admin/page.tsx` for the exact chart component/pattern already in use and replicate it rather than introducing a new charting approach.

**Files to modify:**
- New: `frontend/app/affiliate/page.tsx`
- Possibly new: `frontend/app/affiliate/loading.tsx` (this app has a `loading.tsx` convention per route, seen in `orders/` and `wallet/`)

**Implementation Notes:**
- Gate the page: redirect to `/login` if `useAuth()` reports no user (match the exact guard pattern used in `orders/page.tsx` or `wallet/page.tsx`).
- Fetch via `api.affiliateMe({from, to})` (TanStack Query, matching this app's existing data-fetching convention — check `hooks/use-orders.ts` for the pattern and consider adding a `hooks/use-affiliate.ts` if that's the established convention for other pages rather than calling `api` directly in the page component).
- Render: referral link (`{origin}/?ref={code}`) with a copy-to-clipboard button (check `components/ui/` for an existing button/tooltip to reuse for copy feedback), 4 `stats-card` instances (clicks/signups/orders/commission), a date-range control, a Recharts line/bar chart for the timeseries, and a table of recent commissions (reuse table styling patterns from `orders/page.tsx` if a plain table, or TanStack Table if this app uses it elsewhere for similar lists).

**Acceptance Criteria:**
- Unauthenticated visit redirects to `/login`.
- Page renders without error for a brand-new account with zero activity (empty states for chart/table, stat cards show 0).
- Copy button copies exactly `{window.location.origin}/?ref={code}`.
- Changing the date-range control triggers a refetch with updated `from`/`to`.

**Potential Pitfalls:**
- Don't hardcode the origin/base URL — derive from `window.location.origin` client-side (this component is inherently client-rendered since it needs auth state and clipboard access).
- Match existing loading/error UI conventions (spinner component, error banner) rather than inventing new ones — check `components/ui/spinner.tsx` usage elsewhere.

---

## Brief T14 — Frontend: `/admin/affiliates` list + detail

**Task:** Build the admin affiliate management pages.

**Context:** Admin pages live under `frontend/app/admin/`, wrapped by `frontend/app/admin/layout.tsx` (`AdminLayout`), using `components/admin/AdminShell.tsx`, `pagination.tsx`, `search-input.tsx`. Look at `frontend/app/admin/providers/page.tsx` or `frontend/app/admin/products/page.tsx` as the closest structural precedent (list + search + pagination + drill-in) and copy that structure.

**Files to modify:**
- New: `frontend/app/admin/affiliates/page.tsx`
- New: `frontend/app/admin/affiliates/[id]/page.tsx` (or a slide-panel triggered from the list, per `components/admin/slide-panel.tsx` — pick whichever pattern the closest precedent page (e.g. products or providers) actually uses, for consistency)

**Implementation Notes:**
- List page: table of accounts with columns for email, affiliate_code, clicks, signups, orders, commission total; search box wired to `adminAffiliates({search})`; pagination controls wired to the same pattern used in `admin/products` or `admin/orders`.
- Detail view: same stat-card + chart + commissions-table layout as T13's `/affiliate` page, but fetching via `adminAffiliateDetail(id)` for an arbitrary account — consider extracting a shared presentational component (e.g. `components/AffiliateStatsView.tsx`) used by both T13 and this detail view to avoid duplicating the stat-card/chart/table markup.

**Acceptance Criteria:**
- Non-admin session hitting `/admin/affiliates` directly is blocked/redirected exactly as other `/admin/*` pages already behave (check the existing guard, likely in `AdminLayout`).
- Search filters the list without a full page reload; pagination works.
- Clicking a row navigates to (or opens) the detail view showing that account's full stats.

**Potential Pitfalls:**
- Don't duplicate the stats-card/chart/table markup between T13 and this detail view — extract a shared component once you see how similar they are.

---

## Brief T15 — Frontend: `commission_rate` input on product/category admin forms

**Task:** Let admins set commission rate on products/categories.

**Context:** `frontend/app/admin/products/[id]/page.tsx` is the product edit page; locate the corresponding category edit UI (likely within the products admin area or a dedicated categories admin page — check `frontend/app/admin/products/` for a categories sub-view, or search the codebase if categories are managed elsewhere).

**Files to modify:**
- `frontend/app/admin/products/[id]/page.tsx`
- Wherever categories are edited in admin (locate first; do not create a new category-admin page if one doesn't exist — check with the user/spec before adding new admin surface area beyond what's scoped)

**Implementation Notes:**
- Add a numeric input labeled e.g. "Hoa hồng affiliate (%)" bound to `commission_rate`, optional (empty = inherit), using existing form input components (`components/ui/input.tsx`, `Field` wrapper as seen in `register/page.tsx`).
- Client-side validate range 0–100 before submit (reuse whatever validation pattern the rest of this form already uses, if any).

**Acceptance Criteria:**
- Leaving the field blank and saving does not overwrite a previously-set value with null (matches T04's backend partial-update guarantee — verify by actually testing against the running backend, not just assuming).
- Entering a value outside 0–100 is rejected client-side with a visible message, consistent with other validated fields on this form.

**Potential Pitfalls:**
- If no existing category-edit UI exists in admin, do not invent new scope — flag this back rather than silently expanding the task.

---

## Brief T16 — Frontend: `TopNav` affiliate link

**Task:** Surface the affiliate dashboard in navigation.

**Context:** `frontend/components/TopNav.tsx` is role-aware (per README: "Navigation (role-aware)") — check how it currently conditionally renders links for authenticated vs anonymous users and for role-specific links (buyer/seller/admin) to match the exact pattern for active-link styling and auth-gating.

**Files to modify:**
- `frontend/components/TopNav.tsx`

**Implementation Notes:**
- Add an "Affiliate" link to `/affiliate`, shown only when a user is authenticated (any role — buyer, seller, or admin all have an affiliate code per spec).
- Use the same active-state detection (likely `usePathname()` comparison) already used for other nav links in this file.

**Acceptance Criteria:**
- Link is absent for anonymous (logged-out) visitors.
- Link is present for buyer, seller, and admin roles alike.
- Active-state styling applies when on `/affiliate`.

**Potential Pitfalls:**
- Don't restrict this to a single role — every account has an affiliate code per the spec's scope, so all authenticated roles should see it.
