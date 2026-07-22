# DProxy Integration — Implementation Plan

> **For Claude Code:** implement task-by-task, test-first where practical, and tick each checkbox after verification. Do not fold DProxy-specific response parsing into `RealApiAdapter`; keep the marketplace lifecycle generic and isolate the supplier contract in a dedicated adapter.

**Goal:** Integrate DProxy as an admin-curated proxy provider. A buyer can purchase one active DProxy assignment, receive normalized proxy credentials, and rotate the upstream IP through the marketplace without receiving the provider API key or being able to call arbitrary upstream URLs.

**Architecture:** Add a thin `DProxyAdapter` for DProxy HTTP/auth/payload details, a persistent `ProxyAllocation` binding between an upstream assignment and an order, and a buyer-authorized rotate endpoint. Reuse existing order provisioning, provider call logging, encrypted provider config, fallback selection, and escrow lifecycle. The seller gateway remains for metered API forwarding; it is not used as the DProxy allocation mechanism.

**Target branch/worktree:** `feature/seller-connect-gateway` in `.claude/worktrees/seller-connect-gateway-fix`.

**Tech stack:** FastAPI, SQLAlchemy async, PostgreSQL/Alembic, httpx, pytest-asyncio, Next.js.

**Local upstream available:** `marketplace-svc/scripts/mock_dproxy.py` implements
the supplier list/rotate contract plus deterministic control modes. Follow
`docs/dproxy-mock-runbook.md` for admin→seller/product→buyer→rotate E2E setup;
reuse this HTTP mock in integration tests instead of mocking adapter internals.

## Supplier contract used by this plan

List assignments:

```http
GET {base_url}/api/v1/proxies/user
```

Representative response:

```json
[
  {
    "id": "cab68c1a-707c-4148-a326-e69e99c870db",
    "assigned_at": "2026-07-20T12:35:46.296225+00:00",
    "expired_at": "2026-07-27T12:35:46.296225+00:00",
    "status": "active",
    "username": "u_24_pkvgq9za",
    "password": "pass",
    "is_active": true,
    "proxies": {
      "host": "s4.dproxy.info",
      "port": 20160,
      "status": {"msg": "online"},
      "proxy_id": "54f6fb0c-45cf-4a6a-9ecf-2797f50f94f8",
      "ip_public": "116.106.0.187",
      "rotation": {
        "available": true,
        "mode": "pppoe",
        "cooldown_seconds": null,
        "last_rotated_at": null,
        "rotate_endpoint": "/api/v1/proxies/user/cab68c1a-707c-4148-a326-e69e99c870db/rotate"
      }
    }
  }
]
```

## Decisions and non-goals

- One upstream assignment `id` is exclusive to one marketplace order by default. Never deliver the same assignment to two orders accidentally.
- The list endpoint is inventory discovery, not proof that DProxy created a new proxy for the order. When no unbound active assignment exists, provisioning fails as out of stock.
- `rotate_endpoint` is untrusted provider data. The backend validates its exact expected shape and calls it against the configured DProxy origin; the frontend never receives an actionable upstream URL or provider credential.
- Gateway-key rotation (`POST /orders/{id}/gateway-key/rotate`) and proxy-IP rotation are separate operations and must retain separate names/routes/tests.
- Do not generalize arbitrary request/response templates in this change. A dedicated adapter is cheaper and safer until a second provider demonstrates the same contract.
- Do not modify `db/marketplace-seed.sql`; schema changes go through Alembic.
- Do not log DProxy passwords, provider API keys, raw list responses, or `Order.delivered_data`.
- Existing unrelated dirty files in this worktree belong to the current feature work. Preserve them and avoid broad formatting/rewrite commands.

## Open contract questions to resolve before production

Implementation may use the defaults below in tests, but deployment configuration must explicitly confirm them:

1. Authentication scheme: default plan supports Bearer; confirm whether production uses `Authorization: Bearer`, `X-API-Key`, or another header.
2. Rotate method and response: default `POST`; confirm status codes, response body, and whether the list endpoint must be polled afterward for the new IP.
3. Allocation policy: confirm an assignment must be exclusive to one buyer/order. If assignments are intentionally shared, design that as a separate explicit policy with security review.
4. Password visibility: confirm the list API always returns the current password and whether rotation can change it.
5. Revocation/release: no DProxy revoke endpoint is supplied. This plan releases only the marketplace binding after terminal lifecycle rules; it does not cancel the upstream subscription.

