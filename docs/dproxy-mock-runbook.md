# Mock DProxy runbook

Live API (`api.dproxy.info`) and the M2M partner-purchase contract: [`dproxy/api.md`](./dproxy/api.md). Snapshot: [`dproxy/openapi.json`](./dproxy/openapi.json).

`marketplace-svc/scripts/mock_dproxy.py` is a stateful HTTP fake for local and
E2E testing. It exposes the DProxy-shaped endpoints to marketplace code and a
separate authenticated control API for deterministic failure scenarios.

## Start

```bash
cd marketplace-svc
uv run uvicorn scripts.mock_dproxy:app --host 0.0.0.0 --port 9201 --reload
```

Dashboard uses HTTP Basic auth. Local defaults are `admin` / 
`mock-dashboard-password`. Never expose those defaults publicly.

Default provider values:

```json
{
  "adapter_type": "dproxy",
  "config": {
    "base_url": "http://127.0.0.1:9201",
    "api_key": "mock-dproxy-token",
    "auth_type": "bearer"
  }
}
```

Mở dashboard để xem inventory, đổi mode và bấm rotate trực tiếp:

```text
http://127.0.0.1:9201/
```

If marketplace runs inside a container, `127.0.0.1` points at that container,
not the host. Use `http://host.docker.internal:9201` on Docker Desktop, or put
both services on the same Compose network and use the mock service name.

## Verify the supplier contract

```bash
curl -sS http://127.0.0.1:9201/api/v1/proxies/user \
  -H 'Authorization: Bearer mock-dproxy-token'
```

The mock starts with three active, online, unexpired residential assignments.
Their IDs are stable across resets; timestamps are generated relative to the
current time.

Rotate the first assignment using the `rotate_endpoint` returned by the list:

```bash
curl -sS -X POST \
  http://127.0.0.1:9201/api/v1/proxies/user/00000000-0000-4000-8000-000000000001/rotate \
  -H 'Authorization: Bearer mock-dproxy-token'
```

An immediate second rotation returns `429` plus `Retry-After`.

## Catalog and on-demand purchase

`GET /api/v1/catalog` reports what the deployment currently supports
selecting on — any key can be `null`, meaning that dimension isn't offered
(the buyer-facing form should then not require/show it):

```bash
curl -sS http://127.0.0.1:9201/api/v1/catalog \
  -H 'Authorization: Bearer mock-dproxy-token'
```

`POST /api/v1/proxies/order` buys ONE fresh assignment matching the given
country/type/duration (`quantity` must be `1`):

```bash
curl -sS -X POST http://127.0.0.1:9201/api/v1/proxies/order \
  -H 'Authorization: Bearer mock-dproxy-token' -H 'Content-Type: application/json' \
  -d '{"country":"VN","type":"residential","duration_days":7,"quantity":1}'
```

## Deterministic E2E controls

Control calls use a different credential:

```bash
CONTROL='X-Mock-Control-Key: mock-dproxy-control'
```

Reset inventory and failure mode:

```bash
curl -sS -X POST http://127.0.0.1:9201/_mock/reset -H "$CONTROL"
```

Available global modes:

- `normal`
- `list_500`
- `list_malformed`
- `list_empty`
- `rotate_500`
- `rotate_malformed`

Example:

```bash
curl -sS -X PUT http://127.0.0.1:9201/_mock/mode \
  -H "$CONTROL" -H 'Content-Type: application/json' \
  -d '{"mode":"list_empty"}'
```

Reconfigure the catalog to simulate a deployment that doesn't support a given
dimension (e.g. no country support — set it to `null`):

```bash
curl -sS -X PUT http://127.0.0.1:9201/_mock/catalog \
  -H "$CONTROL" -H 'Content-Type: application/json' \
  -d '{"countries":null,"types":["residential","datacenter"],"durations_days":[3,7,30]}'
```

Make one assignment offline, expired, or non-rotatable:

```bash
curl -sS -X PATCH \
  http://127.0.0.1:9201/_mock/assignments/00000000-0000-4000-8000-000000000001 \
  -H "$CONTROL" -H 'Content-Type: application/json' \
  -d '{"proxy_status":"offline","expires_in_seconds":-1,"rotation_available":false}'
```

Inspect mock state:

```bash
curl -sS http://127.0.0.1:9201/_mock/state -H "$CONTROL"
```

