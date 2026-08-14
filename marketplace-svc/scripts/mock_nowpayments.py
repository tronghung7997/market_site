"""Standalone mock NOWPayments API for local USDT deposit testing.

Mirrors production host paths the backend client uses when
``NOWPAYMENTS_BASE_URL`` ends with ``/v1`` (same as prod default):

    NOWPAYMENTS_BASE_URL=http://127.0.0.1:9410/v1
    NOWPAYMENTS_API_KEY=dev-now-key
    NOWPAYMENTS_IPN_SECRET=dev-now-ipn-secret
    NOWPAYMENTS_ENABLED=true

Hosted checkout path (current app):
    POST /v1/invoice  → invoice_url + id
    delayed signed IPN with invoice_id + payment_id + actually_paid
    GET  /v1/payment/?invoiceid=…  (reconcile / auth JWT)

Legacy H2H still available:
    POST /v1/payment

Run:
    cd marketplace-svc
    uv run uvicorn scripts.mock_nowpayments:app --port 9410
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, Header, Query, Request
from fastapi.responses import HTMLResponse

API_KEY = os.environ.get("MOCK_NOW_API_KEY", "dev-now-key")
IPN_SECRET = os.environ.get("MOCK_NOW_IPN_SECRET", "dev-now-ipn-secret")
WEBHOOK_URL = os.environ.get(
    "MOCK_NOW_WEBHOOK_URL", "http://localhost:8001/webhooks/nowpayments",
)
AUTOPAY_SECONDS = float(os.environ.get("MOCK_NOW_AUTOPAY_SECONDS", "8"))
MIN_AMOUNT = float(os.environ.get("MOCK_NOW_MIN_AMOUNT", "1.0"))
# Network the mock "buyer" picks on hosted checkout (must start with usdt).
DEFAULT_PAY_CURRENCY = os.environ.get("MOCK_NOW_PAY_CURRENCY", "usdtbsc").lower()
PUBLIC_BASE = os.environ.get("MOCK_NOW_PUBLIC_BASE", "http://127.0.0.1:9410").rstrip("/")

app = FastAPI(title="Mock NOWPayments")
_payments: dict[str, dict] = {}
_invoices: dict[str, dict] = {}


def _log(tag: str, **fields: Any) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    extra = " ".join(f"{k}={v!r}" for k, v in fields.items())
    print(f"[mock-now {ts}] {tag} {extra}", flush=True)


def _canonicalize(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _canonicalize(obj[k]) for k in sorted(obj.keys())}
    if isinstance(obj, list):
        return [_canonicalize(x) for x in obj]
    return obj


def _sign(payload: dict) -> str:
    canonical = json.dumps(_canonicalize(payload), separators=(",", ":"), ensure_ascii=False)
    return hmac.new(IPN_SECRET.encode(), canonical.encode(), hashlib.sha512).hexdigest()


def _check_key(x_api_key: str | None) -> bool:
    return x_api_key == API_KEY


def _new_id() -> str:
    return str(int(time.time() * 1000) % 10_000_000_000)


@app.get("/v1/status")
async def status():
    return {"message": "OK"}


@app.get("/v1/min-amount")
async def min_amount(
    currency_from: str = "usdtbsc",
    currency_to: str = "usdtbsc",
    x_api_key: str | None = Header(default=None),
):
    if not _check_key(x_api_key):
        return {"message": "Unauthorized"}
    return {
        "currency_from": currency_from,
        "currency_to": currency_to,
        "min_amount": MIN_AMOUNT,
    }


@app.get("/v1/estimate")
async def estimate(
    amount: float = 1.0,
    currency_from: str = "usd",
    currency_to: str = "usdtbsc",
    x_api_key: str | None = Header(default=None),
):
    if not _check_key(x_api_key):
        return {"message": "Unauthorized"}
    return {
        "currency_from": currency_from,
        "amount_from": amount,
        "currency_to": currency_to,
        "estimated_amount": float(amount),
    }


@app.post("/v1/auth")
async def auth(request: Request):
    """Short-lived JWT stand-in for payment-history / reconcile."""
    body = await request.json()
    email = str(body.get("email") or "")
    password = str(body.get("password") or "")
    if not email or not password:
        return {"message": "Unauthorized"}
    # Accept any non-empty credentials in mock — backend only needs a token shape.
    token = f"mock-jwt-{uuid.uuid4().hex}"
    _log("auth", email=email)
    return {"token": token}


@app.post("/v1/invoice")
async def create_invoice(request: Request, x_api_key: str | None = Header(default=None)):
    """Hosted checkout create — matches nowpayments_client.create_invoice."""
    if not _check_key(x_api_key):
        return {"message": "Unauthorized"}
    body = await request.json()
    invoice_id = _new_id()
    price_amount = float(body.get("price_amount") or 0)
    order_id = str(body.get("order_id") or "")
    ipn_url = body.get("ipn_callback_url") or WEBHOOK_URL
    invoice_url = f"{PUBLIC_BASE}/mock-checkout/{invoice_id}"
    rec = {
        "id": invoice_id,
        "invoice_url": invoice_url,
        "order_id": order_id,
        "order_description": body.get("order_description"),
        "price_amount": price_amount,
        "price_currency": str(body.get("price_currency") or "usd").lower(),
        "ipn_callback_url": ipn_url,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "payment_id": None,
    }
    _invoices[invoice_id] = rec
    _log("invoice_create", invoice_id=invoice_id, order_id=order_id, price_amount=price_amount)
    if AUTOPAY_SECONDS > 0:
        asyncio.create_task(_autopay_invoice(invoice_id))
    return {
        "id": invoice_id,
        "invoice_url": invoice_url,
        "order_id": order_id,
        "order_description": body.get("order_description"),
        "price_amount": price_amount,
        "price_currency": rec["price_currency"],
    }


@app.get("/mock-checkout/{invoice_id}", response_class=HTMLResponse)
async def mock_checkout(invoice_id: str):
    """Simple page FE opens in a new tab while mock auto-pays."""
    inv = _invoices.get(invoice_id)
    if not inv:
        return HTMLResponse("<h1>Unknown invoice</h1>", status_code=404)
    secs = int(AUTOPAY_SECONDS) if AUTOPAY_SECONDS > 0 else 0
    return HTMLResponse(
        f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Mock NOW checkout</title>
<style>
  body {{ font-family: system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; }}
  code {{ background: #f3f4f6; padding: 0.1rem 0.35rem; border-radius: 4px; }}
</style></head>
<body>
  <h1>Mock NOWPayments</h1>
  <p>Invoice <code>{invoice_id}</code></p>
  <p>Order <code>{inv.get("order_id") or "—"}</code></p>
  <p>Amount <strong>{inv.get("price_amount")} {inv.get("price_currency")}</strong>
     → pay as <code>{DEFAULT_PAY_CURRENCY}</code></p>
  <p>{"Auto-pay + signed IPN in ~" + str(secs) + "s. You can close this tab."
     if secs > 0 else
     "Auto-pay off. POST /simulate-invoice-pay/" + invoice_id + " to finish."}</p>
</body></html>"""
    )


