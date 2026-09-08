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
    "auth_type": "bearer",
    "channel": "proxora",
    "plan_ids": {
      "residential|VN|7": "1906e1af-70df-4a53-8874-53b8e5a51935",
      "datacenter|US|30": "39c0cf21-b47b-42ec-b159-4b1f4c60e184"
    }
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

`GET /api/v1/store/plans` is the live M2M catalog (`ProxySalesPlanResponse`):

```bash
curl -sS http://127.0.0.1:9201/api/v1/store/plans \
  -H 'Authorization: Bearer mock-dproxy-token'
```

`POST /api/v1/customer/marketplace/partner-purchase` buys ONE assignment for
a `plan_id` (`quantity` must be `1`):

```bash
curl -sS -X POST http://127.0.0.1:9201/api/v1/customer/marketplace/partner-purchase \
  -H 'Authorization: Bearer mock-dproxy-token' -H 'Content-Type: application/json' \
  -d '{"partner_order_id":"THM-987654","plan_id":"1906e1af-70df-4a53-8874-53b8e5a51935","quantity":1,"channel":"proxora"}'
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
- `purchase_500`
- `purchase_malformed`

Example:

```bash
curl -sS -X PUT http://127.0.0.1:9201/_mock/mode \
  -H "$CONTROL" -H 'Content-Type: application/json' \
  -d '{"mode":"list_empty"}'
```

Replace the sales-plan catalog:

```bash
curl -sS -X PUT http://127.0.0.1:9201/_mock/plans \
  -H "$CONTROL" -H 'Content-Type: application/json' \
  -d '{"plans":[{"id":"1906e1af-70df-4a53-8874-53b8e5a51935","name":"Residential VN 7d","proxy_count":1,"duration_days":7,"price":1.5,"currency":"USD"}]}'
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

### Recommended admin workflow

The admin UI deliberately treats the provider as the connection, not as a
sellable product. Configure DProxy in this order:

1. Create a DProxy provider with only the API URL and API key. The live URL is
   `https://api.dproxy.info`; local mock is `http://127.0.0.1:9201`.
2. Reopen **Kết nối API**, click **Kiểm tra kết nối và tải gói**, then turn on
   the packages that may be sold. Each package is shown as buyer-facing type,
   country, and days; raw `plan_ids` JSON is available only under
   **Cấu hình nâng cao**.
3. Save. The panel continues to **Sản phẩm liên kết** instead of ending the
   workflow.
4. Attach one marketplace product, click **Giá**, select one enabled DProxy
   package, and enter the amount the buyer pays for one proxy. The UI generates
   `config` pricing parameters; operators do not calculate the 30-day base or
   multipliers manually.
5. Publish and buy-test the product. The buyer sees only that plan's type,
   country/network, duration, final price, one-proxy quantity, and automatic
   delivery promise.

Use one marketplace product per DProxy plan. This prevents a Cartesian product
of independently configured type/network/duration choices from exposing a
combination that has no upstream `plan_id`.

1. Start Postgres/Redis, marketplace backend, frontend, and this mock.
2. Admin creates and tests an `adapter_type=dproxy` provider using the config above.
3. Admin links the approved provider to a proxy product using either pricing
   strategy: `credit` with `package_size` fixed at 1 for a no-selection
   "quick buy" flow, or `config` (type/network/days) for a buyer-selectable
   country/type/duration flow — the latter purchases a fresh assignment via
   `POST /api/v1/customer/marketplace/partner-purchase` using mapped
   `plan_ids` from `GET /api/v1/store/plans`. Both are DProxyAdapter-honored
   end to end; `quantity` stays fixed
   at 1 either way — one order always binds exactly one `ProxyAllocation`.
4. Buyer funds the wallet and purchases the product.
5. Confirm the delivered order contains normalized proxy credentials and the
   admin allocation view stores the stable upstream **M2M order UUID**. The
   documented purchase response does not expose an assignment UUID.
6. For `credit` only, buyer calls `POST /orders/{order_id}/proxy/rotate`; confirm
   public IP changes, then repeat immediately and confirm cooldown returns 429.
   Do not advertise rotation for `config` M2M orders until DProxy returns an
   assignment identifier and rotation metadata in that contract.
7. For `credit`, switch to `list_empty`, `list_malformed`, and `list_500` to
   verify inventory failure/refund behavior.
8. For `config`, switch to `purchase_malformed` and `purchase_500`; verify the
   M2M contract/transient errors, refund lifecycle, and redacted provider logs.
9. Retry provisioning the same order and verify the same `partner_order_id` is
   replayed, only one allocation exists, and no second supplier order is made.

## Automated seller-to-buyer E2E

The repeatable automated test is
`marketplace-svc/tests/test_seller_mock_e2e.py`. It uses the public marketplace
HTTP routes and the real PostgreSQL test database. Only the external seller API
is replaced by the in-process `scripts.mock_seller` ASGI app.

