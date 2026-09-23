# Proxora Backend Architecture

> **Status:** target contract · migration in progress
> **Scope:** `marketplace-svc/` module seams, transactions, adapters, and dependency direction
> **Domain supplement:** read [`../CONTEXT.md`](../CONTEXT.md) for chat changes
> **Rule:** new and touched code follows the target; legacy imports are not precedent.

The backend is a modular FastAPI application, not a collection of isolated CRUD routers. Each feature should expose a small application interface that owns its invariants and transaction behavior.

## 1. Architectural objective

Build **deep modules**: substantial domain behavior behind a small interface at a clean seam.

- **Module:** a feature, function, scheduler workflow, or integration with one interface.
- **Interface:** callable behavior plus invariants, errors, ordering, transaction, and performance expectations.
- **Implementation:** code hidden behind that interface.
- **Seam:** where the interface lives.
- **Adapter:** a production or test implementation at a seam where behavior genuinely varies.

Do not add layers for their own sake. One adapter with no real alternative is speculative indirection. Production plus a test adapter is a real seam for remote or third-party systems.

## 2. Current and target shape

The existing feature packages commonly contain:

```text
src/<feature>/
├── router.py       # HTTP adapter
├── schemas.py      # request/response contract
└── service.py      # application/domain interface and implementation
```

This shape remains valid. New repositories, use-case classes, ports, or DTO layers are not mandatory. Deepen the existing feature module before adding another layer.

Target flow:

```text
HTTP router
    ↓
feature service interface
    ↓
domain rules + AsyncSession transaction
    ↓
SQLAlchemy models / owned feature collaborators

feature service ──→ external port ──→ production adapter
                              └─────→ test adapter
```

## 3. Responsibilities

### `router.py`

The HTTP adapter owns:

- path, query, header, cookie and body parsing;
- authentication/authorization dependency wiring;
- request/response schema selection;
- translation from application errors to HTTP errors;
- calling one owning application interface.

Routers remain thin. They do not coordinate provider adapters, mutate several domain modules, or implement financial state transitions inline. Cross-feature workflows belong in an owning service/module.

Only `src/main.py` is the router composition root.

### `service.py`

The feature service is the default application seam. It owns:

- authorization that protects domain resources;
- domain invariants and state transitions;
- idempotency behavior;
- transaction and locking scope;
- collaboration with other feature interfaces;
- audit events that are part of the operation;
- observable application errors.

A service may use SQLAlchemy models directly. Do not create a pass-through repository unless persistence genuinely varies or a deeper interface removes complexity from multiple callers.

Services do not depend on FastAPI routers. Prefer domain/application exceptions over `HTTPException`; translate at the HTTP seam.

### `schemas.py`

Schemas define transport contracts. They may depend on stable enums/value types but do not import router or service implementations. Transport DTOs are not automatically the domain model.

### `models/`

SQLAlchemy models define persistence shape, constraints, relationships, and persistence-level enums. They do not depend on FastAPI or feature service/router implementations.

Persistent invariants use database constraints where possible and useful application validation for clear errors. Every schema change requires Alembic.

### `adapters/` and external clients

Third-party and remote systems are true external dependencies.

- Define the smallest useful port at the owning seam.
- Inject/select a production adapter in composition code.
- Use a deterministic fake/mock adapter in tests.
- Keep timeout, retry, idempotency, verification, and failure mapping inside the integration module.
- Never let a router orchestrate an adapter directly.

Do not leak provider payloads throughout feature services. Normalize them into an owned result type.

### Cross-cutting modules

`auth`, `security`, `errors`, `money`, `audit`, `observability`, `i18n`, `mail`, and `ai` are shared because their semantics must be consistent. They must expose narrow interfaces and must not become general dumping grounds.

`mail` owns the transactional outbox and outbound adapters (log / SMTP / Resend). Feature services call `mail.enqueue_mail` in the same transaction as the domain mutation. They must not import mail adapters. Sending is outbound-only; inbound ports are not required.

Operational mail knobs (`provider`, `mail_from`, `mail_from_name`, `worker_enabled`) live in singleton `mail_runtime_config` (env is bootstrap/reset only), using the shared `runtime_config.ProcessConfigCache`. Subject/body copy lives in `mail_templates` (template+locale), seeded from the code catalog; admin may edit copy but cannot add template ids. Provider secrets (`RESEND_API_KEY`, SMTP password) stay in env and are never returned by admin APIs — only boolean configured flags. Admin HTTP for mail config, templates, send-test, and outbox listing lives in `mail.router`; adapters remain behind `mail.factory`.