@app.post("/v1/payment")
async def create_payment(request: Request, x_api_key: str | None = Header(default=None)):
    if not _check_key(x_api_key):
        return {"message": "Unauthorized"}
    body = await request.json()
    payment_id = _new_id()
    price_amount = float(body.get("price_amount") or 0)
    pay_currency = str(body.get("pay_currency") or DEFAULT_PAY_CURRENCY).lower()
    order_id = str(body.get("order_id") or "")
    pay_amount = price_amount
    rec = {
        "payment_id": payment_id,
        "payment_status": "waiting",
        "pay_address": f"0xMOCK{payment_id[-8:]}",
        "price_amount": price_amount,
        "price_currency": str(body.get("price_currency") or "usd").lower(),
        "pay_amount": pay_amount,
        "actually_paid": 0,
        "pay_currency": pay_currency,
        "order_id": order_id,
        "order_description": body.get("order_description"),
        "purchase_id": str(uuid.uuid4().int)[:10],
        "created_at": datetime.utcnow().isoformat() + "Z",
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "outcome_amount": pay_amount * 0.995,
        "outcome_currency": pay_currency,
        "ipn_callback_url": body.get("ipn_callback_url") or WEBHOOK_URL,
        "invoice_id": body.get("invoice_id"),
    }
    _payments[payment_id] = rec
    _log("create", payment_id=payment_id, order_id=order_id, pay_amount=pay_amount)
    if AUTOPAY_SECONDS > 0:
        asyncio.create_task(_autopay(payment_id))
    return rec


@app.get("/v1/payment/{payment_id}")
async def get_payment(payment_id: str, x_api_key: str | None = Header(default=None)):
    if not _check_key(x_api_key):
        return {"message": "Unauthorized"}
    rec = _payments.get(payment_id)
    if not rec:
        return {"message": "Not found"}
    return rec


