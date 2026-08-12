"""Standalone mock NOWPayments Payment API + delayed signed IPN.

Mirrors scripts/mock_payos.py — backend talks HTTP like production:
    NOWPAYMENTS_BASE_URL=http://127.0.0.1:9410
    NOWPAYMENTS_API_KEY=dev-now-key
    NOWPAYMENTS_IPN_SECRET=dev-now-ipn-secret
    NOWPAYMENTS_ENABLED=true

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
from fastapi import FastAPI, Header, Request

API_KEY = os.environ.get("MOCK_NOW_API_KEY", "dev-now-key")
IPN_SECRET = os.environ.get("MOCK_NOW_IPN_SECRET", "dev-now-ipn-secret")
WEBHOOK_URL = os.environ.get(
    "MOCK_NOW_WEBHOOK_URL", "http://localhost:8001/webhooks/nowpayments",
)
AUTOPAY_SECONDS = float(os.environ.get("MOCK_NOW_AUTOPAY_SECONDS", "8"))
MIN_AMOUNT = float(os.environ.get("MOCK_NOW_MIN_AMOUNT", "1.0"))

app = FastAPI(title="Mock NOWPayments")
_payments: dict[str, dict] = {}


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
        return {"message": "Unauthorized"}, 401
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
    # 1:1-ish for stablecoin tests
    return {
        "currency_from": currency_from,
        "amount_from": amount,
        "currency_to": currency_to,
        "estimated_amount": float(amount),
    }


@app.post("/v1/payment")
async def create_payment(request: Request, x_api_key: str | None = Header(default=None)):
    if not _check_key(x_api_key):
        return {"message": "Unauthorized"}
    body = await request.json()
    payment_id = str(int(time.time() * 1000) % 10_000_000_000)
    price_amount = float(body.get("price_amount") or 0)
    pay_currency = str(body.get("pay_currency") or "usdtbsc").lower()
    order_id = str(body.get("order_id") or "")
    pay_amount = price_amount  # mock 1:1 USD→USDT
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


@app.post("/simulate-pay/{payment_id}")
async def simulate_pay(payment_id: str, underpay: bool = False):
    rec = _payments.get(payment_id)
    if not rec:
        return {"ok": False, "note": "unknown"}
    await _finish(payment_id, underpay=underpay)
    return {"ok": True, "payment": _payments[payment_id]}


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
    _log("finished", payment_id=payment_id, actually_paid=actually)


async def _send_ipn(rec: dict) -> None:
    url = rec.get("ipn_callback_url") or WEBHOOK_URL
    # IPN body is payment fields (no nested wrapper)
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
