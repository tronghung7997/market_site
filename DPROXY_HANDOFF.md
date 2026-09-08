# DProxy M2M implementation handoff

Last updated: 2026-09-08 (Asia/Ho_Chi_Minh)

This document is the continuation brief for another coding agent. It describes
the current dirty worktree; it is not a statement that the changes have been
committed or are ready to merge.

## Repository state

- Repository: `/Users/logan/source/market_site`
- Branch: `feat/dproxy-m2m-purchase`
- HEAD when this handoff was written: `127444d7869e3a51db0f03a772ba1cf2e50e85ad`
- Codebase-memory project: `Users-logan-source-market_site`
- Codebase-memory generation inspected: `2026-09-08T07:08:54Z`, status `ready`
- The worktree is dirty. Do not reset, clean, checkout, or overwrite changes.
- Never inspect or copy values from `.env*`, credential backups, API keys, local
  tokens, cookies, or `pgdata/`.

Current `git status --short` at handoff time:

```text
 M .DS_Store
 M docs/dproxy-mock-runbook.md
 M frontend/.env
 M frontend/app/[locale]/admin/providers/page.tsx
 M frontend/components/DynamicOrderForm.tsx
 M frontend/components/PricingParamsEditor.tsx
 M frontend/messages/en.json
 M frontend/messages/vi.json
 M marketplace-svc/scripts/mock_dproxy.py
 M marketplace-svc/src/adapters/dproxy.py
 M marketplace-svc/tests/test_dproxy_adapter.py
 M marketplace-svc/tests/test_dproxy_orders.py
 M marketplace-svc/tests/test_mock_dproxy.py
 M marketplace-svc/tests/test_seller_mock_e2e.py
?? .gemini/
?? marketplace-svc/.env.bak-now-e2e-20260813173233
?? uv.lock
```

`.DS_Store`, `.env`, `.gemini/`, the environment backup, and `uv.lock` are not
part of the intended DProxy implementation. Preserve them and do not include
them in a DProxy commit without explicit user instruction.

## Goal and domain decision

The goal is a clear DProxy M2M workflow:

```text
Admin creates DProxy connection
  -> tests connection and loads upstream catalog
  -> maps an upstream plan to type + country/network + duration
  -> attaches a marketplace product
  -> seller/admin enters the final buyer price
  -> buyer purchases exactly one proxy
  -> marketplace calls DProxy partner-purchase
  -> order is delivered and escrow is held
```

The current marketplace config-pricing formula is:

```text
base_price * type_mult * network_mult * days / 30 * quantity
```

DProxy is plan-based and uses exact keys such as
`residential|VN|7 -> <plan UUID>`. Independent type/network/duration arrays form
a Cartesian product in the buyer UI. Therefore the intended product model is
**one marketplace product per DProxy plan**. This prevents buyers from choosing
a combination that has no upstream `plan_id`.

Do not silently fall back to a default DProxy plan when an explicit `plan_ids`
matrix exists. Delivering a different type, country, or duration from what the
buyer purchased is a contract violation.

## Implemented backend and mock changes

### `marketplace-svc/scripts/mock_dproxy.py`

- Implements the stateful DProxy-shaped M2M fake.
- Supports both Bearer auth and `X-API-Key` for local integration testing.
- `POST /api/v1/customer/marketplace/partner-purchase` accepts exactly one
  proxy, creates a fresh assignment, and returns the documented M2M response.
- The returned `data.order_id` is a stable UUID derived from
  `partner_order_id`; it is deliberately different from assignment UUIDs.
- Replaying the same `partner_order_id` returns the original response and does
  not create another upstream order.
- Control endpoints support reset, catalog replacement, assignment mutation,
  and deterministic failure modes.

Default local mock contract:

```text
Base URL: http://127.0.0.1:9201
Provider credential: mock-dproxy-token
Control header: X-Mock-Control-Key: mock-dproxy-control
Channel: proxora
Residential VN 7d: 1906e1af-70df-4a53-8874-53b8e5a51935
Datacenter US 30d: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
```

