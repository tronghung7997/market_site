# Logging, Audit & Monitoring Review — Implementation Handoff

**Reviewed:** 2026-08-04

**Scope:** `marketplace-svc` logging, audit trail, alerts/incidents, specialized call logs, scheduler jobs, admin/ops UI

**Evidence:** codebase knowledge graph + source inspection + local read-only samples from `/admin/logs`, `/admin/alerts`, `/admin/action-items`

**Status:** implementation-ready plan; execute work packages in order

---

## 1. Outcome

The service has useful business audit coverage for orders and money, but it is not production-ready for security monitoring or incident response.

The first implementation step is **not** to add more calls to `log_event()` or `create_alert_once()`. The current primitives have two design problems that must be fixed first:

1. `create_alert()` commits the caller's session, so creating an alert can commit unrelated domain changes.
2. `create_alert_once()` deduplicates using an audience tuple rather than an incident identity, is race-prone, and can hide distinct failures.

### 1.1 Corrected scorecard

| Area | Score | Corrected verdict |
|------|:-----:|-------------------|
| Request correlation | 3/5 | Works on normal responses; unhandled exceptions can skip access log/header; inbound request ID is unvalidated |
| Business audit | 4/5 | Good for order, dispute, deposit and withdrawal flows |
| Security telemetry | 1/5 | Login/key/auth rejection signals are absent |
| Privileged-action audit | 1/5 | Role, tier and key lifecycle changes are not durable audit events |
| Alert/incident quality | 2/5 | UI exists, but transaction ownership and incident identity are unsafe |
| Provider diagnostics | 4/5 | Metadata-only call log, independent best-effort write |
| Gateway diagnostics/privacy | 2/5 | Response is capped, but full query/body payload is stored without redaction |
| Retention/query safety | 2/5 | Gateway has TTL; other log tables are unbounded; admin limit is client-controlled |
| External monitoring | 1/5 | No off-box log shipping, paging, metrics or error tracker configured in repo |

### 1.2 Release gates

Before calling the system production-ready, all of the following must be true:

- Request IDs are validated and every request outcome, including unhandled 500, emits one access event.
- Alert creation never commits a caller-owned transaction.
- Repeated incidents use an atomic, event-specific fingerprint.
- Authentication failures and invalid credentials emit structured security telemetry that survives request rollback.
- Privileged and money-adjacent mutations create durable audit events in the same transaction as the mutation.
- Gateway history redacts and bounds query/body data before persistence.
- `log_entries`, `provider_call_logs` and resolved alerts have explicit retention.
- Production stdout is shipped off-host and unhandled exceptions trigger an external notification.

---

## 2. Event-channel contract

Do not use one channel for every kind of event. Each channel has different durability, volume and transaction requirements.

| Code | Channel | Use it for | Persistence rule | Examples |
|------|---------|------------|------------------|----------|
| **T** | Technical telemetry / structlog | Request outcome, latency, exceptions, dependency failures | Never depends on request DB commit; production must ship off-host | `http_request`, `gateway_forward_failed` |
| **S** | Security telemetry / structlog | Authentication and authorization outcomes, invalid keys, SSRF blocks | Same as T; rate-limit or aggregate noisy events | `auth_login_failed`, `internal_key_rejected` |
| **A** | Business audit / `log_entries` | Durable facts about a committed business or privileged mutation | Added to the same DB transaction; helper never commits | `auth_role_changed`, `gateway_key_revoked` |
| **I** | Incident / `alerts` | A condition requiring human action | Atomic incident upsert; no hidden commit | provider unavailable, provision stuck |
| **P** | `provider_call_logs` | Admin-facing outbound provider attempts | Own session, best effort, metadata only | provider operation, status, latency |
| **G** | `gateway_call_logs` | Buyer-facing recent request history | Own session, best effort, sanitized and bounded, short TTL | endpoint, sanitized request preview |
| **L** | Domain ledger | Source of truth for money/quota | Domain transaction; retention follows legal/business policy | transactions, usage_records, PayOS events |

### 2.1 Target flow

```text
HTTP request
├─ correlation + access outcome ───────────────► T → stdout → off-box shipping
├─ auth/key/SSRF outcome ─────────────────────► S → stdout → counters/alerts
└─ successful business mutation
   ├─ domain state ────────────────────────────► domain tables / ledger
   └─ durable audit fact ──────────────────────► A (same commit)

Scheduler / operational detector
└─ event-specific incident fingerprint ───────► I (atomic upsert)
                                                └─ admin UI + external page

Outbound provider/gateway call
├─ technical error ───────────────────────────► T
├─ provider attempt metadata ─────────────────► P (own session)
└─ sanitized buyer history ───────────────────► G (own session + TTL)
```

