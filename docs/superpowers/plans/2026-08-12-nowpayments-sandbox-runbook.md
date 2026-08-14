# NOWPayments USDT — Sandbox / go-live runbook

Linked plan: `2026-08-11-nowpayments-usdt-deposit-plan.md`

## Merchant setup

1. Account: https://account.nowpayments.io/
2. **Direct outcome wallet = USDT BEP20** (`usdtbsc`) — must match `NOWPAYMENTS_OUTCOME_CURRENCY`.
3. Generate API key + IPN secret.
4. Custody **off**; fixed-rate / fee-paid-by-user **off**.
5. Confirm min amount: `GET /v1/min-amount?currency_from=usdtbsc&currency_to=usdtbsc`.

## Env (staging)

```bash
NOWPAYMENTS_ENABLED=false   # flip true after smoke
NOWPAYMENTS_API_KEY=…
NOWPAYMENTS_IPN_SECRET=…
NOWPAYMENTS_BASE_URL=https://api.nowpayments.io/v1
NOWPAYMENTS_DEFAULT_PAY_CURRENCY=usdtbsc
NOWPAYMENTS_ALLOWED_PAY_CURRENCIES=usdtbsc
NOWPAYMENTS_OUTCOME_CURRENCY=usdtbsc
BACKEND_BASE_URL=https://api.example.com   # public HTTPS for IPN
```

IPN URL: `{BACKEND_BASE_URL}/webhooks/nowpayments`

## Local mock (recommended when dashboard sandbox is hard to find)

Hosted checkout uses `POST /v1/invoice`. Point the backend at the mock (note **`/v1`** suffix — client joins paths like `invoice` onto this base):

```bash
# terminal 1 — mock NOW (invoice + auto IPN ~8s)
cd marketplace-svc
uv run uvicorn scripts.mock_nowpayments:app --port 9410

# marketplace-svc/.env (or export) — use mock secrets, not prod keys:
NOWPAYMENTS_ENABLED=true
NOWPAYMENTS_BASE_URL=http://127.0.0.1:9410/v1
NOWPAYMENTS_API_KEY=dev-now-key
NOWPAYMENTS_IPN_SECRET=dev-now-ipn-secret
# optional for reconcile path:
NOWPAYMENTS_AUTH_EMAIL=mock@local
NOWPAYMENTS_AUTH_PASSWORD=mock
BACKEND_BASE_URL=http://localhost:8001
```

Restart backend after env change. Admin → **Tiền - ngôn ngữ** → enable USDT rail + valid FX → save.

UI: wallet → USDT → create → new tab shows “Mock NOWPayments” → ~8s signed IPN → balance +VND once.

Manual finish if autopay off: `curl -X POST http://127.0.0.1:9410/simulate-invoice-pay/<invoice_id>`

Optional env on mock: `MOCK_NOW_AUTOPAY_SECONDS=8`, `MOCK_NOW_PAY_CURRENCY=usdtbsc`.

## NOW hosted sandbox (if you find it)

Separate portal (not inside prod Settings): `https://account-sandbox.nowpayments.io/`  
API base: `https://api-sandbox.nowpayments.io/v1`  
Never mix sandbox keys with `api.nowpayments.io`.

## Smoke checklist

1. Create deposit method=nowpayments → pending + `checkout_url` / `now_invoice_id`.
2. Finish payment (mock autopay IPN or real USDT min).
3. Wallet +VND exactly once (= intent.amount).
4. Replay IPN → still once.
5. Flag off → FE hides USDT / API 503.
6. PayOS path still works.

## Rollback

`NOWPAYMENTS_ENABLED=false` — PayOS only.