## Full marketplace scenario after DProxyAdapter lands

1. Start Postgres/Redis, marketplace backend, frontend, and this mock.
2. Admin creates and tests an `adapter_type=dproxy` provider using the config above.
3. Admin links the approved provider to a proxy product using either pricing
   strategy: `credit` with `package_size` fixed at 1 for a no-selection
   "quick buy" flow, or `config` (type/network/days) for a buyer-selectable
   country/type/duration flow — the latter now actually purchases a fresh
   assignment matching the buyer's choice via `POST /api/v1/proxies/order`
   (see `GET /api/v1/catalog` below for the mock's configurable option
   list). Both are DProxyAdapter-honored end to end; `quantity` stays fixed
   at 1 either way — one order always binds exactly one `ProxyAllocation`.
4. Buyer funds the wallet and purchases the product.
5. Confirm the delivered order contains normalized proxy credentials and the
   admin allocation view shows the stable upstream assignment ID.
6. Buyer calls `POST /orders/{order_id}/proxy/rotate`; confirm public IP changes.
7. Repeat immediately; confirm cooldown UI/API returns 429 and no second rotate occurs.
8. Reset, switch to `list_empty`, and confirm a new purchase follows the intended
   out-of-stock/refund behavior.
9. Switch to `list_malformed` and `list_500`; confirm contract and transient
   errors are classified differently, secrets remain absent from logs, and the
   order lifecycle matches the DProxy implementation plan.

## Environment variables

- `MOCK_DPROXY_PORT` (default `9201`)
- `MOCK_DPROXY_API_KEY` (default `mock-dproxy-token`)
- `MOCK_DPROXY_CONTROL_KEY` (default `mock-dproxy-control`)
- `MOCK_DPROXY_AUTH_TYPE` (`bearer` or `header`, default `bearer`)
- `MOCK_DPROXY_AUTH_HEADER` (default `X-API-Key`)
- `MOCK_DPROXY_COOLDOWN_SECONDS` (default `15`)

These defaults are for local development only.

## Fixed Cloudflare domain: mock-dproxy.fin4r.com

Create private local environment values first:

```bash
cd marketplace-svc
cp .env.mock-dproxy.example .env.mock-dproxy
```

Replace all three secrets in `.env.mock-dproxy`, then start the mock:

```bash
set -a
source .env.mock-dproxy
set +a
uv run uvicorn scripts.mock_dproxy:app --host 127.0.0.1 --port 9201
```

One-time named-tunnel setup (requires `cloudflared tunnel login` to have been
completed for the Cloudflare account that owns `fin4r.com`):

```bash
proxychains4 -f ~/.proxychains/proxychains.conf cloudflared tunnel create market-site-mock-dproxy
proxychains4 -f ~/.proxychains/proxychains.conf cloudflared tunnel route dns --overwrite-dns \
  market-site-mock-dproxy mock-dproxy.fin4r.com
proxychains4 -f ~/.proxychains/proxychains.conf cloudflared tunnel list
```

The create command prints a tunnel UUID. Create `~/.cloudflared/mock-dproxy.yml`
with that value:

```yaml
tunnel: REPLACE_WITH_TUNNEL_UUID
credentials-file: /Users/logan/.cloudflared/REPLACE_WITH_TUNNEL_UUID.json
ingress:
  - hostname: mock-dproxy.fin4r.com
    service: http://127.0.0.1:9201
  - service: http_status:404
```

Run the fixed tunnel:

```bash
cloudflared tunnel --config ~/.cloudflared/mock-dproxy.yml run
```

Management commands need `proxychains4` on this network. Tunnel runtime is a
different data-plane connection and needs outbound TCP/UDP port `7844` to
Cloudflare edge hosts; the HTTP proxy at `192.168.56.2:8080` currently allows
Cloudflare API port 443 but rejects tunnel edge port 7844.

URLs:

- Dashboard: `https://mock-dproxy.fin4r.com/` (browser prompts for Basic auth)
- Supplier list: `https://mock-dproxy.fin4r.com/api/v1/proxies/user`
- Provider `base_url`: `https://mock-dproxy.fin4r.com`

Use the value of `MOCK_DPROXY_API_KEY` as the provider API key. The dashboard,
supplier API, and test-control API intentionally use three different secrets.
