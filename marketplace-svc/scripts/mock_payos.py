"""Standalone mock PayOS merchant API.

Giả lập đúng contract https://payos.vn/docs/ (envelope {code, desc, data,
signature}, auth x-client-id/x-api-key, chữ ký HMAC 2 chiều) — backend nói
chuyện với process này y hệt PayOS thật, đổi sang thật chỉ là đổi env:
PAYOS_BASE_URL + 3 khoá thật. Nguyên tắc "mock at the HTTP layer" như
mock_seller/mock_topproxy.

Điểm ăn tiền cho dev: AUTOPAY — sau MOCK_PAYOS_AUTOPAY_SECONDS (mặc định 6s)
kể từ khi tạo link, mock coi như khách đã quét QR chuyển tiền và tự POST
webhook ĐÃ KÝ ĐÚNG về backend (MOCK_PAYOS_WEBHOOK_URL) → luồng nạp chạy trọn
vòng không cần tay ai bấm. Muốn giả lập khách trả tay: POST /simulate-pay/{orderCode}.

Run:
    cd marketplace-svc
    uv run uvicorn scripts.mock_payos:app --port 9400

Backend .env (dev):
    PAYOS_BASE_URL=http://127.0.0.1:9400
    PAYOS_CLIENT_ID=dev-client
    PAYOS_API_KEY=dev-api-key
    PAYOS_CHECKSUM_KEY=dev-checksum-key
"""
import asyncio
import hashlib
import hmac
import json
import os
import time
import uuid
from datetime import datetime

import httpx
import uvicorn
from fastapi import FastAPI, Header, Request

CLIENT_ID = os.environ.get("MOCK_PAYOS_CLIENT_ID", "dev-client")
API_KEY = os.environ.get("MOCK_PAYOS_API_KEY", "dev-api-key")
CHECKSUM_KEY = os.environ.get("MOCK_PAYOS_CHECKSUM_KEY", "dev-checksum-key")
WEBHOOK_URL = os.environ.get("MOCK_PAYOS_WEBHOOK_URL", "http://localhost:8001/webhooks/payos")
AUTOPAY_SECONDS = float(os.environ.get("MOCK_PAYOS_AUTOPAY_SECONDS", "6"))

app = FastAPI(title="Mock PayOS")

_requests: dict[int, dict] = {}  # orderCode → payment request


def _log(tag: str, **fields) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    extra = " ".join(f"{k}={v!r}" for k, v in fields.items())
    print(f"[mock-payos {ts}] {tag} {extra}", flush=True)


def _err(code: str, desc: str) -> dict:
    return {"code": code, "desc": desc, "data": None, "signature": None}


def _ok(data: dict) -> dict:
    return {"code": "00", "desc": "success", "data": data, "signature": None}


def _check_auth(client_id: str | None, api_key: str | None) -> bool:
    return client_id == CLIENT_ID and api_key == API_KEY


def _sign_data(data: dict) -> str:
    parts = []
    for k in sorted(data.keys()):
        v = data[k]
        if v is None:
            v = ""
        elif isinstance(v, bool):
            v = "true" if v else "false"
        elif isinstance(v, (dict, list)):
            v = json.dumps(v, separators=(",", ":"), ensure_ascii=False)
        parts.append(f"{k}={v}")
    return hmac.new(CHECKSUM_KEY.encode(), "&".join(parts).encode(), hashlib.sha256).hexdigest()


def _verify_create_signature(body: dict) -> bool:
    payload = (
        f"amount={body.get('amount')}&cancelUrl={body.get('cancelUrl')}"
        f"&description={body.get('description')}&orderCode={body.get('orderCode')}"
        f"&returnUrl={body.get('returnUrl')}"
    )
    expected = hmac.new(CHECKSUM_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, body.get("signature") or "")


