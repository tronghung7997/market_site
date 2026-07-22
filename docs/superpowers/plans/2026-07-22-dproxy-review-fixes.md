# DProxy Review Feedback — Fix Before Mock E2E / Push

> **For Claude Code:** commit `62d01ac` has a sound architecture and its focused
> suite passes, but do not push or declare staging-ready until every blocker and
> regression test below is completed. Preserve unrelated worktree changes.

## Review verification already performed

- Alembic has one head: `ac1a2b3c4d5e6`.
- Focused DProxy suite passed against PostgreSQL: `81 passed in 118.79s`.
- Passing tests do not currently cover password-only rotation, offline recovery,
  or hostile upstream `external_id` values.

## Blocker 1: Always refresh buyer credentials after successful rotation

Current bug:

- `src/resources/proxy_service.py::apply_rotated_assignment()` claims to detect
  public IP/password/expiry changes but compares only public IP and expiry.
- `ProxyAllocation` stores no password, username, host, or port fingerprint.
- If DProxy changes password while IP/expiry stay equal, `Order.delivered_data`
  remains stale and the buyer receives unusable credentials.

Required fix:

- After `adapter.rotate_assignment()` succeeds, always set:

```python
order.delivered_data = assignment.delivered_text()
```

- Do not add plaintext proxy credentials to `proxy_allocations` just to detect
  changes. Rotation is infrequent; an unconditional snapshot refresh is simpler
  and safer.
- Adjust/remove the misleading `credentials_changed` return contract and
  docstring.

Required regression test:

- Supplier returns the same public IP and expiry after rotate but a new password.
- Assert rotate returns success and persisted `Order.delivered_data` contains the
  new password and no longer contains the old password.
- Add equivalent coverage for changed username/host/port if the normalized
  contract permits them to change.

## Blocker 2: Offline is not permanently missing/error

Current bug:

- `_parse_assignment()` drops offline/inactive/expired rows.
- Reconciliation consumes only this filtered usable list.
- A temporarily offline bound assignment is therefore considered missing and
  moved immediately to `ProxyAllocationStatus.error`.
- Later runs query only `allocated` rows, so the assignment can never recover
  when it returns online.

Required design:

- Parse inventory in two stages:
  1. defensive normalized raw assignment/state, including offline/inactive and
     expired rows when identity and structure are valid;
  2. usable inventory filter for new provisioning.
- Provision may select only active + `is_active` + online + unexpired rows.
- Reconciliation must distinguish:
  - present + online: refresh metadata, restore a recoverable offline state;
  - present + offline/inactive: mark `offline`/`degraded`, not permanent error;
  - present + expired: mark `expired`;
  - genuinely absent: mark error only according to an explicit policy, ideally
    after consecutive misses/grace period to avoid one bad supplier response.
- Add an allocation status such as `offline` if needed, with Alembic migration
  handling PostgreSQL enum upgrade/downgrade correctly.
- Reconciliation must include recoverable statuses in its query so offline →
  online can return to `allocated`.
- Buyer state should expose the sanitized degraded/offline status and disable
  rotate while offline.

Required regression tests:

1. Bound assignment is online → reconciliation sees it offline → state becomes
   recoverable offline/degraded, not permanent error.
2. Next reconciliation sees the same `external_id` online → state returns to
   allocated and rotate becomes available again.
3. Expired assignment becomes expired.
4. Genuinely missing assignment follows the selected miss/grace policy.
5. One malformed unrelated row does not damage valid bound assignments.

## Blocker 3: Validate or encode `external_id` before constructing paths

Current bug:

```python
return f"/api/v1/proxies/user/{external_id}/rotate"
```

`external_id` comes from an upstream response and is currently any truthy value.
Values containing slash, dot segments, query, or fragment syntax can be
normalized into unintended paths on the same provider origin.

Required fix — prefer strict UUID because the supplied DProxy contract uses UUID:

```python
from uuid import UUID

external_id = str(UUID(str(raw_external_id)))
```

- Reject non-UUID assignment IDs during parsing.
- Build paths only from the canonical UUID string.
- If production DProxy confirms IDs are not always UUID, use
  `urllib.parse.quote(external_id, safe="")` and still reject control characters,
  empty values, and excessive length.

Required regression tests:

- Reject `../../health`.
- Reject `abc/rotate`.
- Reject `abc?x=1`.
- Reject `abc#fragment`.
- Reject an ID longer than the DB column limit.
- Assert a canonical valid UUID still produces exactly the documented rotate
  endpoint.

## Required medium fixes

### A. Remove or correctly support configurable `list_path`

Current list calls use configured `list_path`, while rotate validation and
construction hard-code `/api/v1/proxies/user`.

Choose one:

- Recommended for this integration: remove `list_path` from DProxy UI/config and
  use the fixed supplier contract everywhere.
- Or make rotate construction/validation derive from the validated adapter
  `self.list_path`, with complete tests.

Do not leave a config option that makes listing work while silently disabling
rotation.

### B. Always validate effective DProxy config on provider update