@app.get("/v1/payment/")
async def list_payments(
    invoiceid: str | None = Query(default=None),
    limit: int = Query(default=50),
    x_api_key: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    """Payment history by invoice — used by deposit reconcile."""
    if not _check_key(x_api_key) and not (authorization and authorization.startswith("Bearer ")):
        # Prod uses Bearer JWT from /auth; mock accepts either API key or any Bearer.
        if not (authorization and authorization.lower().startswith("bearer ")):
            return {"message": "Unauthorized"}
    rows = list(_payments.values())
    if invoiceid:
        rows = [r for r in rows if str(r.get("invoice_id") or "") == str(invoiceid)]
    rows = rows[: max(1, min(limit, 100))]
    return {"data": rows}


@app.post("/simulate-pay/{payment_id}")
async def simulate_pay(payment_id: str, underpay: bool = False):
    rec = _payments.get(payment_id)
    if not rec:
        return {"ok": False, "note": "unknown"}
    await _finish(payment_id, underpay=underpay)
    return {"ok": True, "payment": _payments[payment_id]}


@app.post("/simulate-invoice-pay/{invoice_id}")
async def simulate_invoice_pay(invoice_id: str, underpay: bool = False):
    inv = _invoices.get(invoice_id)
    if not inv:
        return {"ok": False, "note": "unknown invoice"}
    payment_id = await _spawn_payment_for_invoice(invoice_id)
    await _finish(payment_id, underpay=underpay)
    return {"ok": True, "payment": _payments[payment_id]}


async def _autopay_invoice(invoice_id: str) -> None:
    await asyncio.sleep(AUTOPAY_SECONDS)
    inv = _invoices.get(invoice_id)
    if not inv or inv.get("payment_id"):
        return
    payment_id = await _spawn_payment_for_invoice(invoice_id)
    await _finish(payment_id)


async def _spawn_payment_for_invoice(invoice_id: str) -> str:
    inv = _invoices[invoice_id]
    if inv.get("payment_id") and inv["payment_id"] in _payments:
        return str(inv["payment_id"])

    payment_id = _new_id()
    price_amount = float(inv["price_amount"])
    pay_currency = DEFAULT_PAY_CURRENCY
    rec = {
        "payment_id": payment_id,
        "payment_status": "waiting",
        "pay_address": f"0xMOCK{payment_id[-8:]}",
        "price_amount": price_amount,
        "price_currency": inv["price_currency"],
        "pay_amount": price_amount,
        "actually_paid": 0,
        "pay_currency": pay_currency,
        "order_id": inv.get("order_id") or "",
        "order_description": inv.get("order_description"),
        "purchase_id": str(uuid.uuid4().int)[:10],
        "created_at": datetime.utcnow().isoformat() + "Z",
        "updated_at": datetime.utcnow().isoformat() + "Z",
        "outcome_amount": price_amount * 0.995,
        "outcome_currency": pay_currency,
        "ipn_callback_url": inv.get("ipn_callback_url") or WEBHOOK_URL,
        "invoice_id": invoice_id,
    }
    _payments[payment_id] = rec
    inv["payment_id"] = payment_id
    _log("invoice_payment", invoice_id=invoice_id, payment_id=payment_id)
    return payment_id


async def _autopay(payment_id: str) -> None:
    await asyncio.sleep(AUTOPAY_SECONDS)
    if payment_id in _payments and _payments[payment_id]["payment_status"] == "waiting":
        await _finish(payment_id)


async def _finish(payment_id: str, *, underpay: bool = False) -> None:
    rec = _payments[payment_id]
    pay_amount = float(rec["pay_amount"])
    actually = pay_amount * 0.5 if underpay else pay_amount
    rec["payment_status"] = "finished"
    rec["actually_paid"] = actually
    rec["outcome_amount"] = actually * 0.995
    rec["updated_at"] = datetime.utcnow().isoformat() + "Z"
    await _send_ipn(rec)
    _log("finished", payment_id=payment_id, actually_paid=actually, invoice_id=rec.get("invoice_id"))


async def _send_ipn(rec: dict) -> None:
    url = rec.get("ipn_callback_url") or WEBHOOK_URL
    # IPN body is payment fields (no nested wrapper). Keep invoice_id for hosted credit.
    payload = {k: v for k, v in rec.items() if k != "ipn_callback_url"}
    sig = _sign(payload)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers={"x-nowpayments-sig": sig})
        _log("ipn_sent", status=resp.status_code, payment_id=rec.get("payment_id"))
    except Exception as e:
        _log("ipn_failed", error=str(e))


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9410)