### 2.2 Transaction invariants

These are non-negotiable implementation rules:

1. `log_event()` and transactional alert helpers may call `db.add()`/`flush()` but must not call `commit()` or `rollback()`.
2. The service or route that owns the business mutation owns the commit.
3. A failure signal that must survive rollback uses T/S, or an explicitly independent helper with its own session.
4. An independent best-effort helper must never receive a caller-owned session.
5. Do not catch `IntegrityError` on the outer business transaction for incident dedup. Use PostgreSQL `ON CONFLICT` or a savepoint.
6. A ledger row is not automatically an audit event, but high-volume ledger activity must not be duplicated into `log_entries` without a demonstrated support need.

### 2.3 Common audit fields

Keep the existing `log_entries.metadata` JSON shape for this implementation. Every new A event must use these names:

| Field | Required | Meaning |
|-------|----------|---------|
| `event` | yes | Stable snake_case event name |
| `actor_id` | for authenticated mutation | Account performing the action |
| `actor_type` | when useful | `buyer`, `seller`, `admin`, `internal_service`, `scheduler` |
| `subject_type` | yes | Resource affected: account, order, provider, key, etc. |
| `subject_id` | yes where one exists | Identifier of the affected resource |
| `outcome` | yes | `success` or `failure` |
| `source` | yes | Route/job/source such as `admin`, `demo`, `payos_webhook` |
| domain fields | optional | Old/new values, amount, order_id, provider_id, etc. |

Do not store passwords, raw email addresses for failed login, cookies, authorization headers, full API/gateway keys, PayOS checksums, provider credentials or plaintext resource data.

For a stable login principal identifier, use a keyed HMAC of normalized email. Do not use plain SHA-256, which is reversible by dictionary attack for common addresses.

---

## 3. Verified as-built state

### 3.1 What already works

- `RequestIdMiddleware` binds `request_id` and `service` to structlog context.
- Many order/money services write `log_entries` in the same transaction as their domain changes.
- Scheduler audit events use `job_id`.
- `provider_call_logs` intentionally exclude request/response bodies and survive caller rollback.
- `gateway_call_logs` are independent, best effort, and purged after seven days.
- `usage_records` remain separate from buyer convenience history.
- Admin logs translate most existing events into Vietnamese labels.
- NotificationBell/action-items provide a useful human work queue, although they are not an on-call paging system.

### 3.2 Confirmed defects and risks

#### P0 — request ID can break an audited business transaction

`RequestIdMiddleware` accepts any `X-Request-ID`. `log_entries.request_id` is `VARCHAR(36)`. A long client-controlled header can reach `log_event()` and cause the business transaction to fail on insert.

Also, access logging and response-header injection happen only after `call_next()` returns, so an unhandled exception can skip both.

#### P0 — alert helper owns the wrong transaction

`src/alerts/service.py::create_alert` receives the caller's `AsyncSession` and commits it. Current call sites include disputes, resources, orders, payments and scheduler jobs. An alert can therefore commit unrelated pending domain state.

#### P0 — alert dedup key is semantically wrong

The current tuple is `(type, target_type, target_id)`:

- `sla_breach` targets a seller, so multiple breached orders for one seller collide.
- `resource_low` targets a seller, so different low-stock variants collide.
- `resource_error` targets a seller even though the incident is about one resource.
- Query-then-insert has no database uniqueness guarantee and races under concurrency.
- Active/inactive alone does not record `last_seen`, occurrence count or recovery.

#### P0 — security rejection events cannot use the current A flow

`authenticate()` raises 401 and the request session dependency does not auto-commit. Adding `log_event()` immediately before the raise would not guarantee persistence. Writing a database row synchronously for every failed login would also create an abuse amplification path.

#### P0 — gateway history stores unsanitized input

`gateway_forward` persists the entire query dict and parsed JSON body. Only response text and errors are capped. Buyer-supplied data can still contain tokens, PII or large nested values.

#### P1 — admin log query is unbounded

`GET /admin/logs` has a default of 100, not a maximum. It accepts arbitrary integer values and has no cursor or time range.

#### P1 — retention is incomplete

| Table | Current |
|-------|---------|
| `gateway_call_logs` | 7 days, cleanup every 6h |
| `log_entries` | no purge |
| `provider_call_logs` | no purge |
| resolved/dismissed `alerts` | no purge |
| `usage_records` | permanent by design |

#### P1 — external observability is absent

