# Affiliate / Referral — Implementation Plan

Spec: `docs/superpowers/specs/2026-07-01-affiliate-referral-design.md`

## Global Constraints

- Backend: FastAPI + SQLAlchemy async + Alembic, module layout `src/<domain>/{__init__.py,router.py,schemas.py,service.py}` (mirror `src/disputes/`, `src/wallet/`).
- Money fields are `Integer` (smallest currency unit) everywhere in this codebase — no floats for amounts. `commission_rate`/rate percentages ARE floats (percent values, e.g. `5.0` = 5%).
- All new DB migrations must chain from the current alembic head at the time the task starts — check `alembic heads` before writing a new revision; do not hardcode an assumed parent.
- Every order-completion commission credit must occur in the SAME DB transaction as the order's status change to `completed` — no separate commit.
- `referred_by_id` on `Account` is set exactly once, at registration, and never updated afterward by any code path.
- Self-referral guard: skip commission if `buyer.referred_by_id == order.buyer_id`.
- Commission rate precedence: `product.commission_rate` → `category.commission_rate` → `settings.DEFAULT_AFFILIATE_COMMISSION_PERCENT`.
- `POST /affiliate/click` and code lookups for unknown/invalid codes must fail silently (no error response, no exception) — never reveal whether a code exists.
- Backend tests run against Postgres (`marketplace_test` DB) via `pytest`, following the fixture patterns in `tests/conftest.py` (`client`, `clean_db`, `register_and_login`, `make_admin`, `make_seller`). Run with:
  `DATABASE_URL=postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace_test TEST_DATABASE_URL=postgresql+asyncpg://marketplace:marketplace@localhost:5432/marketplace_test uv run pytest -q` from `marketplace-svc/`.