async def _send_paid_webhook(order_code: int) -> None:
    req = _requests.get(order_code)
    if not req or req["status"] != "PENDING":
        return
    req["status"] = "PAID"
    req["amountPaid"] = req["amount"]
    reference = f"FT{int(time.time())}{order_code}"
    req["transactions"] = [{
        "reference": reference, "amount": req["amount"],
        "transactionDateTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }]
    data = {
        "orderCode": order_code,
        "amount": req["amount"],
        "description": req["description"],
        "accountNumber": "0004100012345678",
        "reference": reference,
        "transactionDateTime": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "currency": "VND",
        "paymentLinkId": req["paymentLinkId"],
        "code": "00",
        "desc": "Thành công",
        "counterAccountBankId": "970422",
        "counterAccountBankName": "MB Bank",
        "counterAccountName": "NGUYEN VAN A",
        "counterAccountNumber": "0123456789",
        "virtualAccountName": "",
        "virtualAccountNumber": "",
    }
    payload = {"code": "00", "desc": "success", "success": True, "data": data, "signature": _sign_data(data)}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(WEBHOOK_URL, json=payload)
        _log("webhook_sent", order_code=order_code, status_code=resp.status_code)
    except httpx.HTTPError as e:
        _log("webhook_failed", order_code=order_code, error=str(e))


async def _autopay(order_code: int) -> None:
    await asyncio.sleep(AUTOPAY_SECONDS)
    await _send_paid_webhook(order_code)


@app.post("/v2/payment-requests")
async def create_payment_request(
    request: Request,
    x_client_id: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
):
    if not _check_auth(x_client_id, x_api_key):
        return _err("401", "Unauthorized")
    body = await request.json()
    order_code = body.get("orderCode")
    if not isinstance(order_code, int):
        return _err("20", "orderCode không hợp lệ")
    if order_code in _requests:
        return _err("231", "Đơn thanh toán đã tồn tại")
    if not _verify_create_signature(body):
        return _err("20", "Chữ ký không hợp lệ")

    payment_link_id = uuid.uuid4().hex
    req = {
        "orderCode": order_code, "amount": body["amount"], "description": body.get("description", ""),
        "paymentLinkId": payment_link_id, "status": "PENDING", "amountPaid": 0,
        "createdAt": time.time(), "expiredAt": body.get("expiredAt"), "transactions": [],
    }
    _requests[order_code] = req
    _log("payment_request_created", order_code=order_code, amount=body["amount"], autopay_in=AUTOPAY_SECONDS)
    if AUTOPAY_SECONDS > 0:
        asyncio.create_task(_autopay(order_code))
    return _ok({
        "bin": "970422", "accountNumber": "0004100012345678", "accountName": "MOCK PAYOS",
        "amount": body["amount"], "description": body.get("description", ""),
        "orderCode": order_code, "currency": "VND", "paymentLinkId": payment_link_id,
        "status": "PENDING",
        "checkoutUrl": f"http://127.0.0.1:9400/checkout/{order_code}",
        "qrCode": f"00020101021238570010A000000727MOCK{order_code}",
    })


@app.get("/v2/payment-requests/{order_code}")
async def get_payment_request(
    order_code: int,
    x_client_id: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
):
    if not _check_auth(x_client_id, x_api_key):
        return _err("401", "Unauthorized")
    req = _requests.get(order_code)
    if not req:
        return _err("101", "Không tìm thấy đơn thanh toán")
    if req["status"] == "PENDING" and req.get("expiredAt") and time.time() > req["expiredAt"]:
        req["status"] = "EXPIRED"
    return _ok({
        "id": req["paymentLinkId"], "orderCode": order_code, "amount": req["amount"],
        "amountPaid": req["amountPaid"], "amountRemaining": req["amount"] - req["amountPaid"],
        "status": req["status"], "transactions": req["transactions"],
    })


@app.post("/v2/payment-requests/{order_code}/cancel")
async def cancel_payment_request(
    order_code: int,
    x_client_id: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
):
    if not _check_auth(x_client_id, x_api_key):
        return _err("401", "Unauthorized")
    req = _requests.get(order_code)
    if not req:
        return _err("101", "Không tìm thấy đơn thanh toán")
    if req["status"] == "PENDING":
        req["status"] = "CANCELLED"
    _log("payment_cancelled", order_code=order_code)
    return _ok({"orderCode": order_code, "status": req["status"], "canceledAt": datetime.now().isoformat()})


@app.post("/confirm-webhook")
async def confirm_webhook(
    request: Request,
    x_client_id: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
):
    if not _check_auth(x_client_id, x_api_key):
        return _err("401", "Unauthorized")
    body = await request.json()
    _log("webhook_confirmed", url=body.get("webhookUrl"))
    return _ok({"webhookUrl": body.get("webhookUrl")})


@app.post("/simulate-pay/{order_code}")
async def simulate_pay(order_code: int):
    """Dev helper (không có ở PayOS thật): giả lập khách vừa chuyển khoản."""
    if order_code not in _requests:
        return _err("101", "Không tìm thấy đơn thanh toán")
    await _send_paid_webhook(order_code)
    return _ok({"orderCode": order_code, "status": _requests[order_code]["status"]})


@app.get("/checkout/{order_code}")
async def checkout_page(order_code: int):
    """Trang checkout giả — chỉ để link checkoutUrl bấm được trong dev."""
    req = _requests.get(order_code)
    if not req:
        return _err("101", "Không tìm thấy đơn thanh toán")
    return {
        "note": "Mock checkout — POST /simulate-pay/{orderCode} để giả lập thanh toán",
        "orderCode": order_code, "amount": req["amount"], "status": req["status"],
    }


if __name__ == "__main__":
    port = int(os.environ.get("MOCK_PAYOS_PORT", "9400"))
    print(
        f"Mock PayOS listening on :{port} — backend env: PAYOS_BASE_URL=http://127.0.0.1:{port}, "
        f"PAYOS_CLIENT_ID={CLIENT_ID!r}, PAYOS_API_KEY={API_KEY!r}, PAYOS_CHECKSUM_KEY={CHECKSUM_KEY!r}; "
        f"autopay sau {AUTOPAY_SECONDS}s"
    )
    uvicorn.run(app, host="0.0.0.0", port=port)
