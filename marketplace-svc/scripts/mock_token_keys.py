"""Standalone mock of the token-keys source (adapter ``token_keys``).

Same wire format as the partner's dev server (2026-09-29):

    POST /api/v1/keys {"tokens": N, "order_id": "ORD-…", "customer_id": "<buyer public_key>"}
        → {"api_key": "sk_…", "api_key_id": "…", "tokens": <granted ≤ N>, "stock": <left after>}
    GET  /api/v1/customer/tokens?page=&limit=   (header X-API-Key: <api_key>)
        → {"data": [{"id", "access_token"}], "page", "limit", "total"}

Run:
    cd marketplace-svc
    uv run uvicorn scripts.mock_token_keys:app --port 9403

Point the source at it: base_url http://127.0.0.1:9403/api/v1 (no partner key needed).

Scripted outcomes for manual testing — ``POST /_mock`` with any of:
    {"stock": 2}          only 2 tokens left → a 3-token order gets 2 (short)
    {"mode": "out"}       409 out of stock
    {"mode": "auth"}      401 on /keys
    {"mode": "fail"}      500 on /keys (nothing issued)
    {"mode": "fail_read"} keys issued, /customer/tokens answers 500
    {"mode": "slow"}      /keys waits 3 s
    {"mode": "ok"}        back to normal
    {"report_stock": false}  answer without the ``stock`` field (older contract)
``GET /_mock`` shows the state. The same order_id always gets the same key
back (what the partner is expected to confirm).
"""
import asyncio
import secrets
import uuid

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="mock token keys")

STATE: dict = {"stock": 10_000, "mode": "ok", "report_stock": True}
KEYS_BY_ORDER: dict[str, dict] = {}
CUSTOMER_BY_ORDER: dict[str, str | None] = {}
TOKENS_BY_KEY: dict[str, list[dict]] = {}


@app.post("/api/v1/keys")
async def create_key(request: Request):
    body = await request.json()
    try:
        wanted = int(body.get("tokens"))
    except (TypeError, ValueError):
        return JSONResponse({"error": "tokens must be an integer"}, status_code=422)
    order_id = str(body.get("order_id") or "").strip()
    if wanted <= 0 or not order_id:
        return JSONResponse({"error": "tokens > 0 and order_id are required"}, status_code=422)

    mode = STATE["mode"]
    if mode == "slow":
        await asyncio.sleep(3)
    if mode == "auth":
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if mode == "fail":
        return JSONResponse({"error": "internal error"}, status_code=500)

    if order_id in KEYS_BY_ORDER:  # idempotent theo order_id
        return KEYS_BY_ORDER[order_id]
    CUSTOMER_BY_ORDER[order_id] = body.get("customer_id")
    if mode == "out" or STATE["stock"] <= 0:
        out = {"error": "insufficient stock"}
        if STATE["report_stock"]:
            out["stock"] = 0 if mode == "out" else max(STATE["stock"], 0)
        return JSONResponse(out, status_code=409)

    granted = min(wanted, STATE["stock"])
    STATE["stock"] -= granted
    key_id = secrets.token_hex(4)
    api_key = f"sk_{key_id}_{secrets.token_urlsafe(32)}"
    TOKENS_BY_KEY[api_key] = [
        {"id": str(uuid.uuid4()), "access_token": f"tok_demo_{secrets.token_hex(10)}"} for _ in range(granted)
    ]
    result = {"api_key": api_key, "api_key_id": key_id, "tokens": granted}
    if STATE["report_stock"]:
        result["stock"] = STATE["stock"]
    KEYS_BY_ORDER[order_id] = result
    return result


@app.get("/api/v1/customer/tokens")
async def list_tokens(page: int = 1, limit: int = 20, x_api_key: str | None = Header(default=None)):
    if STATE["mode"] == "fail_read":
        return JSONResponse({"error": "internal error"}, status_code=500)
    rows = TOKENS_BY_KEY.get(x_api_key or "")
    if rows is None:
        return JSONResponse({"error": "invalid api key"}, status_code=401)
    page, limit = max(page, 1), max(min(limit, 100), 1)
    start = (page - 1) * limit
    return {"data": rows[start:start + limit], "page": page, "limit": limit, "total": len(rows)}


@app.get("/_mock")
async def mock_state():
    return {**STATE, "orders": len(KEYS_BY_ORDER), "customers": CUSTOMER_BY_ORDER}


@app.post("/_mock")
async def mock_control(request: Request):
    body = await request.json()
    if "stock" in body:
        STATE["stock"] = int(body["stock"])
    if "mode" in body:
        STATE["mode"] = str(body["mode"])
    if "report_stock" in body:
        STATE["report_stock"] = bool(body["report_stock"])
    return STATE