`search` owns storefront search orchestration (`GET /search/suggest`, `GET /search`). It calls the owning features' search interfaces (`products.service.suggest_products` / `list_products(sort="relevance")`, `categories.service.search_categories`, `sellers.service.search_sellers`) and adds the cross-cutting guarantees: one query normalisation (`i18n.search_text`), a per-request `statement_timeout`, a bounded `KeyedProcessCache`, per-IP rate limiting and group-specific minimum lengths. Matching is diacritic/case-insensitive and typo-tolerant through generated `search_text` columns on `products` / `categories`, an expression index on `seller_applications.business_name`, and `pg_trgm` + `unaccent` (`immutable_unaccent`). Only active products, active categories and approved sellers with active products are visible; product hits carry no row ids.

`content_filter` owns the admin-editable off-platform contact filter (`content_filter_config` singleton: keywords, phone/link patterns, block-or-mask). Buyer ↔ seller text (`chat` inquiries and messages, dispute reason / buyer messages / seller notes) passes through `screen_text` before it is stored; Marketplace support chat and admin messages are exempt. A hit is written to `log_entries` in its own transaction (so a blocked request still leaves a trace) and "block" surfaces as `CONTENT_BLOCKED` at the HTTP seam.

`affiliate` reads its programme knobs from `affiliate_runtime_config` (`affiliate.settings`; env only seeds row 1). Commission is `rate × platform fee` of the settled order (`escrow_settlement` with the seller's tier fee), never a share of the order total; `affiliate_commissions.fee_base_amount` records that base. `/public/affiliate-config` exposes only what the storefront needs (attribution window for the `?ref=` cookie).

`auth` owns sign-up verification: `register_account` mails an `email_verify` link (`email_verification_tokens`, hashed, one-shot, lifetime from `auth_runtime_config.verification_link_hours`); `POST /auth/verify-email` sets `accounts.email_verified_at`, `POST /auth/verify-email/resend` reissues (rate-limited per account), admins may vouch by hand. The `require_verified_email` dependency gates order creation, deposits and withdrawals when `auth_runtime_config.require_email_verification` is on (Settings › Accounts; env `EMAIL_VERIFICATION_REQUIRED` only seeds it). Browsing and signing in are never gated; accounts that predate the feature were backfilled as verified.

`auth.mfa` owns TOTP two-factor: the secret is Fernet-encrypted in `accounts.totp_secret`, `totp_enabled_at` marks a confirmed setup, backup codes are stored as sha256 hashes and consumed on use. Sign-in for an enabled account returns `{mfa_required, mfa_token}` (5-minute `purpose=mfa` JWT) and `POST /auth/login/2fa` swaps it plus a code for a session; the BFF passes the challenge through without setting cookies. Policies live in `auth_runtime_config`: `mfa_feature_enabled` is the marketplace-wide switch (ships off — no setup, no sign-in challenge, policies inert), `require_admin_2fa` makes `require_role("admin")` answer `MFA_SETUP_REQUIRED` until the admin enables TOTP (the frontend `AdminMfaGate` sends them to `/account/security`), `require_2fa_for_withdrawal` makes `POST /wallet/withdraw` demand `totp_code`. Signed-in security actions (`/auth/change-password` — revokes other sessions; `/auth/change-email` — confirm from the new mailbox via `email_verification_tokens.new_email`, notice to the old one) and Cloudflare Turnstile (`security.turnstile`, enforced on register/login/forgot only when both the admin site key and env `TURNSTILE_SECRET_KEY` exist; `/auth/admin/login` is exempt because the console is reached from an internal network without Cloudflare access and is already IP-allowlisted and rate-limited) complete the account-security seam.

`auth` records every login attempt against an existing account, and every admin lock/unlock, in `login_events` (IP, user agent, outcome). `PATCH /admin/accounts/{id}/status` flips `is_active` and revokes all sessions on lock. The end-user IP is `security.client_ip.request_client_ip`: the BFF forwards it as `X-Client-IP`, honoured only on a BFF-signed request; `RequestIdMiddleware` binds it into the log context so `audit.log_event` stamps `ip` on every business event.

`suppliers` owns upstream sources managed from `/admin/sources` (and `/seller/sources`, internal sellers only — `accounts.is_internal` is checked by the router, not just hidden in the UI). Catalog sources (`AdapterSpec.external_stock`, igbm) sell through `supplier_listings`; proxy sources (`AdapterSpec.proxy_source`, DProxy/TopProxy) sync a plan catalog into `supplier_catalog_items` and sell through config-pricing `plan_prices` (`suppliers/proxy_sources.py`). DProxy's provider-wide `plan_ids` matrix is written only by `_merge_plan_ids` (row lock, 409 on a conflicting key, audit). Every price save of a proxy-source product passes `enforce_offer_margins` (cost from the synced catalog, USD converted at the display rate). Providers of non-seller-registrable adapters owned by an internal seller keep admin trust (`adapters/factory.py::_seller_owned`) and cannot be edited from the seller side. Upstream revocations (DProxy `partner-dispute`) are never sent inside a refund transaction: `resources/proxy_service.enqueue_upstream_revocation` writes an `upstream_revocations` row in the caller's transaction and `scheduler.upstream_revocation_job` sends it after commit with backoff, raising `upstream_revoke_failed` when it gives up. New critical incidents are also mailed to active admins (`alerts.service._mail_admins`, template `ops_incident`).

`proxies` owns the buyer proxy dashboard (`/me/proxies`, `/me/proxy-tags`, contract in `docs/proxy-dashboard-api.md`). A line is one `proxy_allocations` row addressed as `{order_code}#01`; tags use `public_key`. Proxy "kind" is three fixed dimensions (`proxies/kinds.py`): `ip_type` and the plan/network labels are frozen onto the allocation at delivery by `snapshot_line_kind` (called from `orders.service._apply_provision_result` for every adapter — DProxy and TopProxy alike), while `rotation` is `rotating_key` when frozen (TopProxy key) and otherwise read from the live `rotation_available`. Rotate and whitelist stay on the per-order endpoints in `resources/proxy_router.py`. Payloads never carry `adapter_type`, provider names or row ids.

`site_status` owns the operational switches in `site_runtime_config` (Settings › System): maintenance mode, the three money kill-switches and the announcement bar. `maintenance_gate` is an app-wide dependency answering 503 `MAINTENANCE` to every non-admin caller except health, `/public/*`, payment webhooks, provider callbacks, the gateway and the sign-in/2FA endpoints; `pausable()` wraps the money-moving scheduler jobs (escrow release, dispute timeouts, SLA refunds, provisioning, DProxy reconciliation) so they skip while maintenance is on. `require_orders_open / require_deposits_open / require_withdrawals_open` are called by the owning routers. `/public/site-status` exposes the flags plus the live announcement (never the internal freeze reason); every flip is an audit row.

`resources.data` is encrypted at rest: the column type `EncryptedText` Fernet-encrypts on write and decrypts on read under `ENCRYPTION_KEY`, so never filter or compare on it in SQL. `resources.data_hash` (keyed HMAC-SHA256 of the normalised content under a subkey of the same key, unique over the whole table) makes one credential impossible to list twice or re-sell after delivery: `bulk_add_resources` reports `skipped_market` for lines already held by any package or seller, edit/restock answer 409 `RESOURCE_DUPLICATE`, and the model computes the digest in `before_insert/before_update` so every writer is covered. A supplier re-delivering a line the marketplace already holds gets a salted digest plus a `supplier_duplicate_delivery` warning instead of a failed order. Migration `fg…` backfilled the digest and re-keyed pre-existing duplicates (oldest copy keeps the plain digest, later unsold copies archived; counts in log_entries `resource_dedup_migration`). Migration `fx…` encrypted existing rows, re-keyed the digests as HMAC and added `resources.data_lookup` (keyed digest of the first `|` field): seller and dispute search match that field exactly, case-insensitively — substring search over content no longer exists. Seller stock lists return only a server-masked `data_preview`; the full line comes from `GET /seller/resources/{id}/data`, rate limited per seller and audited as `seller_resource_revealed` (exports log `seller_inventory_exported`). Rotating `ENCRYPTION_KEY` must go through `scripts/rotate_encryption_key.py`, which re-encrypts and re-keys resources together with provider credentials.

`ledger` is the nightly books check (03:30, `ledger_reconcile_job`, also `POST /admin/ledger/reconcile-runs`): it recomputes each wallet's available/locked balance from `transactions` (`TRANSACTION_DIRECTION`), every order's hold / refund / settlement from the `order-<id>` references, and the platform identity `Σ available + Σ locked + Σ open escrow == Σ money in − Σ money out`. Each mismatch is a critical `ledger_mismatch` incident fingerprinted `ledger:<wallet|order|platform>:<id>` (reruns bump `occurrence_count`, a clean run retires them) and every run is stored in `ledger_reconcile_runs` for the Reports page.

`fees` owns the money rules in `fee_runtime_config` (Settings › Fees & holds; `PLATFORM_FEE_PERCENT` only seeds the row): platform fee default plus per-category overrides, the escrow default for new products, a hold floor (global and per category) applied after the seller-tier reduction, and the withdrawal minimum / fee (fixed + percent). Settlement and delivery read through `fees.service` (`order_fee_percent`, `escrow_days_for`) — never `settings` — and `request_withdraw` locks the fee at request time (`withdraw_requests.fee_amount / net_amount`); on approval the net amount leaves as `withdraw`, the fee is booked as `withdraw_fee` (neutral) on the seller wallet and `platform_fee` (reference `withdraw-<id>`) on the platform wallet, so the ledger identity still holds. Every save writes `fee_runtime_config_changed` with old → new.

Disputes carry a seller-side clock as well (A4.5): `Dispute.seller_deadline_at` is stamped at creation from `fee_runtime_config.dispute_seller_response_hours` (0 = off), any seller action — note, resource remedy, escalation to marketplace review — sets `seller_responded_at`, and `dispute_seller_timeout_job` (15 min, pausable) refunds the remaining escrow to the buyer for cases still untouched past the deadline (`resolve_dispute_after_seller_timeout`: timeline event `seller_timeout_refund`, log `dispute_seller_timeout`, warning alert). Marketplace review pauses this clock like the buyer-window and abandonment clocks. The `dispute_opened` mail names the deadline. Migration `fk…` marked pre-existing cases with seller activity as responded so nobody is punished retroactively.

Seller tiers are admin-tunable (`seller_tier_config`, Settings › Sellers › Tiers; one row per tier, seeded from the constants that used to live in `sellers/tiers.py`): the cap on products on sale at once (`max_active_products`, NULL = unlimited — enforced on create-as-active, status→active and bulk activate, which reports the overflow as `tier_limit`; error `PRODUCT_LIMIT_REACHED`), the withdrawal ceiling per request, the platform-fee discount in percentage points and the escrow reduction in days. `sellers/tier_config.rule_for(db, tier)` is the only read path (5 s process cache); internal (platform-run) sellers are never capped. Changes log `seller_tier_config_changed` with old → new per tier; the seller console shows "tier: on sale x/y".

`ai` owns provider-agnostic text generation. Features call `ai.service.run_task(task=...)` with a task id from `ai.tasks` and never import an adapter; `run_task` owns provider resolution, the kill-switch, the daily token ceiling, prompt rendering and spend logging (`ai_usage_log`). Two adapters sit behind `AiTextPort`: `gemini.GeminiAdapter` (native `:generateContent`, kept as the default because its `responseSchema` honours `nullable`) and `openai_compatible.OpenAiCompatibleAdapter`, which reaches OpenAI, DeepSeek, Groq, OpenRouter, Together, xAI and a local Ollama through the same `/chat/completions` contract. `mock.MockAiAdapter` is selected whenever `DEPLOYMENT_ENVIRONMENT=test`, so the suite never calls a vendor. Provider choice, model id, fallback model list and the encrypted API key live in singleton `ai_provider_config` — not env — because switching vendor must not require a redeploy, and because Google both overloads (503) and retires (404) model ids without notice; an adapter walks the fallback list before reporting `unavailable`. Prompt copy lives in `ai_prompt_templates` (task+locale) seeded from `ai.defaults`; admin may edit copy but cannot add task ids. The stored key is never returned by the admin API, only a boolean `api_key_configured`.

`trust_seed` owns admin-authored demo reviews for cold-start social proof. It is two-step by construction: `generate` returns drafts and writes nothing, `apply` persists an admin-accepted set as one reversible batch, and `purge_batch` removes it completely. Everything it writes (`accounts`, `orders`, `reviews`) carries `is_seeded`, and every financial or performance query filters on that column — seller dashboard, `products.get_seller_stats`, pricing stats, affiliate spend and the admin account list. Seeded orders touch no wallet code path at all, so no transaction, escrow row or commission can exist for them. Synthetic reviewers use the RFC 2606 `@seed.invalid` domain with an unusable password hash and `is_active=false`. `trust_seed.policy` re-validates every row server-side on apply: generation is probabilistic, but the off-platform-contact rule is enforced deterministically and cannot be bypassed from the console.

`site_pages` owns the admin-editable footer/legal pages (`site_pages` table, one row per slug with vi/en markdown). Built-in slugs are seeded by migration from `site_pages.defaults` and can be reset but not deleted; admin may add further slugs. Public reads (`/public/site-pages`, `/public/site-pages/{slug}`) go through a `ProcessConfigCache`; the storefront renders the markdown with raw HTML disabled.

## 4. Dependency rules

- `main.py` may import routers to compose the application.
- Routers may import auth dependencies, schemas, stable entity types, and their owning service interface.
- Routers do not import another feature service for orchestration; move that behavior behind an owning module.
- Routers do not operate provider adapters directly.
- Services never import routers.
- Schemas never import router/service implementations.
- Models never import FastAPI or feature implementations.
- Request-path database and HTTP I/O remains async.
- Cross-feature calls use the callee's stable service interface; do not reach into private helpers.

Circular imports indicate a misplaced seam. Do not fix them with local imports unless the cycle is understood and removed or deliberately isolated at composition.

## 5. Transaction ownership

The application operation owns the transaction.

- Pass `AsyncSession` into the owning service; do not create hidden sessions in helpers.
- Commit at a clearly documented application seam.
- Helpers normally flush/return results and let the owner commit.
- Financial operations use row locks or equivalent concurrency control where required.
- External network calls are not casually placed inside long database transactions.
- Idempotency checks and writes occur in the same protected transaction where correctness requires it.
- Rollback behavior must leave ledger, inventory, escrow, and provider state recoverable and auditable.

Tests exercise observable committed outcomes, idempotent retries, and concurrency where relevant.

## 6. Error contract

- Application/domain errors describe the failed invariant or operation.
- The HTTP adapter maps them to stable status/error codes.
- Non-enumerating authorization behavior remains intentional.
- External errors retain enough structured context for retry/audit without leaking secrets.
- Do not catch broad exceptions and return success or an empty result.
- Do not expose raw provider, SQL, encryption, or token errors to clients.

## 7. Security and money seams

Security and financial behavior are never page/router convenience logic.

- Authorization is enforced at the backend operation.
- Money remains integer ledger units; conversions are explicit display/application operations.
- Wallet, escrow, deposit, withdrawal, affiliate and usage writes preserve idempotency and auditability.
- Secrets are decrypted only at the integration seam and never logged.
- Provider/webhook success requires cryptographic or upstream verification where applicable.
- Security, ledger, and role semantics require positive and negative tests through the application/HTTP interface.

### Dispute settlement invariants

- A resource that has ever been attached to an order is immutable inventory history: it may be inspected, archived, refunded, or replaced through the order/dispute workflow, but it must never return to sellable stock. Archiving is visibility-only and restoring an archived resource must preserve its status, order link, assignment timestamps, and refund allocation. Every stock projection and allocation path excludes archived resources and requires sellable resources to have no order link.

- Instant-inventory orders allocate the immutable order total across delivered resources in integer ledger units. Remainders are assigned deterministically by resource order; legacy orders are backfilled only when resource count equals purchased quantity.
- A buyer may add multiple append-only claim batches to one open case. Each resource can appear only once in that case. Only currently `assigned` resources may be claimed. A replacement resource may be claimed once (warranty generation 1). Claiming a second-generation replacement is rejected; the buyer accepts or opens Marketplace chat. `can_append_claims` is true only while an open instant-inventory case still has an assigned, unclaimed, generation ≤ 1 account.
- Buyer/seller case chat does not clear the buyer-response deadline. Only a new claim batch does. Marketplace review is a disputes-owned transaction: escalate with a required note sets `review_requested_at`, which pauses timeout and abandonment jobs until an admin resolves the case. Chat helpers flush the support thread and do not commit or pause settlement. Reopening an existing support thread does not auto-refund.
- Seller resource remedies are immutable and idempotent. Refund actions credit only the selected resources' allocation; replacement actions preserve that allocation on the replacement and never return a reported-broken resource to available inventory. A refund or replace writes one-off buyer and seller alerts naming the affected resource IDs, with an href that opens that order's delivery list highlighting those IDs. `Order.delivered_data` is refreshed to currently assigned resources only; remedied originals stay on the order as `error` for the inspector.
- `orders.total_amount` remains the original commercial amount. `orders.refunded_amount` accumulates refunds and is constrained to `0..total_amount`; seller release, platform fee and affiliate commission use only `total_amount - refunded_amount`.
- An open dispute is an overlay in `disputes`, not an `orders.status` value: the order retains its delivered lifecycle while scheduler settlement, buyer confirmation, and proxy rotation explicitly exclude the open case. Buyer acceptance requires every claimed resource to have a remedy, resolves the case, and releases only the remaining escrow. Admin full-order replacement is rejected after account-level remedies to prevent double compensation.
- A full seller resource refund immediately resolves the case as `resolved_refund` and marks the order `refunded`; no buyer acceptance is required. A seller response (proxy/task) or a complete instant-resource remedy starts a buyer-response deadline using `DISPUTE_RESOLUTION_TIMEOUT_HOURS` (24 by default). A later claim batch clears that deadline; ordinary case chat does not. After an instant remedy, a later seller response makes a new offer and arms a new deadline unless Marketplace review is open. The timeout scheduler resolves an unanswered case as `resolved_timeout` and releases only remaining escrow under the same locked, idempotent settlement path, skipping cases with `review_requested_at`.
- A buyer may withdraw an open case only before any seller resource remedy exists. Withdrawal never extends or restarts `escrow_expires_at`: before that original deadline the order remains `delivered`; after it, the withdrawal transaction immediately performs the normal remaining-escrow settlement and completes the order. A legacy delivered order with no escrow deadline has no scheduler completion path, so withdrawal is its explicit buyer confirmation and settles immediately. This makes a paused, expired case recoverable without a scheduler delay while preventing a buyer from discarding an already-issued refund or replacement.
- An untouched open case (no resource remedy and no buyer-response deadline) does not freeze escrow forever. After `escrow_expires_at`, `DISPUTE_ABANDON_GRACE_HOURS` (24 by default) of no further buyer claim batch settles the case as `resolved_abandoned` and releases only remaining escrow on the same locked path. A seller note or buyer chat alone does not block this clock; a resource remedy or an armed buyer-response deadline does. A new claim batch after expiry restarts the grace window, but ordinary chat cannot indefinitely retain escrow.
- The dispute timeline is derived from immutable claim batches, resource actions and case messages. Authorization for every buyer/seller case operation is enforced in the disputes service, independent of frontend visibility.
- `OrderResponse` exposes a read-only lifecycle projection (`fulfillment`, `settlement`, `protection`, `capabilities`, and optional task progress). It is derived from the commercial order, product strategy, task state, and dispute case; it guides buyer UI but does not replace financial state or authorize mutations.

## 8. Testing through interfaces

The feature interface is the primary test surface.

- Router tests verify transport, auth wiring, status codes and schemas.
- Service tests verify invariants, transactions and observable outcomes.
- External integrations use test adapters for success, timeout, invalid payload and retry paths.
- Tests should survive implementation refactors behind the same interface.
- Do not export private helpers solely for tests.
- When a shallow module is replaced by a deeper interface, replace redundant implementation tests rather than layering both forever.

Backend tests remain serial because they share `marketplace_test`.

## 9. Agent implementation preflight

Before coding, record:

```text
Owning module: <feature>
Interface changed: <service function/schema/port or none>
Transaction owner: <function>
External adapters: <none or production + test adapter>
Invariants: <authorization · idempotency · money · state transition>
Tests: <service · router · negative · concurrency as relevant>
```

Then inspect the owning service, its router/schema, models/migrations, direct callers, and existing tests before changing the interface.

## 10. Migration strategy

1. Deepen the highest-change/highest-risk feature first rather than reorganizing every package.
2. Move cross-feature orchestration out of routers into an owning application module.
3. Convert service `HTTPException` usage to application errors when that service is touched.
4. Introduce provider ports only where production and test adapters justify the seam.

Do not perform a repository-wide clean-architecture rewrite. Preserve behavior with tiny, test-backed migrations.