Run it from the backend directory:

```bash
cd marketplace-svc
uv run pytest -q tests/test_seller_mock_e2e.py
```

Expected result:

```text
1 passed
```

The scenario verifies both supported seller-integration journeys:

1. create seller, buyer, and admin accounts; fund the buyer wallet;
2. seller creates and tests an integration, submits it, and admin approves it;
3. seller creates and activates a product backed by that integration;
4. buyer places an order and the seller can see it in `GET /seller/orders`;
5. the real provisioning service delivers the order and the buyer dashboard
   reports `delivered`;
6. direct-gateway credentials can call the proxied seller endpoint;
7. asynchronous tasks complete through the signed provider callback;
8. approved provider credentials cannot be silently changed.

This test truncates and uses the shared `marketplace_test` database. Never run
it concurrently with another pytest process or a benchmark that uses the same
database. It does not need the frontend, a separately running backend, or live
DProxy credentials.

### Direct UI E2E with Chrome DevTools

Use this when browser rendering and the same-origin Next.js BFF must be tested,
not only the backend domain flow. Start the local backend and frontend using the
repository README. Run seller and buyer in two isolated browser contexts so
their HTTP-only sessions do not overwrite each other.

Seller context:

1. Open `/vi/login?next=/seller/products/new` and sign in as the local seller.
2. On `/vi/seller/products/new`, select instant inventory delivery.
3. Fill the primary-language title, category, service type, escrow period,
   description, package name, price, and at least one mock inventory line.
4. Confirm the readiness panel reaches `5/5`, then click **Mở bán sản phẩm**.
5. Record the product ID from `/vi/seller/products/{product_id}` and confirm the
   page reports `Đang bán` and the expected available stock.

Buyer context:

1. Open `/vi/login?next=/products/{product_id}` and sign in as the local buyer.
2. Confirm the product title, package, stock, price, and escrow period.
3. Click **Mua ngay**, verify the confirmation dialog, then click
   **Xác nhận mua** once.
4. Record the returned order ID. Confirm the page reports `Đã giao`, displays
   exactly the inventory line entered by the seller, and reduces the wallet by
   exactly the displayed total.
5. Open `/vi/orders?order_id={order_id}` and confirm the same status, package,
   quantity, total, escrow date, and delivered data.

Return to the seller context and open
`/vi/seller/orders?order_id={order_id}`. Confirm the order dialog shows the same
buyer, product, package, quantity, total, `Đã giao` status, escrow date, and one
allocated resource.

Keep **Preserve log** enabled and filter Network by `api`. These are the required
checkpoints:

| Request | Expected |
|---|---|
| `POST /api/seller/products` | `201`; creates a draft owned by the seller |
| translation and pricing calls under `/api/seller/products/{id}` | `200` |
| `POST /api/seller/products/{id}/variants` | `201` |
| `POST /api/seller/variants/{variant_id}/resources` | `201` |
| `PUT /api/seller/products/{id}/status` | `200`; payload is `active` |
| `POST /api/orders` | `201`; quantity and variant match the UI |
| `GET /api/seller/orders` | `200`; contains the new order |
| `GET /api/orders/{order_id}/resources` | `200`; contains one delivered line |

Unauthenticated `GET /api/me` calls may return `401` while the login page is
initializing; authenticated workflow requests must not return `4xx` or `5xx`.
Inspect Console separately and record application errors and browser issues.
Use only mock inventory or mock provider endpoints for this run; never use live
`api.dproxy.info` credentials for a destructive purchase test.

Verified on 2026-09-08 through Chrome DevTools against the local stack: seller
created and activated product `#76`; buyer created order `#138`; the order was
delivered immediately, buyer balance decreased by `$1.25`, and both seller and
buyer order dialogs showed the same allocated mock resource.

### Direct DProxy M2M product check

For the actual DProxy-backed product, start and reset `scripts.mock_dproxy`
before opening the buyer UI:

```bash
cd marketplace-svc
uv run uvicorn scripts.mock_dproxy:app --host 127.0.0.1 --port 9201
```

```bash
curl -sS -X POST http://127.0.0.1:9201/_mock/reset \
  -H 'X-Mock-Control-Key: mock-dproxy-control'
```

Then use Chrome DevTools against `/vi/products/{dproxy_product_id}`:

1. choose the exact mapped combination `residential` / `VN` / `7 days`;
2. confirm `POST /api/products/{id}/calculate` returns `200`;
3. click purchase and confirm the dialog shows one dedicated proxy, automatic
   delivery, the selected type/network/duration, and no rotation promise;
4. confirm `POST /api/orders` sends `quantity=1` plus
   `user_config={type: residential, network: VN, days: 7, package_size: 1}`;
