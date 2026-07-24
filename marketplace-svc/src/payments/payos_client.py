"""Wrapper mỏng quanh PayOS merchant API (https://payos.vn/docs/).

Hai chiều chữ ký, cùng một checksum key của kênh thanh toán:
- Chiều TẠO LINK: HMAC-SHA256 trên chuỗi cố định
  "amount=..&cancelUrl=..&description=..&orderCode=..&returnUrl=.."
  (đúng 5 field, sort alphabet) — PayOS từ chối request ký sai.
- Chiều WEBHOOK: PayOS ký HMAC-SHA256 trên `data` (mọi key sort alphabet,
  None → chuỗi rỗng) — mình verify bằng compare_digest trước khi tin bất kỳ
  field nào trong payload.

Không retry lệnh tạo link ở tầng này: orderCode là duy nhất per intent nên
gọi trùng chỉ nhận lỗi "đã tồn tại" chứ không tạo link đôi; caller xử lý lỗi
bằng cách huỷ intent (xem service.create_deposit).
"""
import hashlib
import hmac
import json

import httpx
import structlog

from src.config import settings

logger = structlog.get_logger()

_TIMEOUT = 10.0


class PayOSError(Exception):
    """PayOS trả lỗi nghiệp vụ (code != '00') hoặc response sai shape."""


class PayOSUnavailableError(Exception):
    """Network/5xx — transient, caller quyết định retry hay báo lỗi."""


def is_configured() -> bool:
    return bool(settings.payos_client_id and settings.payos_api_key and settings.payos_checksum_key)


def sign_payment_request(
    *, amount: int, cancel_url: str, description: str, order_code: int, return_url: str,
    checksum_key: str | None = None,
) -> str:
    key = checksum_key if checksum_key is not None else settings.payos_checksum_key
    payload = (
        f"amount={amount}&cancelUrl={cancel_url}&description={description}"
        f"&orderCode={order_code}&returnUrl={return_url}"
    )
    return hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def sign_webhook_data(data: dict, checksum_key: str | None = None) -> str:
    """Chuỗi ký = 'k1=v1&k2=v2...' theo key sort alphabet; None → '';
    bool/number/str giữ nguyên biểu diễn JSON của PayOS (bool hiếm gặp trong
    payload thật — mọi field tài liệu là số/chuỗi)."""
    key = checksum_key if checksum_key is not None else settings.payos_checksum_key
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
    payload = "&".join(parts)
    return hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def verify_webhook_signature(payload: dict) -> bool:
    # Không bao giờ verify bằng khoá rỗng: nếu PAYOS_CHECKSUM_KEY chưa set,
    # HMAC("") là thứ ai cũng tính được — một webhook giả ký bằng khoá rỗng
    # sẽ "hợp lệ". Chưa cấu hình = từ chối tất cả.
    if not settings.payos_checksum_key:
        return False
    data = payload.get("data")
    signature = payload.get("signature")
    if not isinstance(data, dict) or not isinstance(signature, str) or not signature:
        return False
    expected = sign_webhook_data(data)
    return hmac.compare_digest(expected, signature)


def _headers() -> dict:
    return {
        "x-client-id": settings.payos_client_id,
        "x-api-key": settings.payos_api_key,
        "Content-Type": "application/json",
    }


async def _request(method: str, path: str, json_body: dict | None = None) -> dict:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.request(
                method, f"{settings.payos_base_url}{path}", headers=_headers(), json=json_body,
            )
    except httpx.HTTPError as e:
        raise PayOSUnavailableError(str(e)) from e
    if resp.status_code >= 500:
        raise PayOSUnavailableError(f"HTTP {resp.status_code}")
    try:
        body = resp.json()
    except ValueError as e:
        raise PayOSError(f"Response không phải JSON (HTTP {resp.status_code})") from e
    if resp.status_code >= 400:
        raise PayOSError(f"HTTP {resp.status_code}: {body.get('desc') or body}")
    if body.get("code") != "00":
        raise PayOSError(f"PayOS code={body.get('code')}: {body.get('desc')}")
    data = body.get("data")
    if not isinstance(data, dict):
        raise PayOSError("PayOS response thiếu data")
    return data


async def create_payment_request(
    *, order_code: int, amount: int, description: str, return_url: str, cancel_url: str,
    expired_at: int | None = None,
) -> dict:
    """Trả về data: bin, accountNumber, accountName, amount, paymentLinkId,
    status, checkoutUrl, qrCode."""
    body = {
        "orderCode": order_code,
        "amount": amount,
        "description": description,
        "returnUrl": return_url,
        "cancelUrl": cancel_url,
        "signature": sign_payment_request(
            amount=amount, cancel_url=cancel_url, description=description,
            order_code=order_code, return_url=return_url,
        ),
    }
    if expired_at is not None:
        body["expiredAt"] = expired_at
    return await _request("POST", "/v2/payment-requests", body)


async def get_payment_info(order_code: int) -> dict:
    """Trả về data: id, orderCode, amount, amountPaid, status
    (PENDING|PAID|CANCELLED|EXPIRED), transactions[]."""
    return await _request("GET", f"/v2/payment-requests/{order_code}")


async def cancel_payment(order_code: int, reason: str | None = None) -> dict | None:
    """Best-effort — huỷ fail không được chặn luồng caller (intent bên mình
    đã cancelled, PayOS tự expire theo expiredAt)."""
    try:
        return await _request(
            "POST", f"/v2/payment-requests/{order_code}/cancel",
            {"cancellationReason": reason or "Người dùng huỷ lệnh nạp"},
        )
    except (PayOSError, PayOSUnavailableError) as e:
        logger.warning("payos_cancel_failed", order_code=order_code, error=str(e))
        return None