The repo has structured stdout but no shipping contract, metrics endpoint, error tracker, synthetic check or on-call integration. This is a production gate, not a P3 nice-to-have.

### 3.3 Runtime snapshot

Point-in-time local sample on 2026-08-04:

```text
/admin/logs?limit=15
  mostly info + historical critical provider_down
  metadata 15/15
  request_id 8/15
  job_id 3/15

/admin/alerts
  80 active
  dproxy_unavailable: 50 for the same provider

/admin/action-items
  84 items across applications, disputes, withdrawals, tasks and alerts

Last 200 log entries:
  no login/register/role/internal security events
```

Treat these counts as evidence of the sampled database, not as stable acceptance-test values.

---

## 4. Target alert/incident design

### 4.1 Schema migration

Extend `alerts`:

| Column | Type | Rule |
|--------|------|------|
| `fingerprint` | `VARCHAR(255)` nullable | Required for repeatable operational incidents |
| `first_seen_at` | timezone datetime | Defaults to now |
| `last_seen_at` | timezone datetime | Defaults to now; update on recurrence |
| `occurrence_count` | integer | Defaults to 1; increment on recurrence |
| `resolved_at` | timezone datetime nullable | Set when dismissed/resolved |

Keep `is_active` for API compatibility in the first migration.

Create a PostgreSQL partial unique index:

```sql
CREATE UNIQUE INDEX uq_alerts_active_fingerprint
ON alerts (fingerprint)
WHERE is_active = true AND fingerprint IS NOT NULL;
```

Migration requirements:

- Existing rows may keep `fingerprint = NULL`.
- Backfill timestamps from `created_at`.
- Do not attempt to merge historical duplicate rows in the schema migration.
- Add a separate, explicit data-cleanup script if historical cleanup is desired.
- Determine the actual Alembic head before creating the revision.

### 4.2 Service APIs

Replace `create_alert`/`create_alert_once` with three explicit operations:

```python
async def add_alert(
    db: AsyncSession,
    *,
    type_: str,
    severity: str,
    target_type: str,
    target_id: int,
    message: str,
    fingerprint: str | None = None,
) -> Alert:
    """Add to caller transaction. Never commits."""

async def upsert_incident(
    db: AsyncSession,
    *,
    fingerprint: str,
    type_: str,
    severity: str,
    target_type: str,
    target_id: int,
    message: str,
) -> Alert:
    """Atomic INSERT ... ON CONFLICT DO UPDATE. Never commits."""

async def emit_incident(**kwargs) -> None:
    """Own SessionLocal, upsert + commit, best effort, never raises."""
```

Rules:

- `add_alert` is for one-off transactional facts such as opening a dispute.
- `upsert_incident` is for repeatable conditions inside a caller-owned job transaction.
- `emit_incident` is for operational failures after rollback or outside a domain transaction.
- Dismiss sets `is_active=false` and `resolved_at=now`.
- A later recurrence creates a new active row because the partial unique index applies only to active incidents.

### 4.3 Fingerprint catalog

Audience (`target_type`/`target_id`) and incident identity (`fingerprint`) are separate.

| Alert type | Fingerprint |
|------------|-------------|
| `dproxy_auth_error` | `provider:{provider_id}:dproxy_auth_error` |
| `dproxy_unavailable` | `provider:{provider_id}:dproxy_unavailable` |
| `dproxy_contract_error` | `provider:{provider_id}:dproxy_contract_error` |
| `dproxy_duplicate_external_id` | `provider:{provider_id}:dproxy_duplicate_external_id` |
| `dproxy_allocation_disappeared` | `order:{order_id}:dproxy_allocation_disappeared` |
| `provider_down` | `provider:{provider_id}:provider_down` |
| `provider_low_credit` | `provider:{provider_id}:provider_low_credit` |
| `provider_out_of_credit` | `provider:{provider_id}:provider_out_of_credit` |
| `provision_operational` | `order:{order_id}:provision_operational` |
| `provision_stuck` | `order:{order_id}:provision_stuck` |
| `escrow_release_failed` | `order:{order_id}:escrow_release_failed` |
| `sla_breach` | `order:{order_id}:sla_breach` |
| `sla_refund_failed` | `order:{order_id}:sla_refund_failed` |
| `resource_low` | `variant:{variant_id}:resource_low` |
| `resource_error` | `resource:{resource_id}:resource_error` |
| `task_webhook_timeout` | `order:{order_id}:task_webhook_timeout` |
| `deposit_anomaly` | `deposit:{deposit_id}:{reason_code}` |

`dispute_opened` is a one-off alert and does not need incident upsert because the domain already allows one dispute per order.

---

## 5. Event placement decisions