---

### Task 1: Add normalized proxy domain types and adapter capability

**Files:**

- Modify: `marketplace-svc/src/adapters/base.py`
- Create: `marketplace-svc/src/adapters/dproxy.py`
- Test: `marketplace-svc/tests/test_dproxy_adapter.py`

**Interfaces:**

```python
@dataclass(frozen=True)
class ProxyAssignment:
    external_id: str
    proxy_id: str | None
    host: str
    port: int
    username: str
    password: str
    public_ip: str | None
    assigned_at: datetime | None
    expires_at: datetime
    rotation_available: bool
    rotation_mode: str | None
    cooldown_seconds: int | None
    last_rotated_at: datetime | None
    rotate_path: str | None

    def delivered_text(self) -> str: ...


class RotatableProxyAdapter(ProviderAdapter, ABC):
    async def list_assignments(self) -> list[ProxyAssignment]: ...
    async def rotate_assignment(self, external_id: str) -> ProxyAssignment: ...
```

- [ ] Write parsing tests for the sample payload, empty arrays, multiple assignments, nullable nested fields, numeric/string ports, malformed timestamps, missing credentials, inactive/offline/expired entries, and invalid top-level objects.
- [ ] `DProxyAdapter.list_assignments()` calls `GET /api/v1/proxies/user`, requires a JSON list, parses each item defensively, and returns only usable assignments: `status == "active"`, `is_active is True`, nested proxy status is `online`, credentials/host/port exist, and `expired_at > now`.
- [ ] Define a typed supplier error hierarchy such as `DProxyContractError`, `DProxyAuthError`, and `DProxyUnavailableError`; never let `AttributeError`/`KeyError` escape for malformed supplier payloads.
- [ ] Support config keys `base_url`, `api_key`, `auth_type` (`bearer` or `header`), `auth_header` when `auth_type=header`, `list_path` defaulting to `/api/v1/proxies/user`, and `rotate_method` defaulting to `POST`.
- [ ] Reuse retry and provider-call logging behavior without inheriting the old `/provision` response assumptions. Prefer extracting a small shared HTTP requester from `RealApiAdapter` only if this can be done without changing its observable behavior or current tests.
- [ ] `delivered_text()` produces buyer-safe data such as `host:port:username:password`, plus public IP and expiry on separate labeled lines. It must not include `rotate_path`, provider API key, or internal IDs unless product requirements explicitly need them.
- [ ] Run `uv run pytest tests/test_dproxy_adapter.py -q`.

---

### Task 2: Persist exclusive upstream assignment-to-order bindings

**Files:**

- Create: `marketplace-svc/src/models/proxy_allocation.py`
- Modify: `marketplace-svc/src/models/__init__.py`
- Create: `marketplace-svc/alembic/versions/<revision>_proxy_allocations.py`
- Test: `marketplace-svc/tests/test_dproxy_allocation.py`

**Model:**

```text
proxy_allocations
  id                  bigint primary key
  provider_id         FK providers.id, not null
  order_id            FK orders.id, unique, not null
  external_id         varchar(100), not null
  external_proxy_id   varchar(100), null
  status              allocated | expired | released | error
  expires_at           timestamptz, not null
  rotate_path          text, null
  rotation_available   boolean, not null default false
  cooldown_seconds     integer, null
  last_rotated_at      timestamptz, null
  last_public_ip       varchar(64), null
  created_at/updated_at timestamptz
```

Required constraints/indexes:

- `UNIQUE(provider_id, external_id)` prevents cross-order double delivery.
- `UNIQUE(order_id)` gives one DProxy assignment per order in this phase.
- Index `(provider_id, status, expires_at)` for inventory/lifecycle jobs.
- `rotate_path` is metadata, not authorization; every use must still validate it.

