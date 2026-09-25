# Seller trust score & automatic tiers — plan

> **Status:** design review (mockup). Nothing below is implemented yet.
> **Checklist row:** "Có thuật toán tự động tính điểm Trust (GMV, tỷ lệ Dispute, số Rate 1 sao) không? Seller Level thấp có bị giới hạn…" — tier levers exist; the automatic trust score and promotion/demotion are missing.

## What exists on `main` today

- Four tiers `new / verified / trusted / enterprise` on `accounts.seller_tier`, assigned by admins by hand (`auth.service.update_seller_tier`, `PATCH /admin/accounts/{account_id}/tier`).
- Per-tier levers in `seller_tier_config` (active-product cap, withdrawal ceiling, fee discount, escrow reduction), read through `marketplace-svc/src/sellers/tier_config.py`, edited in Admin › Cài đặt › Người bán (`frontend/features/admin-seller-config/ui/SellerTierPanel.tsx`), exposed publicly at `GET /public/seller-tiers`.
- Seller sees the current tier and its levers only in Tài khoản › Người bán (`frontend/features/account/ui/SellerTab.tsx`); no progress toward the next tier.
- Buyers see the tier badge on the shop page (`frontend/app/[locale]/sellers/[key]/SellerProfileView.tsx`).
- Dispute rate and review averages are computed per date range in `marketplace-svc/src/seller/dashboard.py` (seeded/demo orders excluded via `Order.is_seeded`).

## Decisions (2026-09-25)

1. **Buyer side:** only sellers have tiers. Buyers see the seller's tier + trust score; no buyer tier system.
2. **Automation:** meeting all criteria of the next tier → auto promote one step. No longer meeting the "keep" criteria of the current tier → warning, grace period (admin-set, default 14 days), then demote one step. A tier set by an admin by hand is **locked** (the job never changes it until unlocked). `enterprise` is admin-only.
3. **Process:** mockup canvas first, code after review.

## Mockup

Design canvas (6 boards): https://claude.ai/artifact/GnYWYLTtgxEkczabLCnMV9
Source files are mirrored in `docs/mockups/seller-trust-tier/` (`canvas.json` + one `.dc.html` per board).

| Board | Surface |
|---|---|
| `Main.dc.html` | Seller › new tab "Hạng & uy tín" (`/seller/tier`): tier ladder, score gauge, 6 criteria with progress, score breakdown, benefits current → next |
| `SellerStates.dc.html` | Compact card on seller overview; warning/grace state; not-enough-data, admin-locked, top-auto-tier states; notifications |
| `SellerMobile.dc.html` | Same page at 390 px |
| `Buyer.dc.html` | Shop page "Uy tín 72" chip + explainer popover; seller box on product page (3 cases) |
| `AdminConfig.dc.html` | Admin › Cài đặt › Người bán › "Xét hạng tự động": schedule knobs, criteria per tier, score formula, impact preview |
| `AdminSeller.dc.html` | Admin › account › "Hạng & uy tín": breakdown, manual tier + lock + reason, re-evaluate now, tier history |

## Proposed rules (defaults; every number admin-editable)

**Trust score 0–100**, computed over a rolling window (default 90 days), real (non-seeded) orders only:

| Component | Max points | Formula |
|---|---|---|
| Dispute rate (disputes / orders in window) | 40 | `40 × max(0, 1 − rate / 10%)` |
| 1-star rate (1★ reviews / reviews in window) | 30 | `30 × max(0, 1 − rate / 20%)` |
| GMV of completed orders in window | 30 | `30 × min(1, log(1+gmv) / log(1+100 000 000))` |

Weights must sum to 100. Fewer than 10 completed orders in the window → "Chưa đủ dữ liệu" (no score; the score criterion is skipped).

**Criteria per tier** (empty = not checked):

| Criterion | verified | trusted | enterprise | Also "keep" check |
|---|---|---|---|---|
| Completed GMV, lifetime (₫) | 5 000 000 | 50 000 000 | — | no |
| Completed orders, lifetime | 20 | 200 | — | no |
| Days since approved to sell | 14 | 60 | — | no |
| Max dispute rate (window) | 5 % | 3 % | 2 % | yes |
| Max 1-star rate (window) | 10 % | 5 % | 3 % | yes |
| Min trust score | 60 | 75 | 85 | yes |
| Auto-promote | on | on | off (admin only) | — |

**Job:** daily 03:00 Asia/Ho_Chi_Minh. Promote at most one step per run; demote at most one step, only after the grace period expires. Every change → audit log + notification (+ mail) to the seller.

## Open question

- Should buyers see exact dispute / 1-star percentages, or bands (Thấp / Trung bình / Cao) as drawn?

## Implementation sketch (after mockup approval)

Backend (`marketplace-svc/`):
- Alembic revision: criteria + score-formula columns (extend `seller_tier_config` or a new singleton `seller_trust_config`), `accounts.seller_tier_locked`, a `seller_trust_snapshots` table (score, components, evaluated_at), a grace/warning record, and a `seller_tier_events` history table. Check the main tree for the current alembic head first.
- `src/sellers/trust.py`: pure scoring + evaluation (`evaluate_seller`) over SQL aggregates reusing the `REAL_ORDERS` rule from `seller/dashboard.py`.
- Scheduler job in `src/scheduler.py`; `update_seller_tier` sets the lock and writes an event.
- Endpoints: `GET /seller/tier-progress`, public trust fields on the seller profile/product seller box, `GET/PATCH /admin/seller-trust-config`, `POST /admin/seller-trust-config/preview`, admin per-seller detail + re-evaluate + lock.
- Tests: scoring maths, promotion, grace → demotion, lock respected, seeded orders ignored, admin-only config, seller sees only own progress.

Frontend (`frontend/`):
- `/seller/tier` page + overview card (seller-only components under the seller tree), shop chip/popover and product seller box, admin "Xét hạng tự động" tab, admin account tab; `vi` + `en` messages; `npm run lint`, `npm run check:i18n`, `npm test`; browser check desktop + 390 px.