### 5.1 Security telemetry (S, not `log_entries`)

| Event | Level | Required fields |
|-------|-------|-----------------|
| `auth_login_success` | info | account_id, request_id |
| `auth_login_failed` | warning | principal_fingerprint, generic reason, request_id |
| `auth_token_rejected` | warning or sampled | reason, path, request_id |
| `internal_key_rejected` | warning | path, request_id |
| `seller_api_key_rejected` | warning | key_prefix if safely derivable, request_id |
| `webhook_signature_failed` | warning | provider_id/deposit_id when known, request_id |
| `ssrf_blocked` | warning | sanitized host, reason, request_id |
| `debug_endpoint_hit` | info/warning | client IP only if proxy trust is configured, request_id |

Use a single externally visible reason for unknown-user and bad-password login failures. Internal telemetry may use a generic `invalid_credentials` reason; do not leak account existence.

### 5.2 Durable business audit (A)

Implement these first:

| Event | Mutation | Required metadata |
|-------|----------|-------------------|
| `auth_register` | account + wallet created | actor/subject account_id, source=public |
| `auth_role_changed` | admin changes roles | actor_id, target account, old_roles, new_roles |
| `auth_tier_changed` | admin changes seller tier | actor_id, target account, old_tier, new_tier |
| `demo_topup` | user invokes enabled demo funding | actor_id, amount, source=demo |
| `manual_topup` | admin funds an account | actor_id, target account, amount, source=admin |
| `internal_resources_acquired` | internal inventory claim | actor_type=internal_service, variant_id, quantity, resource_ids; no resource data |
| `internal_resources_released` | internal inventory release | actor_type=internal_service, resource_ids |
| `gateway_key_rotated` | buyer rotates key | actor_id, order_id, old_prefix, new_prefix |
| `gateway_key_revoked` | admin revokes key | actor_id, order_id, old_prefix |
| `seller_api_key_created` | seller creates key | actor_id/account_id, key_id, prefix |
| `seller_api_key_revoked` | seller revokes key | actor_id/account_id, key_id, prefix |
| `seller_application_submitted` | seller application created | actor_id, application_id |
| `seller_application_approved` | admin approves application | actor_id, target account/application |
| `seller_application_rejected` | admin rejects application | actor_id, target account/application |
| `provider_created` / `provider_updated` / `provider_reviewed` | provider config mutation | actor_id, provider_id, changed field names only |
| `affiliate_fund_topup` | admin funds affiliate pool | actor_id, amount |
| `task_updated` | admin/seller changes task state | actor_id, task_id, order_id, old_status, new_status |

Second pass:

- `product_created`, `product_updated`, `product_deleted`, `product_suspended`.
- `product_pricing_updated`.
- `category_created`, `category_updated`, `category_deleted`.
- `order_accepted`.
- Add `actor_id` to existing withdrawal admin events.

Do not add duplicate A events for:

- every successful `internal_usage_charge`; `usage_records` is already the permanent ledger;
- every affiliate click;
- every pricing quote;
- every gateway request;
- every affiliate commission unless support demonstrates that the existing commission/transaction ledger is insufficient.

---

## 6. Implementation work packages

Grok should implement these packages serially. Do not combine them into one large change.

### WP0 — pre-flight and regression baseline

**Purpose:** avoid overwriting existing work and establish a reproducible baseline.

Current dirty paths observed during this review:

- `marketplace-svc/src/adapters/factory.py`
- `marketplace-svc/src/config.py`
- `marketplace-svc/tests/conftest.py`
- `marketplace-svc/tests/test_seller_mock_e2e.py`
- this document is untracked

Tasks:

1. Inspect `git diff` for every overlapping file before editing.
2. Run the existing backend suite and record pre-existing failures.
3. Run frontend TypeScript/build validation.
4. Determine the current Alembic head; do not guess revision ancestry.
5. Do not “clean up” unrelated dirty changes.

Commands:

```bash
cd marketplace-svc
uv run pytest
uv run alembic heads

cd ../frontend
npm run build
```

Done when baseline results are written into the implementation PR/commit notes.

### WP1 — request correlation and complete access outcomes

**Files:**

- `marketplace-svc/src/middleware.py`
- `marketplace-svc/src/logging.py`
- `marketplace-svc/src/auth/dependencies.py`
- `marketplace-svc/tests/test_health.py`
- `marketplace-svc/tests/test_auth.py`

Tasks:

1. Accept inbound `X-Request-ID` only when it matches the chosen format and is at most 36 characters; otherwise generate a canonical UUID.
2. Prefer a pure ASGI middleware so downstream state and exception outcomes can be observed reliably.
3. Emit exactly one `http_request` event for normal, handled-error and unhandled-error outcomes.
4. On unhandled exceptions, log `status=500` with `exc_info`, add duration, then re-raise.
5. Add the response `X-Request-ID` for every response that the application can construct.
6. Have authenticated dependencies place the account ID in request state; the access middleware reads it after the app returns.
7. Log route template when available and raw path only as fallback.
8. Never log query string or body in the access event.

Tests:

- Valid client request ID is echoed and bound.
- Invalid, empty and >36-character IDs are replaced.
- An audited endpoint still succeeds with a maliciously long inbound ID.
- 2xx, 4xx and unhandled 500 each emit one access event.
- Authenticated request includes account_id; anonymous request does not.
- Access event contains route template rather than high-cardinality concrete ID where available.

Done when no client-controlled request ID can break a `log_entries` insert and 500s are correlated.

Suggested commit: `fix(observability): harden request correlation and access logging`

### WP2 — alert transaction ownership and incident lifecycle

**Files:**

- `marketplace-svc/src/models/alert.py`
- new Alembic revision
- `marketplace-svc/src/alerts/service.py`
- `marketplace-svc/src/alerts/schemas.py`
- `marketplace-svc/src/providers/credit.py`
- `marketplace-svc/src/orders/service.py`
- `marketplace-svc/src/disputes/service.py`
- `marketplace-svc/src/resources/service.py`
- `marketplace-svc/src/scheduler.py`
- `marketplace-svc/src/payments/service.py`
- `marketplace-svc/tests/test_alerts.py`
- `marketplace-svc/tests/test_provider_credit.py`
- `marketplace-svc/tests/test_dproxy_reconciliation.py`
- `marketplace-svc/tests/test_scheduler.py`
- `marketplace-svc/tests/test_disputes.py`

Tasks:

1. Add the schema from section 4.1 and the partial unique index.
2. Implement `add_alert`, `upsert_incident` and `emit_incident`.
3. Remove all hidden commits from alert creation/upsert.
4. Keep explicit commits in service/job owners.
5. Replace `create_alert_once` with atomic upsert; delete it after all callers migrate.
6. Apply the fingerprint catalog from section 4.3.
7. Ensure failure branches that call `rollback()` explicitly start/persist their failure audit + incident afterward.
8. Change dismiss to populate `resolved_at`.
9. Return `first_seen_at`, `last_seen_at` and `occurrence_count` in alert schemas without breaking existing fields.

Tests:

- Adding an alert does not commit unrelated pending state.
- Rolling back caller transaction also rolls back a transactional alert.
- `emit_incident` survives caller rollback and never raises into the main flow.
- Concurrent identical incident emissions produce one active row and increment count.
- Different SLA orders for one seller produce different active incidents.
- Different low-stock variants for one seller produce different active incidents.
- Dismissed incident can recur as a new active row.
- DProxy outage updates `last_seen_at`/count rather than creating one row per scheduler cycle.

Done when `rg "create_alert_once|create_alert\(" marketplace-svc/src` finds no legacy call site and all commits are owned by explicit transaction boundaries.

Suggested commits:

1. `feat(alerts): add incident lifecycle schema`
2. `refactor(alerts): make transaction ownership explicit`
3. `fix(alerts): atomically deduplicate scheduler incidents`

### WP3 — sanitize and bound gateway history

**Files:**

- `marketplace-svc/src/gateway/call_history.py`
- `marketplace-svc/src/gateway/router.py`
- `marketplace-svc/src/models/usage.py` only if a truncation flag is added
- `marketplace-svc/tests/test_gateway.py`

Tasks:

1. Add one recursive sanitizer for query/body/error/response previews.
2. Redact keys case-insensitively when their normalized name contains `password`, `token`, `secret`, `api_key`, `authorization`, `cookie`, `checksum` or private-key material.
3. Bound nesting depth, collection length and individual string length.
4. Bound the serialized request preview to 8 KiB; include a marker such as `"_truncated": true` rather than storing invalid JSON.
5. Keep the response preview at 4,000 characters, but sanitize structured JSON before rendering where practical.
6. Sanitize exception text before persistence and structlog.
7. Update comments that currently assert buyer-supplied payload is inherently safe.

Tests:

- Nested sensitive keys are redacted.
- Case variants such as `Authorization` and `apiKey` are redacted.
- Query parameters are sanitized too.
- Deep/large payloads are bounded and valid JSON.
- Original input object is not mutated.
- Logging remains best effort and survives DB failure.

Done when no gateway call history test can recover seeded secret values from the database.