- [ ] Write migration upgrade/downgrade and import the model so metadata-based tests see it.
- [ ] Add repository/service functions: `get_order_proxy_allocation`, `bind_first_available_assignment`, `mark_allocation_expired`, and `release_allocation`.
- [ ] `bind_first_available_assignment` handles two orders provisioning concurrently. Iterate usable supplier candidates inside nested transactions/savepoints; insert and flush the binding. On the unique constraint for a candidate, roll back only the savepoint and try the next candidate.
- [ ] Idempotency rule: if the order already has a binding, return that binding and refresh it from the matching supplier assignment instead of selecting another proxy.
- [ ] Never persist the provider API key. Avoid storing the proxy password in `proxy_allocations`; the credential snapshot delivered to the buyer remains in existing `Order.delivered_data`, consistent with the current resource-delivery model.
- [ ] Test two concurrent orders against one assignment: exactly one succeeds and the other reports no inventory; test two assignments: each order receives a different external ID.
- [ ] Run migration against the test DB, then `uv run pytest tests/test_dproxy_allocation.py -q`.

---

### Task 3: Wire DProxy into provider factory, configuration, and compatibility

**Files:**

- Modify: `marketplace-svc/src/adapters/factory.py`
- Modify: `marketplace-svc/src/adapters/compatibility.py`
- Modify: `marketplace-svc/src/providers/schemas.py`
- Modify: `marketplace-svc/src/providers/service.py`
- Modify: `frontend/lib/pricing-config.ts`
- Modify: `frontend/app/admin/providers/page.tsx`
- Test: `marketplace-svc/tests/test_adapters.py`
- Test: `marketplace-svc/tests/test_providers.py`

- [ ] Register `"dproxy": DProxyAdapter` in `ADAPTER_MAP` and allow pricing strategies `config` and `credit` initially, matching proxy subscription/package products.
- [ ] Keep `dproxy` admin-curated only. Do not add it to `SELLER_ALLOWED_ADAPTER_TYPES`; seller self-service remains limited to `seller_gateway` and `seller_task_webhook`.
- [ ] Add admin UI adapter label/description and DProxy-specific connection fields. At minimum: base URL, API key, auth type/header, optional list path, and rotate method.
- [ ] Extend encrypted-config handling so all credential-bearing supported keys remain encrypted at rest. Confirm update-with-empty-secret retains the old encrypted value.
- [ ] Provider validation rejects invalid schemes, missing host, base URLs with credentials/query/fragment, non-relative configured paths, and unsupported auth/HTTP methods. Reuse the feature branch SSRF guard rather than adding a second URL validator.
- [ ] Admin “Test connection” for DProxy calls `list_assignments`, returning only a sanitized summary: usable count, earliest expiry, rotation-supported count, and error category. It must not return passwords or the raw response.
- [ ] Add factory, config encryption, authorization, sanitization, and compatibility tests.

---

### Task 4: Implement DProxy provisioning through the existing order lifecycle

**Files:**

- Modify: `marketplace-svc/src/adapters/dproxy.py`
- Modify: `marketplace-svc/src/orders/service.py` only where persistence context is required
- Modify: `marketplace-svc/src/adapters/factory.py` if the adapter needs the DB session
- Test: `marketplace-svc/tests/test_dproxy_orders.py`

**Expected flow:**

```text
pending order
  -> DProxy list_assignments()
  -> reuse existing binding OR exclusively bind first usable unbound assignment
  -> ProvisionResult(success=True, data=normalized credentials,
                     resource_id=external assignment id,
                     metadata={provider: dproxy, proxy_allocation_id: ...})
  -> existing _apply_provision_result()
  -> delivered order + escrow
```

