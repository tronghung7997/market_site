# Display currency — final review checklist

Scope: buyer-facing currency is a display preference independent of EN/VI. Ledger and PayOS settlement remain VND for now. Do not reintroduce VND/payment-rail explanations into catalog or checkout.

## Must fix before merge

- [ ] **Show the historical rate per order without adding noise.**
  - Keep the current page-level legacy notice only as a short heads-up.
  - Add a collapsed `Payment details` / `Chi tiết thanh toán` section to each buyer order.
  - For an order with `display_fx_rate_snapshot`, show: `Display rate at purchase: 1 USD = {rate} VND`.
  - For an old order with a null snapshot, show: `Historical display rate: 1 USD = 26,000 VND`.
  - Do not show this on every collapsed card, in catalog, or at checkout.
  - Relevant code: `frontend/app/[locale]/orders/OrderCard.tsx`, `frontend/app/[locale]/orders/page.tsx`, `frontend/lib/money/format.ts`.

- [ ] **Eliminate first-visit currency flash.**
  - `CurrencyProvider` already accepts `initialConfig`, but `layout.tsx` only passes the currency cookie.
  - Resolve the public money config on the server and pass it as `initialConfig`; preserve the cookie as the user's preference and highest UI preference.
  - Verify a new visitor gets the admin-selected default on the first SSR paint, not after client fetch.
  - Relevant code: `frontend/app/[locale]/layout.tsx`, `frontend/lib/money/CurrencyProvider.tsx`.

- [ ] **Rewrite the Vietnamese admin copy in plain Vietnamese.**
  - Replace technical/mixed terms: `buyer`, `Admin override`, `storefront`, `switcher`, `preference`, and `Reset tỷ giá`.
  - Recommended hierarchy/copy:
    - Title: `Cài đặt hiển thị giá`
    - Subtitle: `Chỉ thay đổi cách khách nhìn thấy giá. Không ảnh hưởng số dư hoặc thanh toán.`
    - `Admin override` → `Đang dùng cấu hình quản trị`
    - `Mặc định ENV` → `Giá trị từ môi trường`
    - `Reset tỷ giá` → `Dùng lại giá trị ENV`
    - `Trải nghiệm mặc định` → `Tuỳ chọn cho khách`
  - Separate two groups explicitly: `Tiền tệ` and `Ngôn ngữ`.
  - Relevant code: `frontend/messages/vi.json`, `frontend/app/[locale]/admin/money/page.tsx`.

- [ ] **Fix horizontal overflow on small mobile.**
  - DevTools result: at both 320px and 375px, document width is 431px.
  - Move the orders-per-page select below pagination or hide it on narrow screens.
  - At <=375px, keep only menu, logo, notifications, and avatar in the top nav; move Top up into the menu.
  - Verify `document.documentElement.scrollWidth === clientWidth` at 320, 375, 414, and 768px.
  - Relevant code: `frontend/app/[locale]/orders/page.tsx`, `frontend/components/TopNav.tsx`.

## UX polish

- [ ] **Flatten the admin settings layout.**
  - The `Default experience` card currently contains two extra bordered mini-cards for toggles.
  - Replace them with simple setting rows separated by dividers: title + one-line description + toggle aligned right.
  - Keep one visual containment level; do not add more cards.
  - Relevant code: `frontend/app/[locale]/admin/money/page.tsx`.

- [ ] **Limit motion to the properties that change.**
  - Replace `transition-all` with explicit `background-color`, `color`, and, where needed, `box-shadow` transitions.
  - Relevant code: `frontend/components/CurrencyToggle.tsx`, `frontend/components/TopNav.tsx`, `frontend/app/[locale]/admin/money/page.tsx`.

- [ ] **Keep payment-rail wording only in Wallet.**
  - Product/catalog/checkout: show only the selected display currency; no VND, rate, or PayOS disclaimer.
  - Wallet Add funds: show the current rail clearly (`Bank transfer via PayOS`) and the actual transfer amount in VND.
  - Keep the deposit UI rail-agnostic in structure so a future USDT provider can replace the PayOS copy and action without changing buyer price display.
  - Relevant code: `frontend/app/[locale]/wallet/DepositCard.tsx`, `frontend/lib/money/format.ts`.

## Reliability and cleanup

- [ ] **Make singleton config seeding concurrency-safe.**
  - Two first requests can both seed `display_money_config(id=1)` and conflict.
  - Use an insert/upsert with conflict handling, then re-read the row.
  - Relevant code: `marketplace-svc/src/money/service.py`.

- [ ] **Stop proxy 404 fan-out on Orders.**
  - Runtime testing shows each non-proxy order requests `/orders/{id}/proxy`, causing repeated 404s.
  - Only fetch proxy state for orders whose product/provider supports it, or render the proxy panel lazily after user action.

## Acceptance checks

- [ ] EN/VI language selector and USD/VND currency selector operate independently when enabled.
- [ ] Default display currency comes from admin/ENV on first visit; existing `display_currency` cookie wins afterwards.
- [ ] New orders persist and expose their own snapshot rate; pre-rollout orders use fixed legacy 26,000 only in payment details.
- [ ] Checkout total is calculated from raw VND total, then formatted once (e.g. 50,000 x 2 at 26,000 = `$3.85`, not `$3.84`).
- [ ] No VND or FX copy appears in catalog, product cards, checkout panel, confirmation modal, or buyer order card summary.
- [ ] Wallet makes the PayOS bank-transfer flow and VND amount unambiguous.
- [ ] No horizontal scroll at 320, 375, 414, or 768px.
- [ ] Run `uv run pytest -q tests/test_money_config.py` in `marketplace-svc`.
- [ ] Run `node scripts/test-money.mjs` and `npm run build` in `frontend`.
- [ ] Re-test product, wallet, orders, and `/vi/admin/money` with DevTools; do not create real orders or save admin settings during verification.

## Review status

- Existing positive checks: money formatter tests passed, backend config tests passed, and production frontend build completed.
- Hallmark audit: avoid nested setting cards and `transition-all`; no critical visual anti-pattern found.