Suggested commit: `fix(gateway): redact and bound buyer call history`

### WP4 — security telemetry and P0 durable audits

**Files:**

- new `marketplace-svc/src/security/events.py`
- `marketplace-svc/src/config.py` — merge carefully; currently dirty
- `marketplace-svc/src/auth/service.py`
- `marketplace-svc/src/auth/router.py`
- `marketplace-svc/src/auth/dependencies.py`
- `marketplace-svc/src/audit/service.py`
- `marketplace-svc/src/wallet/router.py`
- `marketplace-svc/src/wallet/service.py`
- `marketplace-svc/src/resources/router.py`
- `marketplace-svc/src/gateway/router.py`
- `marketplace-svc/src/seller_api_keys/service.py` and router
- relevant tests: `test_auth.py`, `test_wallet.py`, `test_resources.py`, `test_gateway.py`, `test_seller_api_keys.py`, `test_audit.py`

Tasks:

1. Add a small `security_event()` helper that only emits structured S telemetry and has no DB dependency.
2. Add a dedicated configured HMAC secret and keyed principal fingerprinting for login identifiers; do not reuse an API key or store the raw identifier.
3. Emit login success/failure, rejected internal key, rejected seller key and bad webhook signature signals.
4. Extend the audit helper to merge the common fields from section 2.3 while preserving existing call compatibility.
5. Audit role/tier changes before their existing commit, capturing old and new values.
6. Split demo and admin topup paths so they emit `demo_topup` and `manual_topup` respectively with the correct actor/source.
7. Audit internal resource acquire/release in the same transaction and never include resource plaintext.
8. Audit gateway key rotate/revoke in the same transaction; capture prefixes before overwriting/nulling.
9. Change the revoke route dependency variable from `_` to `admin` so actor ID is available.
10. Audit seller API key create/revoke in the same transaction; prefix only, never plaintext/hash.

Tests:

- Five failed logins emit five S events without creating `log_entries` rows.
- Login failure cannot distinguish unknown user from wrong password externally.
- Security event contains no raw email/password/token.
- Role/tier mutations and audit rows commit atomically; forced rollback persists neither.
- Demo topup never emits `manual_topup`.
- Manual topup contains admin actor ID.
- Key audit contains prefix only.
- Internal resource audit contains IDs/count but no resource `data`.

Done when every P0 event in section 5 is either verified S telemetry or a durable same-transaction A event.

Suggested commits:

1. `feat(security): emit structured authentication signals`
2. `feat(audit): record privileged account and topup mutations`
3. `feat(audit): record internal resource and key lifecycle mutations`

### WP5 — remaining business audit coverage and UI catalog

**Files:**

- `marketplace-svc/src/seller/service.py`
- `marketplace-svc/src/providers/service.py` and routers
- `marketplace-svc/src/affiliate/service.py` and router
- `marketplace-svc/src/tasks/service.py`
- `marketplace-svc/src/products/service.py`
- `marketplace-svc/src/categories/service.py`
- `marketplace-svc/src/orders/service.py`
- `frontend/app/admin/logs/page.tsx`
- domain-specific backend tests

Tasks:

1. Add the remaining A events listed in section 5.2.
2. Pass actor ID through service interfaces where it is currently discarded.
3. For provider updates, log changed field names and decisions, not values that may contain credentials.
4. For pricing changes, include old/new numeric values only if they are not secret.
5. Update frontend `EVENT_META` for all new events and the existing missing events:
   - `escrow_release_failed`
   - `sla_refund_failed`
   - `provision_deadline_refund_failed`
   - `wallet_backfill`
6. Add a `security` category/tab or a clearly named privileged-action category; do not silently mix critical security events into generic system noise.
7. Preserve a readable fallback for unknown future events.

Tests:

- Each mutation creates exactly one audit row with actor and subject.
- No-op update either emits no event or explicitly records `outcome=no_change`; choose one policy and apply it consistently.
- Provider audit metadata does not contain encrypted/plain credential values.
- Frontend builds and known events render a localized title/description.

Suggested commits:

1. `feat(audit): cover seller provider and task mutations`
2. `feat(audit): cover catalog and order acceptance changes`
3. `feat(admin): render security and new audit events`

### WP6 — retention and safe querying

**Files:**

- `marketplace-svc/src/config.py` — merge carefully; currently dirty
- `marketplace-svc/src/audit/router.py`
- `marketplace-svc/src/audit/service.py`
- `marketplace-svc/src/scheduler.py`
- call-log services/models
- new Alembic revision for indexes
- `marketplace-svc/tests/test_audit.py`
- `marketplace-svc/tests/test_scheduler.py`