- [ ] Give `DProxyAdapter` access to the current async DB session, following the pattern used by DB-backed adapters, so allocation binding is atomic with the order update.
- [ ] `provision(order_id, user_config)` ignores buyer-controlled endpoint/ID fields. Supplier paths and assignment selection come only from validated provider config and server state.
- [ ] If an idempotent retry finds an existing allocation, match `external_id` against the fresh DProxy list. If still usable, return the same assignment. If missing/expired, return a typed failure and mark the allocation appropriately; do not silently give the order a different credential after the buyer may already have received the first one.
- [ ] If the supplier returns no usable unbound assignments, return a stable Vietnamese out-of-stock error. Ensure the background sweeper behavior is intentional: retry transient network/5xx errors, but do not retry contract/auth errors indefinitely.
- [ ] Decide how typed adapter errors map to retryable versus terminal `ProvisionResult`. Add a small explicit classification instead of relying on exception class accidents.
- [ ] Ensure `order.provider_id` snapshots the actual resolved provider after fallback, as implemented by the seller-connect-gateway feature.
- [ ] Test success, empty inventory, all inactive/offline/expired, malformed payload, auth failure, transient 5xx retry, idempotent retry, fallback provider, and concurrent order allocation.
- [ ] Assert provider call logs contain method/path/status but no credentials or response body.
- [ ] Run `uv run pytest tests/test_dproxy_orders.py tests/test_orders.py tests/test_adapters.py -q`.

---

### Task 5: Add buyer-authorized proxy IP rotation

**Files:**

- Create or modify: `marketplace-svc/src/resources/proxy_router.py` (or keep in `resources/router.py` if the project convention favors one router)
- Create or modify: `marketplace-svc/src/resources/proxy_service.py`
- Modify: application router registration
- Modify: `marketplace-svc/src/adapters/dproxy.py`
- Test: `marketplace-svc/tests/test_dproxy_rotate.py`

**Route:**

```http
POST /orders/{order_id}/proxy/rotate
Authorization: buyer JWT
```

Do not overload `/orders/{order_id}/gateway-key/rotate`.

- [ ] Authorize by `order.buyer_id`; return 404 for another buyer to avoid leaking order existence.
- [ ] Require order status `delivered` or `completed`, a DProxy provider snapshot, an active non-expired allocation, and `rotation_available=True`.
- [ ] Validate the stored/provider-returned rotate path with an exact pattern based on the bound external ID:

```text
^/api/v1/proxies/user/<URL-escaped exact external_id>/rotate$
```

Do not accept absolute URLs, `//host`, dot segments, query strings, fragments, redirects to another origin, or buyer-supplied paths.
- [ ] Configure the httpx client not to follow redirects for rotation. Treat any 3xx as provider error.
- [ ] Enforce local cooldown using `last_rotated_at + cooldown_seconds` where supplied. Return 429 with `retry_after_seconds`; do not call DProxy during cooldown.
- [ ] Call the configured rotate method (default `POST`). On success, call `list_assignments()` and match the same `external_id` to obtain authoritative new `ip_public`, password, expiry, rotation flags, and timestamps.
- [ ] Update allocation metadata and refresh `Order.delivered_data` only if credentials changed. Return a sanitized response:

```json
{
  "ok": true,
  "public_ip": "116.106.0.187",
  "last_rotated_at": "...",
  "cooldown_seconds": null,
  "expires_at": "..."
}
```

- [ ] Serialize rotations for the same allocation with `SELECT ... FOR UPDATE` so two simultaneous clicks cannot bypass cooldown or send duplicate upstream rotations.
- [ ] Test ownership, status gates, unavailable rotation, expiry, cooldown, concurrent rotate, malicious rotate paths, redirects, upstream 4xx/5xx, malformed post-rotate list response, and successful IP refresh.
- [ ] Verify this endpoint never consumes `OrderBalance` units: proxy rotation is resource lifecycle, not seller-gateway metered forwarding, unless a future product explicitly prices rotations.

---

### Task 6: Expose rotation state in buyer UI without leaking upstream details

**Files:**

- Modify: `frontend/lib/api.ts`
- Modify: `frontend/lib/types.ts`
- Modify: buyer order/proxy dashboard components, likely `frontend/app/orders/page.tsx` and `frontend/components/ServiceDashboard.tsx`
- Backend schema/route for reading sanitized proxy allocation state as needed
- Test/build: frontend typecheck/build

