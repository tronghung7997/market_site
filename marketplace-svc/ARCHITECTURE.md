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

`auth`, `security`, `errors`, `money`, `audit`, `observability`, `i18n`, and `mail` are shared because their semantics must be consistent. They must expose narrow interfaces and must not become general dumping grounds.

`mail` owns the transactional outbox and outbound adapters (log / SMTP / Resend). Feature services call `mail.enqueue_mail` in the same transaction as the domain mutation. They must not import mail adapters. Sending is outbound-only; inbound ports are not required.

Operational mail knobs (`provider`, `mail_from`, `mail_from_name`, `worker_enabled`) live in singleton `mail_runtime_config` (env is bootstrap/reset only), using the shared `runtime_config.ProcessConfigCache`. Subject/body copy lives in `mail_templates` (template+locale), seeded from the code catalog; admin may edit copy but cannot add template ids. Provider secrets (`RESEND_API_KEY`, SMTP password) stay in env and are never returned by admin APIs — only boolean configured flags. Admin HTTP for mail config, templates, send-test, and outbox listing lives in `mail.router`; adapters remain behind `mail.factory`.

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