Defaults:

| Data | Default retention |
|------|------------------:|
| `gateway_call_logs` | 7 days |
| `provider_call_logs` | 30 days |
| `log_entries` | 180 days |
| resolved alerts | 90 days after `resolved_at` |
| active alerts | never purge |
| `usage_records` and money ledgers | never purge here |

Tasks:

1. Add positive-integer settings for these retention windows.
2. Create one cleanup job that deletes in bounded batches rather than one unbounded transaction.
3. Log per-table deleted counts and elapsed time.
4. Validate `GET /admin/logs` with `limit ge=1, le=200`.
5. Add optional `since`, `until` and `before_id` filters while keeping the list response compatible.
6. Add indexes for the actual query shapes:
   - created_at + id ordering;
   - request_id + created_at;
   - job_id + created_at;
   - expression/index strategy for `metadata->>'order_id'`.
7. Reject invalid time windows and negative cursor/limit values with 422.
8. Update frontend to paginate/load more rather than assuming one 200-row snapshot is complete.

Tests:

- Limit 0, negative and >200 return 422.
- Cursor pagination has no duplicates or gaps for stable data.
- Cleanup never deletes active alerts, recent rows or ledgers.
- Cleanup batch can run repeatedly and is idempotent.
- Existing request_id/job_id/order_id filters still work.

Suggested commits:

1. `fix(audit): bound log queries and add cursor filters`
2. `feat(observability): add retention indexes and cleanup jobs`

### WP7 — production observability integration

Repository-side tasks:

1. Keep JSON stdout as the canonical log transport.
2. Add documented required fields: timestamp, level, event, service, environment, request_id/job_id, route, status and duration.
3. Add optional Sentry initialization guarded by `SENTRY_DSN`; send unhandled exceptions and attach request ID, but do not send request bodies or auth headers.
4. Add low-cardinality HTTP metrics using route templates:
   - request count by method/route/status class;
   - latency histogram by method/route;
   - unhandled exception count;
   - scheduler success/failure/duration by job name;
   - active incidents by type/severity;
   - provider/gateway outbound count/latency/failure.
5. Expose metrics only through private/internal access; do not publish operational internals anonymously.
6. Add `docs/observability-deployment.md` describing the external requirements below.

Deployment-side requirements, which cannot be completed only by application code:

- Ship stdout with the platform's log driver/agent to Loki, CloudWatch or equivalent.
- Retain searchable production logs for an agreed period.
- Configure an uptime synthetic for `/health` and a DB-aware readiness endpoint.
- Page on sustained 5xx rate, scheduler failures, payment anomalies and critical active incidents.
- Verify an alert reaches the real on-call destination in staging.

Tests/verification:

- No metric label contains raw path IDs, account IDs, order IDs, emails or request IDs.
- Sentry test exception contains request ID but no secret/body.
- Metrics endpoint is inaccessible without the configured internal access path.
- Synthetic failure in staging produces one external notification.

Suggested commits:

1. `feat(observability): add low-cardinality service metrics`
2. `feat(observability): add optional error reporting`
3. `docs(observability): define production shipping and paging`

---

## 7. Verification matrix

### Request and security

- [ ] Valid request ID is echoed; invalid/long ID is replaced.
- [ ] 2xx, 4xx and unhandled 500 each emit one correlated access event.
- [ ] Login success/failure emits S, not A.
- [ ] Rejected internal/seller key emits S without the full key.
- [ ] SSRF and webhook signature rejection emit S.

### Transactional audit

- [ ] Role/tier/key/topup/internal-resource mutations and A events commit atomically.
- [ ] Forced rollback leaves neither mutation nor A event.
- [ ] Existing order/deposit/dispute/withdraw audit coverage remains intact.
- [ ] Every privileged event has actor, subject, outcome and source.

### Incidents

- [ ] Alert helper never commits caller state.
- [ ] One hour of one DProxy outage produces one active incident whose count increases.
- [ ] Two SLA-breached orders for one seller remain two incidents.
- [ ] Two low-stock variants for one seller remain two incidents.
- [ ] Dismiss then recurrence produces a new active incident.

### Privacy

- [ ] No password, raw failed-login email, full key, resource secret, PayOS checksum or provider credential appears in any channel.
- [ ] Gateway query/body preview is recursively redacted and bounded.
- [ ] Sentry and metrics do not receive high-cardinality IDs or payload bodies.

### Retention and UI