- [ ] Add a sanitized order proxy state response containing public IP, expiry, rotation availability, cooldown remaining, and last rotation time. Do not expose `rotate_path`, provider base URL/API key, or internal allocation ID.
- [ ] Show “Đổi IP” only for the owning buyer and only when rotation is available and the order is usable.
- [ ] Disable the button during cooldown and while the request is pending; prevent double submit.
- [ ] After success, refresh displayed public IP and timestamps. Provide actionable Vietnamese errors for cooldown, expired proxy, unavailable rotation, and provider outage.
- [ ] Keep gateway-key rotation UI semantically separate (“Đổi gateway key”) so users cannot confuse it with “Đổi IP proxy”.
- [ ] Run `npm run build` or `npx tsc --noEmit` in `frontend/`.

---

### Task 7: Lifecycle reconciliation and operations visibility

**Files:**

- Modify: `marketplace-svc/src/scheduler.py`
- Create/modify: proxy allocation service
- Modify: admin provider/resource views as appropriate
- Test: `marketplace-svc/tests/test_dproxy_reconciliation.py`

- [ ] Add a bounded reconciliation job for active DProxy allocations. Fetch each provider inventory once per run, then reconcile all active bindings in memory by `external_id`; do not issue one list request per order.
- [ ] Mark bindings expired/missing/error without deleting audit history. Do not automatically assign a replacement credential to an already-delivered order.
- [ ] Surface admin-safe metrics: upstream total/usable/bound/unbound, expiring soon, offline, rotation capable, last sync status/time. Never expose passwords.
- [ ] Alert on malformed supplier contract, auth failure, sustained provider outage, duplicate upstream IDs, and delivered allocations disappearing before marketplace expiry.
- [ ] Decide the business action for upstream expiry before escrow/product duration. Default for this implementation: flag allocation error and create an alert; do not auto-refund without an explicit policy decision.
- [ ] Add tests ensuring reconciliation is batched, idempotent, and does not overwrite buyer-visible credentials with another assignment.

---

### Task 8: Golden contract, regression suite, and delivery checklist

**Files:**

- Add DProxy fixtures/builders under `marketplace-svc/tests/`
- Update relevant operational documentation
- Optional: add a disabled-by-default live probe script that reads credentials from environment only

- [ ] Create reusable fixtures for valid, inactive, offline, expired, malformed, and rotating DProxy payloads. Use obviously fake passwords and hosts in committed fixtures.
- [ ] Golden contract test verifies request method/path/auth, array parsing, normalization, exclusive allocation, idempotent provision, sanitized delivery, rotate path validation, cooldown, post-rotate refresh, and secret-free logging.
- [ ] Run focused tests:

```bash
cd marketplace-svc
uv run pytest tests/test_dproxy_adapter.py tests/test_dproxy_allocation.py \
  tests/test_dproxy_orders.py tests/test_dproxy_rotate.py \
  tests/test_dproxy_reconciliation.py -q
```

- [ ] Run backend regression suite:

```bash
cd marketplace-svc
uv run pytest tests/ -x -q
```

- [ ] Run frontend verification:

```bash
cd frontend
npm run build
```

- [ ] Run Alembic upgrade/downgrade/upgrade against a disposable DB.
- [ ] Security review checklist: SSRF/path escape, redirect handling, authorization, concurrency, secret encryption/redaction, raw-response logging, cooldown bypass, and replay/idempotency.
- [ ] Document required provider config and the five open production contract answers at the top of this plan.
- [ ] Before enabling the provider, run one controlled staging flow: discover inventory → purchase → confirm delivered credentials → rotate once → confirm the same external assignment has a new public IP → confirm another order cannot receive that assignment.

## Definition of done

- `adapter_type=dproxy` can be configured and health-tested by admin without revealing credentials.
- A purchase binds exactly one usable DProxy assignment exclusively and idempotently to the order.
- DProxy array responses and malformed/error responses are handled explicitly; no `.get()` call is made on an unchecked top-level value.
- Buyer receives normalized proxy credentials and can rotate the proxy IP through a dedicated authorized marketplace endpoint.
- Provider API keys and rotate URLs are never exposed to buyers or logs.
- Concurrent purchases and rotations cannot duplicate allocation or bypass cooldown.
- Gateway-key rotation remains unchanged and distinct.
- Focused tests, full backend tests, frontend build, and migration round-trip pass.