5. the create response may initially be `pending`; wait for the UI poll
   `GET /api/orders/{order_id}` to return `delivered`;
6. confirm the buyer sees host, port, username, password, current IP, and expiry;
7. call `GET /_mock/state` with the control key and verify `order_count` increases
   by exactly one and `assignment_count` increases by exactly one;
8. verify the mock server log contains exactly one successful
   `POST /api/v1/customer/marketplace/partner-purchase` for the order.

Verified on 2026-09-08 directly through Chrome DevTools using DProxy product
`#29`: the buyer selected `residential|VN|7`, `POST /api/orders` created order
`#139`, the mock accepted one partner purchase, allocation count changed from
3 to 4, the order became `delivered`, and the wallet decreased by `$0.80`
(`21,000` ledger units at the stored FX snapshot). The delivered proxy was the
new fourth mock assignment. The browser console had no application error; it
reported only missing `id`/`name` accessibility issues on form fields.

## Environment variables

- `MOCK_DPROXY_PORT` (default `9201`)
- `MOCK_DPROXY_API_KEY` (default `mock-dproxy-token`)
- `MOCK_DPROXY_CONTROL_KEY` (default `mock-dproxy-control`)
- `MOCK_DPROXY_AUTH_TYPE` (`bearer` or `header`, default `bearer`; selects the
  dashboard/config hint while supplier endpoints accept either documented form)
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

---

## Operator flow (VI) — seller → admin → buyer

DProxy **chỉ admin tạo provider**. Seller không tự đăng ký `adapter_type=dproxy`.
Một đơn luôn `quantity = 1`.

```
Admin tạo provider dproxy (review_status=approved)
        │
Seller tạo sản phẩm proxy → gắn provider đã duyệt → status=active
        │
Buyer nạp ví → mua
        │
credit  → bind 1 assignment sẵn có (có thể rotate nếu inventory contract cho phép)
config  → POST /api/v1/customer/marketplace/partner-purchase (cần plan_id)
        │
Đơn delivered → config M2M không hiện rotate; credit tùy metadata assignment
```

### 1. Admin — provider

UI: `/admin/providers`, `adapter_type=dproxy`.

Mock:

```json
{
  "base_url": "http://127.0.0.1:9201",
  "api_key": "mock-dproxy-token",
  "auth_type": "bearer"
}
```

M2M (mua theo plan). Form admin có các ô `plan_id`, `plan_ids` và `channel`:

```json
{
  "base_url": "https://api.dproxy.info",
  "api_key": "<token>",
  "auth_type": "bearer",
  "channel": "proxora",
  "plan_id": "1906e1af-70df-4a53-8874-53b8e5a51935",
  "plan_ids": {
    "residential|vn|7": "1906e1af-70df-4a53-8874-53b8e5a51935",
    "datacenter|us|30": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  }
}
```

Key `plan_ids` = `type|network|days` khớp option trên sản phẩm `config`.
Nút Test = health (catalog `plans` + list user), **không** gọi purchase.

### 2. Seller — sản phẩm

1. Buyer nộp đơn seller → admin duyệt.
2. `/seller/products/new` — danh mục proxy, escrow.
3. Gắn `provider_id` DProxy đã approved (seller không tạo được adapter này).
4. Giá:
   - **credit** + `package_size=1`: mua nhanh, bind pool. Chạy được với mock + form admin hiện tại.
   - **config**: buyer chọn type/network/days; cần `plan_ids` trên provider.

Sản phẩm `status=active` mới lên chợ.

### 3. Admin — duyệt

| Việc | Ý nghĩa |
|---|---|
| Duyệt seller | Seller mới tạo sản phẩm |
| Tạo/test provider DProxy | Kết nối mock hoặc live |
| Gắn provider vào sản phẩm | Chỉ provider `approved` |
| `status=active` | Buyer thấy trên chợ |

Provider DProxy do admin tạo sẵn `approved`. Hàng `pending_review` chỉ áp dụng
provider **seller tự đăng ký** (không phải dproxy).

### 4. Buyer

1. Nạp ví → mở sản phẩm.
2. Credit: gần như chỉ bấm mua (số lượng khóa = 1). Config: chọn type/network/days.
3. Đặt hàng → escrow. Thành công: **delivered**, hiện host/port/user/pass.
4. Đơn config M2M không hiện đổi IP vì response purchase không có assignment ID.
   Đơn credit chỉ hiện đổi IP khi assignment inventory báo có rotation.

### 5. Lưu ý UI

- Health UI đọc catalog M2M `plans` và inventory riêng biệt.
- Checkout buyer khóa qty=1 khi `adapter_type === dproxy`.
- `plan_ids` là ma trận authoritative: nếu đã khai báo thì lựa chọn buyer phải
  có key khớp chính xác; hệ thống không fallback sang `plan_id` để tránh giao sai gói.