- [ ] Cleanup respects configured boundaries and never touches ledgers.
- [ ] Admin logs are capped and cursor-pagination works.
- [ ] New events render localized metadata; unknown events have a readable fallback.
- [ ] Active incident count in NotificationBell is no longer inflated by scheduler repetition.

---

## 8. Test execution order

For each work package:

1. Run the directly affected tests.
2. Run the full backend suite.
3. Run migration upgrade and downgrade against a disposable database when the package includes schema changes.
4. Run frontend build when API schemas or `EVENT_META` change.

Suggested final commands:

```bash
cd marketplace-svc
uv run pytest tests/test_health.py tests/test_auth.py tests/test_audit.py
uv run pytest tests/test_alerts.py tests/test_provider_credit.py tests/test_dproxy_reconciliation.py tests/test_scheduler.py
uv run pytest tests/test_gateway.py tests/test_wallet.py tests/test_resources.py tests/test_seller_api_keys.py
uv run pytest
uv run alembic upgrade head

cd ../frontend
npm run build
```

Do not claim completion when only targeted tests pass.

---

## 9. Existing event catalog

### Orders

`order_placed`, `resources_assigned`, `order_processing`, `order_provisioned`, `order_provision_failed`, `order_adapter_error`, `order_provider_strategy_mismatch`, `order_provision_error`, `order_confirmed`, `order_delivered_manual`.

### Scheduler/order money

`escrow_released`, `escrow_release_failed`, `sla_refund`, `sla_refund_failed`, `provision_deadline_refund`, `provision_deadline_refund_failed`, `resource_expired`, `task_webhook_sla_timeout`, `provider_down`, `deposit_expired_sweep`.

### Disputes

`dispute_opened`, `dispute_seller_responded`, `dispute_refunded`, `dispute_rejected`, `dispute_partial_refunded`, `dispute_replaced`, `dispute_warranty_extended`.

### Wallet/payments

`manual_topup`, `wallet_backfill`, `withdraw_requested`, `withdraw_approved`, `withdraw_rejected`, `withdraw_paid`, `deposit_created`, `deposit_cancelled`, `deposit_paid`, `deposit_webhook_unknown`.

When adding a new event, update this catalog, the relevant tests and the admin UI metadata in the same work package.

---

## 10. Code map

| Path | Responsibility |
|------|----------------|
| `marketplace-svc/src/logging.py` | structlog setup and request context |
| `marketplace-svc/src/middleware.py` | request correlation/access outcome |
| `marketplace-svc/src/audit/service.py` | transactional business audit |
| `marketplace-svc/src/alerts/service.py` | one-off alert + incident lifecycle APIs |
| `marketplace-svc/src/providers/credit.py` | current legacy dedup caller |
| `marketplace-svc/src/scheduler.py` | scheduled domain events/incidents/cleanup |
| `marketplace-svc/src/adapters/call_log.py` | metadata-only provider attempts |
| `marketplace-svc/src/gateway/call_history.py` | sanitized recent buyer history |
| `marketplace-svc/src/gateway/router.py` | gateway forward and key lifecycle |
| `marketplace-svc/src/models/log_entry.py` | audit persistence; request_id is VARCHAR(36) |
| `marketplace-svc/src/models/alert.py` | incident persistence |
| `frontend/app/admin/logs/page.tsx` | event catalog and audit UI |
| `frontend/components/NotificationBell.tsx` | active action items |

Related: `docs/security-audit-remediation-checklist.md`.

---

## 11. Instructions for the implementing agent

1. Follow WP0–WP7 in order; do not start by bulk-inserting audit calls.
2. Preserve existing dirty work and inspect every overlapping diff.
3. Use one focused commit per suggested boundary.
4. Add or update tests in the same commit as behavior.
5. Never make a logger/alert helper silently commit a caller-owned transaction.
6. Never introduce a security event that can leak credentials or create an unbounded synchronous DB write path.
7. Do not deduplicate on `target_id` unless the target is also the true incident subject.
8. If current code contradicts this document, stop and record the exact contradiction before changing scope.
9. Report for every work package:
   - files changed;
   - migrations added;
   - targeted/full test results;
   - remaining deployment dependency;
   - any intentional deviation from this plan.

Definition of complete: all release gates in section 1.2 and all applicable checks in section 7 pass; production-only shipping/paging dependencies are explicitly handed off with owners rather than silently marked done.

---

## 12. Changelog

| Date | Change |
|------|--------|
| 2026-08-04 | Initial source and live-sample review |
| 2026-08-04 | Corrected channel model, request-ID risk, alert transaction ownership, incident fingerprinting, gateway privacy and production priorities |
| 2026-08-04 | Added ordered Grok implementation work packages, tests and definition of done |