Current update validation runs only when `"config" in updates`. A request can
switch an existing provider to `adapter_type=dproxy` without validating its
existing config.

Use:

```python
if next_adapter_type == "dproxy":
    await validate_dproxy_config(next_config or {})
```

Tests:

- Switching adapter type to DProxy with incompatible existing config returns 400.
- Updating non-config DProxy fields with valid existing encrypted config remains
  valid.
- Updating config preserves an omitted/unchanged API key according to the admin
  UI contract.

### C. Provider “Test kết nối” must not provision order `0`

Generic `_run_provider_test()` calls `provision(order_id=0)` after healthy status.
For DProxy this performs a second inventory request and attempts an allocation
against a nonexistent order, producing misleading results.

- DProxy provider test returns only its sanitized inventory/health summary.
- It must not call `DProxyAdapter.provision()` or create a `ProxyAllocation`.
- Test that one admin health action performs exactly one list call, creates zero
  allocations, and exposes no username/password/raw payload.

## Mock E2E does not require Cloudflare Tunnel

Cloudflare is not a prerequisite for local full-flow testing.

### Native backend

Start mock:

```bash
cd marketplace-svc
set -a
source .env.mock-dproxy
set +a
uv run uvicorn scripts.mock_dproxy:app --host 127.0.0.1 --port 9200
```

Configure the admin-curated DProxy provider with:

```json
{
  "base_url": "http://127.0.0.1:9200",
  "api_key": "<value from MOCK_DPROXY_API_KEY>",
  "auth_type": "bearer",
  "rotate_method": "POST"
}
```

### Backend inside Docker Desktop

Use:

```json
{"base_url": "http://host.docker.internal:9200"}
```

Do not use container-local `127.0.0.1`; that points back to the marketplace
container.

### What Cloudflare is for

`https://mock-dproxy.fin4r.com` is only needed when the marketplace backend is
not on the same machine/network or for public staging. The named tunnel and DNS
exist, but the connector cannot run on the current network until outbound
TCP/UDP port 7844 to Cloudflare edge is allowed. This does not block localhost
E2E.

## Required mock contract updates

Extend `scripts/mock_dproxy.py` controls so the missing regressions are testable
over the actual HTTP boundary:

- Patch assignment credentials independently: username, password, host, port,
  and public IP.
- Add a rotate behavior that changes password without changing public IP/expiry.
- Existing controls must continue to cover offline, expired, rotation unavailable,
  cooldown, empty inventory, malformed list, list 500, rotate 500, and malformed
  rotate response.
- If strict UUID parsing is chosen, all default mock assignment IDs must remain
  canonical UUIDs.

Add/extend `tests/test_mock_dproxy.py` to verify those controls themselves.

## Mandatory local E2E scenarios

Run these against the real marketplace HTTP API plus the standalone mock — do
not monkeypatch `DProxyAdapter` in these scenarios:

1. Admin creates DProxy provider and tests connection; no allocation is created.
2. Admin/seller links provider to a compatible proxy product.
3. Buyer purchases; order becomes delivered with assignment #1 credentials.
4. Second buyer purchases; receives assignment #2, never #1.
5. Buyer rotates; delivered data and proxy state refresh.
6. Password-only rotate refreshes delivered password.
7. Immediate second rotate returns 429 and mock confirms only one upstream rotate.
8. Proxy goes offline, reconciliation runs, buyer state is degraded but binding is
   preserved; proxy comes online, next reconciliation restores it.
9. Empty inventory follows the intended cancel/refund behavior.
10. List 500 leaves provision pending for sweep retry; malformed contract and auth
    failures follow terminal policy.
11. Another buyer cannot read or rotate the order proxy.
12. Tampered DB `rotate_path` is ignored.

For deterministic setup/reset, use the mock control API documented in
`docs/dproxy-mock-runbook.md`.

## Verification commands

Focused backend suite:

```bash
cd marketplace-svc
.venv/bin/pytest \
  tests/test_dproxy_adapter.py \
  tests/test_dproxy_allocation.py \
  tests/test_dproxy_orders.py \
  tests/test_dproxy_rotate.py \
  tests/test_dproxy_reconciliation.py \
  tests/test_mock_dproxy.py -q
```

Then full regression and frontend:

```bash
cd marketplace-svc && .venv/bin/pytest tests/ -x -q
cd frontend && npx tsc --noEmit && npm run build
```

Run Alembic upgrade/downgrade/upgrade round-trip if the allocation enum/model
changes.

## Definition of done for the review fixes

- Password/host/port/username changes after rotate cannot leave stale buyer data.
- Temporary offline state is recoverable and never becomes permanent error after
  one reconciliation.
- No unvalidated upstream ID can influence an actionable request path.
- DProxy config options are internally consistent.
- Switching adapter type cannot bypass config validation.
- Admin health test never creates or attempts an allocation.
- Mock HTTP-boundary tests and the 12 local E2E scenarios pass without requiring
  Cloudflare Tunnel.
- Focused suite, full backend suite, frontend typecheck/build, and migration
  round-trip pass before push.