These are fake local constants, not production secrets.

### `marketplace-svc/src/adapters/dproxy.py`

- Validates each `plan_ids` key as exactly `type|network|positive_days` and each
  value as a UUID.
- Treats an explicit plan matrix as authoritative; an unknown combination
  returns no plan instead of falling back to `plan_id`.
- Sends the marketplace order ID into provider call logging for M2M purchases.
- Validates that the response `partner_order_id` matches the request.
- Uses `proxora-{marketplace_order_id}` as the stable upstream idempotency key.
- On provisioning retry, replays the same partner purchase and verifies the
  returned upstream order UUID matches the existing allocation. It never
  assumes DProxy's M2M order UUID is an assignment UUID from `/proxies/user`.
- A successful purchase binds exactly one `ProxyAllocation` to the order.
- Auth and contract failures return whitelabel buyer errors; transient provider
  errors continue through the existing retry/refund lifecycle.

### Backend tests

Coverage was added/updated in:

- `marketplace-svc/tests/test_dproxy_adapter.py`
- `marketplace-svc/tests/test_dproxy_orders.py`
- `marketplace-svc/tests/test_mock_dproxy.py`
- `marketplace-svc/tests/test_seller_mock_e2e.py`

Important cases include malformed mapping keys, no fallback from an explicit
matrix, mismatched `partner_order_id`, documented purchase response shape,
auth variants, idempotent retries, one allocation per order, provider call
logging, and seller visibility of a buyer order.

## Implemented frontend changes

### `frontend/app/[locale]/admin/providers/page.tsx`

- DProxy provider setup is presented as a four-step readiness flow:
  connection details, test/load catalog, map plans, attach/price product.
- Normal setup asks for API URL and API key first. Auth/header/channel/raw JSON
  are under an advanced disclosure.
- New DProxy providers default to:

  ```json
  {
    "base_url": "https://api.dproxy.info",
    "auth_type": "header",
    "auth_header": "X-API-Key",
    "channel": "proxora"
  }
  ```

- Testing saves the currently visible form config before calling the provider
  test endpoint. This fixes tests accidentally using stale database config.
- The catalog mapper lets admin enable a DProxy plan and enter internal proxy
  type, country/network, and duration without writing raw `plan_ids` JSON.
- Saving a configured DProxy connection advances to linked products instead of
  closing the workflow.
- For a DProxy-linked product, the pricing editor asks for one mapped plan and
  the final price paid by the buyer. It generates backend-compatible config
  pricing parameters automatically.

### `frontend/components/PricingParamsEditor.tsx`

- Rewords the generic config pricing fields in business language.
- Explains that base price means the standard 30-day price.
- Shows a preview of exact buyer-facing prices for configured combinations.

### `frontend/components/DynamicOrderForm.tsx`

- DProxy config purchases are constrained to one proxy per order.
- Buyer copy describes automatic delivery and does not promise unsupported M2M
  rotation.

### Locales

`frontend/messages/vi.json` and `frontend/messages/en.json` include matching
keys for the pricing explanation and buyer-price preview.

## Live E2E evidence

The latest direct Chrome DevTools scenario used the local mock, real FastAPI,
real Next.js same-origin BFF, PostgreSQL, and the buyer UI.

Services observed running:

```text
Frontend: http://127.0.0.1:3000
Backend:  http://127.0.0.1:8001
DProxy:   http://127.0.0.1:9201
```

The mock was reset before the purchase. The buyer then opened product `#29`,
selected Residential + VN + 7 days, and confirmed one purchase.

Observed result:

- Marketplace order: `#140`
- `POST /api/orders`: `201`
- Request selection: type `residential`, network `VN`, days `7`, quantity `1`,
  package size `1`
- Charged amount: `21,000` VND; buyer display balance decreased by the matching
  `0.81 USD` snapshot value
- Lifecycle: `pending -> delivered`
- Order view: product `DProxy Test — Proxy xoay IP demo`, quantity `1`, status
  `Đã giao`, escrow held
