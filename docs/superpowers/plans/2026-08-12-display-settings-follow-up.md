# Display settings — follow-up checklist

Status: review after restarting the frontend dev server on 2026-08-12.

## Route and naming

- [x] Rename the admin route from `/admin/money` to `/admin/display-settings`.
- [x] Rename its navigation label to **Hiển thị cho khách** / **Customer display settings** so it covers currency and language controls, not accounting or payments.
- [x] Preserve `/admin/money` as a redirect to the new route, so existing bookmarks keep working.

## Remaining fixes

- [x] **P1 — Retry public display config after an SSR fetch failure.**
  - `loadMoneyConfig()` returns `null` on SSR failure; first paint uses `MONEY_CONFIG_FALLBACK`.
  - `CurrencyProvider` client-fetches `/api/public/money-config` when `initialConfig === null` and upgrades rate/flags without a full layout reload.

- [x] **P2 — Prevent horizontal overflow in the Orders pagination at 320px.**
  - Below `sm`: compact `‹ page/total ›` (no intermediate page buttons).
  - `sm+`: full windowed Previous / numbers / Next.
  - Per-page select remains on its own row under pagination.

## Passed regression checks

- [x] After restarting the FE dev server, the Orders and admin pages render translated text rather than raw `orders.*` / `currency.*` keys.
- [x] No console warnings/errors after loading `/en/orders` at 320px.
- [x] Opening an order's **Payment details** does not trigger proxy fetches; initial Orders network calls contain no `/proxy` 404s.
- [x] Product checkout and wallet were previously checked at 320px with no VND/PayOS explanation exposed in the purchase UI.

## UX decision retained

- [x] Removed the global old-order rate banner from Orders. Historical/purchase display rate lives only inside per-order **Payment details** (USD view).