- Frontend: Next.js 15 App Router, TypeScript, TanStack Query/Table, Recharts, Tailwind. Match existing component/hook patterns in `frontend/components/`, `frontend/hooks/`, `frontend/lib/`. Typecheck with `npx tsc --noEmit` from `frontend/` (cache dir `--cache /tmp/npm-cache-affiliate` if `npm install` hits a permissions error on the shared global cache).
- Do not invent new admin surface area beyond what a task explicitly scopes (e.g. don't create a new category-admin page if none exists — flag it back instead).
- Known pre-existing, unrelated, out-of-scope failure: `tests/test_pricing.py::TestTaskPricing::test_validate_valid` fails on a clean checkout (missing `target_urls` in a test fixture, unrelated to this feature). Do not fix it as part of these tasks; do not let it block a task's own test run — verify only that YOUR new/changed tests pass and this pre-existing failure is the only failure in the full suite.

---

## Task 1 — Alembic migration: affiliate/referral schema changes

**Context:** FastAPI + SQLAlchemy(async) + Alembic project. Mirror the style of `marketplace-svc/alembic/versions/h1c2d3e4f5g6_order_product_id.py` (the most recent migration, revision id format, `upgrade()`/`downgrade()` structure). Run `alembic heads` first to confirm the current head to chain from (expected: `h1c2d3e4f5g6`, but verify).

**Files to modify:**
- New file `marketplace-svc/alembic/versions/<new_revision>_affiliate_referral.py`
- `marketplace-svc/src/models/account.py` — add `affiliate_code: Mapped[str]` (unique, indexed) and `referred_by_id: Mapped[int | None]` (FK `accounts.id`) to `Account`.
- `marketplace-svc/src/models/category.py` — add `commission_rate: Mapped[float | None]` to `Category`.
- `marketplace-svc/src/models/product.py` — add `commission_rate: Mapped[float | None]` to `Product`.
- `marketplace-svc/src/models/wallet.py` — add `affiliate_commission = "affiliate_commission"` to `TransactionType`.
- New: `marketplace-svc/src/models/affiliate.py` — `AffiliateClick` and `AffiliateCommission` ORM classes (fields per below). Register this module wherever `src/models/__init__.py` imports other model modules, so Alembic's `target_metadata` and the rest of the app can see it.

This task owns BOTH the migration and the corresponding ORM model changes — keep them in the same task so the DB schema and the Python models never drift apart (this codebase already has one instance of that drift, fixed in `h1c2d3e4f5g6_order_product_id.py`; do not reintroduce the pattern).

**Implementation Notes:**
- Add columns: `accounts.affiliate_code` (String, unique, indexed), `accounts.referred_by_id` (Integer, FK `accounts.id`, nullable), `categories.commission_rate` (Float, nullable), `products.commission_rate` (Float, nullable).
- Add `affiliate_commission` to the Postgres enum backing `TransactionType` — use `op.execute("ALTER TYPE transactiontype ADD VALUE 'affiliate_commission'")`, and check how prior enum-value additions (if any) in this repo's migration history handled Postgres's restriction on `ALTER TYPE ... ADD VALUE` running inside a transaction block (search `alembic/versions/*.py` for `ALTER TYPE` first; if none exist, note in a code comment that this statement runs in autocommit mode via `op.execute` and needs `alembic.ini`'s `transaction_per_migration` or an explicit `AUTOCOMMIT` isolation level snippet — verify by actually running the migration, not by assumption).
- Add `accounts.affiliate_code` as nullable first, backfill existing rows with a generated unique 8-char uppercase alphanumeric code (raw SQL loop, e.g. `gen_random_uuid()`-derived substring, or a Python loop over `SELECT id FROM accounts` executed via `op.get_bind()`), THEN alter to NOT NULL + add the unique index, all within this one migration.
- New tables:
  - `affiliate_clicks`: `id` (PK), `affiliate_account_id` (Integer, FK `accounts.id`, NOT NULL, indexed), `path` (String, nullable), `referrer` (String, nullable), `created_at` (DateTime(timezone=True), server_default `now()`).
  - `affiliate_commissions`: `id` (PK), `order_id` (Integer, FK `orders.id`, UNIQUE, NOT NULL), `affiliate_account_id` (Integer, FK `accounts.id`, NOT NULL, indexed), `buyer_account_id` (Integer, FK `accounts.id`, NOT NULL), `rate_percent` (Float, NOT NULL), `amount` (Integer, NOT NULL), `created_at` (DateTime(timezone=True), server_default `now()`).
- Write a working `downgrade()`. Postgres enum values cannot be cleanly dropped — document this limitation with a code comment in `downgrade()` rather than faking a working rollback for that one statement; every other change in this migration must downgrade cleanly.

**Report file:** `.superpowers/sdd/task-1-report.md`

**Acceptance Criteria:**
- `alembic upgrade head` succeeds against a real Postgres instance (the project's dev DB, already running via docker-compose on localhost:5432) without manual intervention.
- After upgrade, every existing row in `accounts` has a non-null, unique `affiliate_code`.
- `alembic downgrade -1` runs without error (enum-value caveat documented, not silently broken).
- Full backend test suite still shows only the one known pre-existing `test_pricing.py` failure (no new failures introduced by the schema change alone — run the suite after upgrading the test DB).

---

## Task 2 — `affiliate_code` generation + wire into account creation

**Context:** Depends on Task 1. `marketplace-svc/src/auth/service.py` handles registration; `src/models/account.py` now has `affiliate_code` and `referred_by_id` columns.

**Files to modify:**
- New utility, e.g. `marketplace-svc/src/auth/utils.py` (or add to `src/affiliate/service.py` if you create that module in this task — your call, but Task 5 will also need a `src/affiliate/` module, so prefer keeping the generator in `src/auth/utils.py` to avoid Task 5 needing to modify auth code)
- `marketplace-svc/src/auth/service.py`

**Implementation Notes:**
- Generator: 8-char uppercase alphanumeric (`string.ascii_uppercase + string.digits`) using `secrets.choice` (not `random`).
- On a unique-constraint collision at insert time, retry generation up to 5 attempts before raising a clear error — do not loop unbounded.
- Wire into `Account(...)` construction during registration so every new account gets a code before insert.

**Report file:** `.superpowers/sdd/task-2-report.md`

**Acceptance Criteria:**
- Every account created via `register()` has a non-null, unique `affiliate_code` immediately after creation (test by inspecting the DB row post-registration).
- A test forces a collision (monkeypatch the generator to return a fixed value once, then a real one) and asserts retry produces a working unique code.
- `pytest tests/test_auth.py` passes (existing tests + new ones for this behavior).

---

## Task 3 — Register endpoint: `referral_code` → `referred_by_id`

**Context:** Depends on Task 2. `marketplace-svc/src/auth/schemas.py` defines the register request model.

**Files to modify:**
- `marketplace-svc/src/auth/schemas.py`
- `marketplace-svc/src/auth/service.py`

**Implementation Notes:**
- Add `referral_code: str | None = None` to the register request schema.
- After generating the new account's own `affiliate_code`, if `referral_code` is provided: look up an account by `affiliate_code == referral_code`. If found, set the new account's `referred_by_id` to that account's id. If not found, proceed without error.
- `referred_by_id` must only ever be set at creation time.

**Report file:** `.superpowers/sdd/task-3-report.md`

**Acceptance Criteria:**
- Register with a valid `referral_code` → new account's `referred_by_id` equals the referring account's `id`.
- Register with an invalid/unknown `referral_code` → registration succeeds, `referred_by_id` is `None`, no error surfaced.
- Register with `referral_code` omitted entirely → succeeds as before.
- `pytest tests/test_auth.py` passes.

---

## Task 4 — Product & Category schemas: `commission_rate`

**Context:** Depends on Task 1 only (independent of Tasks 2-3). `src/products/schemas.py` + `src/products/service.py`, `src/categories/schemas.py` + `src/categories/service.py`.

**Files to modify:**
- `marketplace-svc/src/products/schemas.py`
- `marketplace-svc/src/products/service.py`
- `marketplace-svc/src/categories/schemas.py`
- `marketplace-svc/src/categories/service.py`

**Implementation Notes:**
- Add `commission_rate: float | None = None` to the relevant update (and create, if applicable) schemas for both Product and Category.
- Ensure partial updates leave `commission_rate` untouched when the field isn't included in the request — follow whatever partial-update pattern (`exclude_unset` or equivalent) the existing service functions already use for other optional fields; do not default it to `None` on every update call.

**Report file:** `.superpowers/sdd/task-4-report.md`

**Acceptance Criteria:**
- Updating a product/category with `commission_rate` in the payload persists the value.
- Updating a product/category WITHOUT `commission_rate` in the payload leaves any previously-set value unchanged.
- `pytest tests/test_products.py tests/test_categories.py` passes (existing + new tests).

---

## Task 5 — Scaffold `src/affiliate/` module + `POST /affiliate/click`

**Context:** Depends on Task 1. Existing modules (`src/disputes/`, `src/wallet/`) follow `__init__.py` / `router.py` / `schemas.py` / `service.py`, registered in `src/main.py`. Mirror that structure exactly.

**Files to modify:**
- New: `marketplace-svc/src/affiliate/__init__.py`
- New: `marketplace-svc/src/affiliate/router.py`
- New: `marketplace-svc/src/affiliate/schemas.py`
- New: `marketplace-svc/src/affiliate/service.py`
- `marketplace-svc/src/main.py` (register the new router)

`AffiliateClick`/`AffiliateCommission` ORM classes already exist in `marketplace-svc/src/models/affiliate.py` (added in Task 1) — import them, do not redefine.

**Implementation Notes:**
- `POST /affiliate/click`: no auth. Body `{code: str}`. Look up account by `affiliate_code`. If found, insert an `AffiliateClick` row (`affiliate_account_id`; `path`/`referrer` optional, accept them in the request body if you choose — keep minimal). If not found, do nothing, still return `204`.
- Copy the dependency-injection pattern used by other public (non-auth) endpoints in this codebase for the DB session.

**Report file:** `.superpowers/sdd/task-5-report.md`

**Acceptance Criteria:**
- Endpoint reachable at `POST /affiliate/click`, visible in `/docs`.
- Valid code → one `AffiliateClick` row created with correct `affiliate_account_id`.
- Unknown code → `204`, zero rows created, no exception.
- No `Authorization` header required.
- New `pytest tests/test_affiliate.py` (create this file in this task, covering just this endpoint — Task 9 will extend it) passes.

---

## Task 6 — `GET /affiliate/me`

**Context:** Depends on Tasks 5 and 3. Auth dependency pattern already exists (check `src/auth/dependencies.py` — the dependency used by other authed routes like `/wallet`).

**Files to modify:**
- `marketplace-svc/src/affiliate/router.py`
- `marketplace-svc/src/affiliate/schemas.py`
- `marketplace-svc/src/affiliate/service.py`

**Implementation Notes:**
- Route: `GET /affiliate/me`, auth required, optional query params for a date range (check `orders/router.py` or `wallet/router.py` for this codebase's existing date-range param naming convention and match it).
- Response: `code`, `link` (frontend base URL + `?ref=code` — check `src/config.py` for an existing frontend-base-URL setting to reuse, or add one), `totals` (`clicks`, `signups`, `orders`, `revenue`, `commission`), `timeseries` (per-day, zero-filled — no gaps in the requested range), `commissions` (recent list joined with order/product info).
- `totals.clicks`: count of `affiliate_clicks` for `affiliate_account_id == current_user.id`, filtered by range if given.
- `totals.signups`: count of accounts where `referred_by_id == current_user.id`, filtered by `created_at` range if given.
- `totals.orders`/`totals.revenue`/`totals.commission`: derived from `affiliate_commissions` rows for this affiliate (join to `orders`), filtered by range if given.
- Structure the aggregation as a standalone service function taking `account_id` + optional date range — Task 8 reuses it. Do not inline it directly in the router handler.

**Report file:** `.superpowers/sdd/task-6-report.md`

**Acceptance Criteria:**
- Authenticated request returns the caller's own `code` correctly.
- All `totals` fields match direct DB counts/sums for test fixtures.
- `timeseries` has no gaps — every day in range appears, zero-valued where there's no activity.
- Unauthenticated request → `401`.
- `pytest tests/test_affiliate.py` passes (extend the file from Task 5).

---

## Task 7 — Order completion hook: commission calculation

**Context:** Depends on Tasks 1, 2, 3, 4. `src/orders/service.py` transitions orders to `completed` alongside existing escrow-release logic. There may be MORE THAN ONE code path that sets `Order.status = OrderStatus.completed` — search for all assignments before starting (e.g. a manual confirm endpoint AND a scheduled job in `src/scheduler.py`). Every such path needs this hook.

**Files to modify:**
- `marketplace-svc/src/orders/service.py`
- Possibly `marketplace-svc/src/scheduler.py` if escrow auto-release is a separate code path that also completes orders
- `marketplace-svc/src/config.py` (add `DEFAULT_AFFILIATE_COMMISSION_PERCENT: float = 0` setting)

**Implementation Notes:**
- At every point `Order.status` transitions to `completed`, within the SAME DB transaction as that status change:
  1. Load the buyer account.
  2. If `buyer.referred_by_id` is `None` → skip.
  3. If `buyer.referred_by_id == order.buyer_id` → skip (self-referral guard).
  4. Resolve rate: `product.commission_rate` if set, else the product's `category.commission_rate` if set, else `settings.DEFAULT_AFFILIATE_COMMISSION_PERCENT`.
  5. `amount = round(order.total_amount * rate / 100)`.
  6. Insert `AffiliateCommission(order_id, affiliate_account_id=buyer.referred_by_id, buyer_account_id=buyer.id, rate_percent=rate, amount)`.
  7. Insert `Transaction(type=affiliate_commission, wallet_id=<affiliate's wallet id>, amount, reference_id=str(order.id))` and increment that wallet's `balance` — reuse the existing balance-update helper in `wallet/service.py` used for `purchase_release`/`refund` rather than duplicating that logic.
- Rely on the `order_id` unique constraint on `affiliate_commissions` as a hard guard against double-crediting.

**Report file:** `.superpowers/sdd/task-7-report.md`

**Acceptance Criteria:**
- Order completes with a referred buyer, no product/category override → commission = `DEFAULT_AFFILIATE_COMMISSION_PERCENT` of `total_amount`, wallet credited exactly that amount, one `AffiliateCommission` row created.
- Same, with only category `commission_rate` set → uses category rate.
- Same, with product `commission_rate` set (category also set) → product rate wins.
- Order completes with `buyer.referred_by_id is None` → no commission row, no wallet change.
- Order completes with `buyer.referred_by_id == order.buyer_id` → no commission row, no wallet change.
- Forcing an exception after the order-status change but before commit → the order status change itself also rolls back (test via a forced exception, assert order status reverts too).
- Re-entering the completion path for an already-completed order does not double-credit (the `order_id` unique constraint raises/is handled, not silently double-credited).
- `pytest tests/test_orders.py tests/test_affiliate.py tests/test_scheduler.py` passes.

---

## Task 8 — Admin endpoints: affiliate list + detail

**Context:** Depends on Task 6. Admin-only routes use a `require_role`-style dependency — check `src/auth/dependencies.py` and copy the pattern from an existing admin router (e.g. `src/disputes/router.py` or `src/providers/router.py`).

**Files to modify:**
- `marketplace-svc/src/affiliate/router.py`
- `marketplace-svc/src/affiliate/schemas.py`
- `marketplace-svc/src/affiliate/service.py`

**Implementation Notes:**
- `GET /admin/affiliates`: admin-only, paginated (match this codebase's existing pagination param convention — check `orders/router.py`'s admin list), optional `search` (email substring), returns accounts with aggregated stats. Prefer a single aggregate query (GROUP BY) over N+1 per-account calls for the list.
- `GET /admin/affiliates/{account_id}`: admin-only, same response shape as `/affiliate/me`, for an arbitrary account id — reuse the Task 6 service function directly (do not duplicate the aggregation logic).

**Report file:** `.superpowers/sdd/task-8-report.md`

**Acceptance Criteria:**
- Non-admin caller → `403` on both endpoints.
- `GET /admin/affiliates` paginates and supports email search.
- `GET /admin/affiliates/{account_id}` for a nonexistent id → `404`.
- Detail response for a given account matches what `/affiliate/me` would return if that account called it itself (test compares both for the same account/data).
- `pytest tests/test_affiliate.py` passes (extend from Task 6).

---

## Task 9 — Backend tests: consolidate `test_affiliate.py`, fix breakage elsewhere

**Context:** Depends on Tasks 2, 3, 5, 6, 7, 8 (all backend work). This is the gap-fill/consolidation pass, not a from-scratch rewrite — Tasks 2-8 each already added tests for their own acceptance criteria.

**Files to modify:**
- `marketplace-svc/tests/test_affiliate.py`
- `marketplace-svc/tests/test_auth.py` (if the register schema change broke any existing assertion)
- `marketplace-svc/tests/test_orders.py` (if the completion flow's fixtures changed)

**Implementation Notes:**
- Read through `test_affiliate.py` as it stands after Tasks 5/6/8 and identify any acceptance-criteria gaps from Tasks 2-8 not yet covered by a test. Fill only the gaps.
- Do not duplicate existing coverage.

**Report file:** `.superpowers/sdd/task-9-report.md`

**Acceptance Criteria:**
- Full backend suite (`pytest -q` from `marketplace-svc/`) passes with the ONLY failure being the pre-existing, out-of-scope `test_pricing.py::TestTaskPricing::test_validate_valid`.
- No test is skipped/`xfail`-marked as a workaround for a real bug.

---

## Task 10 — Frontend: `lib/types.ts` + `lib/api.ts`

**Context:** Depends on Tasks 3, 6, 8 (needs finalized backend response shapes — read the actual backend code/OpenAPI schema for those tasks before writing types, do not guess field names). `frontend/lib/api.ts` is a thin fetch wrapper (`request<T>()` helper) exporting a named `api` object. `frontend/lib/types.ts` holds shared interfaces.

**Files to modify:**
- `frontend/lib/types.ts`
- `frontend/lib/api.ts`

**Implementation Notes:**
- Add types: `AffiliateStats` (totals + timeseries + commissions, matching the Task 6 response exactly), `AffiliateCommissionRow`, `AffiliateSummary` (admin list row).
- Extend `Account` with `affiliate_code`/`referred_by_id`; extend `Product`/`Category` with `commission_rate`.
- Add to `api`: `affiliateClick(code: string)`, `affiliateMe(params?: {from?: string; to?: string})`, `adminAffiliates(params?: {search?: string; page?: number})`, `adminAffiliateDetail(id: number)`.
- Update `register(email, password, referralCode?)` to include `referral_code` in the request body only when `referralCode` is provided (never send the key as `undefined`).

**Report file:** `.superpowers/sdd/task-10-report.md`

**Acceptance Criteria:**
- `npx tsc --noEmit` passes with no new errors.
- New API functions' request/response types exactly match the backend contracts (verified against actual backend code, not assumed).
- Existing call sites of `api.register(...)` compile without modification (new param optional, appended last).

---

## Task 11 — Frontend: cookie helper + `ReferralCapture`

**Context:** Independent of all backend tasks — can run in parallel with Tasks 1-9. No cookie utilities exist yet in `frontend/lib/utils/`. `frontend/app/layout.tsx` is the root layout where global providers mount.

**Files to modify:**
- `frontend/lib/utils/` (new file, e.g. `cookies.ts`, re-exported from `index.ts`)
- New: `frontend/components/ReferralCapture.tsx`
- `frontend/app/layout.tsx`

**Implementation Notes:**
- `getCookie(name): string | null` and `setCookie(name, value, days)` via `document.cookie` directly.
- `ReferralCapture`: `"use client"`, reads `ref` via `useSearchParams()` (requires a `Suspense` boundary in Next.js 15 App Router — check how other client components using `useSearchParams` in this app handle that, e.g. search for existing usages first; if none exist, wrap this component's usage point in `<Suspense>` yourself). On mount, if `ref` present: `setCookie('aff_ref', ref, 365)`, call `api.affiliateClick(ref).catch(() => {})`.
- Returns `null`. Mount once in `RootLayout`.
- Guard against re-firing the click call on every re-render (effect dependency/ref guard so it fires once per page load when `ref` is present).

**Report file:** `.superpowers/sdd/task-11-report.md`

**Acceptance Criteria:**
- Visiting `/?ref=ABC123` sets `document.cookie` to include `aff_ref=ABC123`.
- Visiting any page without `?ref=` sets no cookie, makes no network call.
- A failed click call (simulate network error) produces no thrown exception, no user-visible error.
- Component renders no DOM output.
- `npx tsc --noEmit` passes; manually verify in a running dev server (`npm run dev`) that visiting a `?ref=` URL sets the cookie (check via browser devtools or `document.cookie` in console).

---

## Task 12 — Frontend: register page reads referral cookie

**Context:** Depends on Tasks 10 and 11. `frontend/app/register/page.tsx` currently calls `register(email, password)` from `useAuth()`. Check `frontend/lib/auth.tsx` for how `register` is exposed — its signature may need extending to pass the extra param through to `api.register`.

**Files to modify:**
- `frontend/app/register/page.tsx`
- `frontend/lib/auth.tsx` (if needed)

**Implementation Notes:**
- At submit time, read `getCookie('aff_ref')` and pass as the third arg to `register(email, password, referralCode)`.

**Report file:** `.superpowers/sdd/task-12-report.md`

**Acceptance Criteria:**
- With `aff_ref` cookie present at submit, the network request body includes `referral_code`.
- With no cookie, request succeeds exactly as before (no `referral_code` key).
- Existing error handling and redirect-on-success behavior unchanged.
- `npx tsc --noEmit` passes.

---

## Task 13 — Frontend: `/affiliate` dashboard page

**Context:** Depends on Task 10. Auth-gated pages use `useAuth()`. Stat cards: `frontend/components/admin/stats-card.tsx`. Chart pattern: check `frontend/app/admin/page.tsx` for the exact Recharts usage already in this app and replicate it rather than introducing a new charting approach.

**Files to modify:**
- New: `frontend/app/affiliate/page.tsx`
- Possibly new: `frontend/app/affiliate/loading.tsx` (this app has a per-route `loading.tsx` convention, see `orders/` and `wallet/`)

**Implementation Notes:**
- Gate: redirect to `/login` if `useAuth()` reports no user (match `orders/page.tsx` or `wallet/page.tsx`'s exact guard pattern).
- Fetch via `api.affiliateMe({from, to})`, following this app's existing data-fetching convention (check `hooks/use-orders.ts`; consider a `hooks/use-affiliate.ts` if that's the established pattern for similar pages rather than calling `api` directly in the page component).
- Render: referral link (`{origin}/?ref={code}`) with copy-to-clipboard (reuse an existing button/tooltip component), 4 `stats-card` instances, a date-range control, a Recharts chart for the timeseries, a recent-commissions table (match `orders/page.tsx`'s table styling, or this app's TanStack Table usage if that's the established pattern for similar lists).

**Report file:** `.superpowers/sdd/task-13-report.md`

**Acceptance Criteria:**
- Unauthenticated visit redirects to `/login`.
- Renders without error for a brand-new account with zero activity (empty states, stat cards show 0).
- Copy button copies exactly `{window.location.origin}/?ref={code}`.
- Changing the date-range control triggers a refetch with updated `from`/`to`.
- `npx tsc --noEmit` passes; manually verify in `npm run dev` that the page renders for a logged-in test account.

---

## Task 14 — Frontend: `/admin/affiliates` list + detail

**Context:** Depends on Task 10. Admin pages under `frontend/app/admin/`, wrapped by `AdminLayout`, using `components/admin/AdminShell.tsx`, `pagination.tsx`, `search-input.tsx`. Use `frontend/app/admin/providers/page.tsx` or `frontend/app/admin/products/page.tsx` as the closest structural precedent (list + search + pagination + drill-in).

**Files to modify:**
- New: `frontend/app/admin/affiliates/page.tsx`
- New: `frontend/app/admin/affiliates/[id]/page.tsx` (or a slide-panel via `components/admin/slide-panel.tsx` — match whichever pattern the closest precedent page actually uses)

**Implementation Notes:**
- List: table with email, affiliate_code, clicks, signups, orders, commission total columns; search wired to `adminAffiliates({search})`; pagination matching `admin/products` or `admin/orders`.
- Detail: same stat-card/chart/commissions-table layout as Task 13's `/affiliate` page but via `adminAffiliateDetail(id)` for an arbitrary account. Extract a shared presentational component (e.g. `components/AffiliateStatsView.tsx`) used by both Task 13's page and this detail view, once you see how similar they are — do not duplicate the markup.

**Report file:** `.superpowers/sdd/task-14-report.md`

**Acceptance Criteria:**
- Non-admin session hitting `/admin/affiliates` is blocked/redirected exactly as other `/admin/*` pages (check the guard in `AdminLayout`).
- Search filters without full page reload; pagination works.
- Row click navigates to (or opens) the detail view showing that account's full stats.
- `npx tsc --noEmit` passes.

---

## Task 15 — Frontend: `commission_rate` input on product/category admin forms

**Context:** Depends on Tasks 4 and 10. `frontend/app/admin/products/[id]/page.tsx` is the product edit page. Locate the category-edit UI in admin first (search `frontend/app/admin/` — it may be a sub-view within products admin, or may not exist as a dedicated page).

**Files to modify:**
- `frontend/app/admin/products/[id]/page.tsx`
- Category-edit UI location — locate first; if no category-edit UI exists anywhere in admin, STOP and report back rather than creating new admin scope.

**Implementation Notes:**
- Numeric input labeled "Hoa hồng affiliate (%)" bound to `commission_rate`, optional (blank = inherit), using `components/ui/input.tsx` + the `Field` wrapper pattern (see `register/page.tsx`).
- Client-side validate range 0–100 before submit, matching this form's existing validation style if any.

**Report file:** `.superpowers/sdd/task-15-report.md`

**Acceptance Criteria:**
- Leaving the field blank and saving does not overwrite a previously-set value with null (verify against the running backend, not just assumed).
- Value outside 0–100 rejected client-side with a visible message.
- `npx tsc --noEmit` passes.

---

## Task 16 — Frontend: `TopNav` affiliate link

**Context:** Depends on Task 13 (route must exist). `frontend/components/TopNav.tsx` is role-aware — check its existing conditional-rendering pattern for authenticated vs anonymous and role-specific links.

**Files to modify:**
- `frontend/components/TopNav.tsx`

**Implementation Notes:**
- Add an "Affiliate" link to `/affiliate`, shown for ANY authenticated user (buyer, seller, admin all have an affiliate code per spec) — do not restrict to one role.
- Use the same active-state detection (`usePathname()` comparison) already used for other nav links.

**Report file:** `.superpowers/sdd/task-16-report.md`

**Acceptance Criteria:**
- Link absent for anonymous visitors.
- Link present for buyer, seller, and admin roles alike.
- Active-state styling applies on `/affiliate`.
- `npx tsc --noEmit` passes.