- Mock state after purchase: `order_count = 1`, assignments increased from 3
  to 4
- Delivered proxy used mock documentation IP `203.0.113.14`; credentials were
  visible only to the authenticated buyer and are intentionally omitted here
- All relevant same-origin pricing, order, wallet, and order-detail requests
  returned success
- Console showed only the expected unauthenticated `/api/me` 401 requests from
  before login; no application error occurred during purchase or delivery

An earlier direct DProxy buyer E2E produced order `#139` and also confirmed one
mock partner purchase, wallet deduction, delivery, and no application console
error. Order `#140` is the clean reset-and-buy verification for this handoff.

## Verification already run

Do not claim these checks for a later diff without rerunning the relevant ones.

```text
frontend/npm run lint       PASS
frontend/npm run check:i18n PASS
frontend/npm test           PASS (100 tests)
git diff --check            PASS
```

Latest targeted backend command:

```bash
cd marketplace-svc
uv run pytest -q tests/test_mock_dproxy.py tests/test_dproxy_orders.py \
  -k 'partner_purchase or provision_purchases_fresh_assignment_matching_buyer_choice or idempotent_retry_does_not_purchase_a_second_proxy'
```

Result:

```text
5 passed, 26 deselected in 17.68s
```

Backend tests share `marketplace_test`; never run multiple pytest processes in
parallel.

## Known gap to fix next

The current live product `#29` still exposes independent choices for two proxy
types, two countries, and several durations. Only specific combinations have a
DProxy plan mapping. For example, Datacenter + VN is visible even though it has
no matching upstream plan. The valid Residential + VN + 7-day path passes E2E,
but unsupported combinations can still reach calculation/order UI and then
fail provisioning.

The next agent should make the buyer form plan-aware. Recommended smallest
coherent fix:

1. For a DProxy-linked product, expose only the exact mapped plan assigned to
   that product; do not render independent cross-product options.
2. Prefer a product payload or pricing-options contract that provides allowed
   tuples, rather than inferring provider configuration in the browser.
3. Enforce the same allowed tuple in the backend price/order path. UI filtering
   is not authorization or contract validation.
4. Add success, invalid-combination, and unauthorized tests where applicable.
5. Re-run targeted frontend checks, targeted backend tests serially, and a live
   DevTools purchase at desktop and mobile widths.

Do not solve this by restoring fallback to a default plan.

## Suggested continuation checklist

1. Read root `AGENTS.md`, `README.md`, `DESIGN.md`, frontend `AGENTS.md` and
   `ARCHITECTURE.md`, and backend `AGENTS.md` and `ARCHITECTURE.md`.
2. Run `git status --short`; preserve every pre-existing change listed above.
3. Use codebase-memory project `Users-logan-source-market_site` first and call
   `check_index_coverage` for every operated-on code path. The docs directory is
   excluded from the graph by gitignore, so read documentation directly.
4. Inspect the product pricing-options route, buyer `DynamicOrderForm`, order
   price calculation, and order creation validation before changing a contract.
5. Keep browser calls same-origin under `/api`; do not expose provider secrets
   or backend access tokens to the browser.
6. Start/reset the mock using `docs/dproxy-mock-runbook.md`.
7. Run backend pytest serially only.
8. Use Chrome DevTools to inspect request payloads, responses, console, network,
   order delivery, wallet delta, and mock `order_count`.
9. Update the runbook when behavior changes.

## Primary references

- DProxy source docs: `docs/dproxy/api.md`, `docs/dproxy/openapi.json`, and
  `docs/dproxy/User-Proxy-APIs-M2M-Purchase.rtf`
- Local test instructions: `docs/dproxy-mock-runbook.md`
- DProxy mock: `marketplace-svc/scripts/mock_dproxy.py`
- Production adapter: `marketplace-svc/src/adapters/dproxy.py`
- Admin/provider UI: `frontend/app/[locale]/admin/providers/page.tsx`
- Buyer form: `frontend/components/DynamicOrderForm.tsx`
- Generic pricing editor: `frontend/components/PricingParamsEditor.tsx`
