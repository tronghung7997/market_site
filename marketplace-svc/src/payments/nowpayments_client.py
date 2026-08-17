"""NOWPayments Payment API client + IPN HMAC verification.

Contract: docs/superpowers/specs/2026-08-12-nowpayments-api-contract-verification.md
Plan: docs/superpowers/plans/2026-08-11-nowpayments-usdt-deposit-plan.md

Payment auth: x-api-key; payment-history auth: short-lived Bearer JWT.
IPN: recursive key-sort → JSON → HMAC-SHA512(ipn_secret).
"""
from __future__ import annotations

import hashlib
import hmac
import json
from decimal import Decimal, InvalidOperation
from time import monotonic
from typing import Any
from urllib.parse import urljoin

import httpx
import structlog

from src.config import settings

logger = structlog.get_logger()

_TIMEOUT = 15.0
_AUTH_TOKEN_TTL_SECONDS = 240.0  # NOW's token is documented as valid for five minutes.
_payment_history_token: str | None = None
_payment_history_token_expires_at = 0.0


class NowPaymentsError(Exception):
    """Business / 4xx / bad shape from NOWPayments."""


class NowPaymentsUnavailableError(Exception):
    """Network / 5xx — transient."""


def is_configured() -> bool:
    """Secrets present (API key + IPN secret). Admin enable flag is separate (DB)."""
    return bool(settings.nowpayments_api_key and settings.nowpayments_ipn_secret)


def is_reconciliation_configured() -> bool:
    """Whether hosted-invoice reconciliation can list payments by invoice ID."""
    return bool(settings.nowpayments_api_key and settings.nowpayments_auth_email and settings.nowpayments_auth_password)


def ipn_callback_url() -> str:
    if settings.nowpayments_ipn_url.strip():
        return settings.nowpayments_ipn_url.strip()
    base = settings.backend_base_url.rstrip("/")
    return f"{base}/webhooks/nowpayments"


def _headers() -> dict[str, str]:
    return {
        "x-api-key": settings.nowpayments_api_key,
        "Content-Type": "application/json",
    }


def _base() -> str:
    return settings.nowpayments_base_url.rstrip("/") + "/"


def reconciliation_debug_config() -> dict[str, object]:
    """Temporary, non-secret config fingerprints for production diagnostics."""
    def fingerprint(value: str) -> dict[str, object]:
        normalized = str(value or "").strip()
        return {
            "present": bool(normalized),
            "length": len(normalized),
            "sha256_12": hashlib.sha256(normalized.encode()).hexdigest()[:12] if normalized else None,
        }

    return {
        "base_url": _base(),
        "api_key": fingerprint(settings.nowpayments_api_key),
        "auth_email": fingerprint(settings.nowpayments_auth_email),
        "auth_password": fingerprint(settings.nowpayments_auth_password),
    }


async def _request(
    method: str,
    path: str,
    *,
    json_body: dict | None = None,
    params: dict | None = None,
    headers: dict[str, str] | None = None,
) -> dict:
    url = urljoin(_base(), path.lstrip("/"))
    normalized_path = path.strip("/")
    if normalized_path == "auth":
        stage = "auth"
    elif normalized_path == "payment":
        stage = "payment_list"
    else:
        stage = normalized_path
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.request(
                method, url, headers=headers or _headers(), json=json_body, params=params,
            )
    except httpx.HTTPError as e:
        raise NowPaymentsUnavailableError(
            f"stage={stage}; {method} {url}; network_error={e}"
        ) from e

    trace_headers = {
        key: value
        for key in ("x-request-id", "cf-ray", "server")
        if (value := resp.headers.get(key))
    }
    trace_suffix = f"; trace={trace_headers}" if trace_headers else ""
    if resp.status_code >= 500:
        raise NowPaymentsUnavailableError(
            f"stage={stage}; {method} {url}; HTTP {resp.status_code}{trace_suffix}"
        )
    try:
        body = resp.json()
    except ValueError as e:
        raise NowPaymentsError(
            f"stage={stage}; {method} {url}; Response not JSON "
            f"(HTTP {resp.status_code}){trace_suffix}"
        ) from e
    if resp.status_code >= 400:
        safe_body = json.dumps(body, ensure_ascii=False, default=str)[:1000]
        raise NowPaymentsError(
            f"stage={stage}; {method} {url}; HTTP {resp.status_code}; "
            f"response={safe_body}{trace_suffix}"
        )
    if not isinstance(body, dict):
        raise NowPaymentsError("Response is not an object")
    return body


def _canonicalize(obj: Any) -> Any:
    """Recursively sort object keys for IPN signing (NOW docs)."""
    if isinstance(obj, dict):
        return {k: _canonicalize(obj[k]) for k in sorted(obj.keys())}
    if isinstance(obj, list):
        return [_canonicalize(x) for x in obj]
    return obj


def payload_hash(payload: dict) -> str:
    canonical = json.dumps(_canonicalize(payload), separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def sign_ipn_payload(payload: dict, ipn_secret: str | None = None) -> str:
    secret = ipn_secret if ipn_secret is not None else settings.nowpayments_ipn_secret
    canonical = json.dumps(_canonicalize(payload), separators=(",", ":"), ensure_ascii=False)
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha512).hexdigest()


def verify_ipn_signature(payload: dict, signature: str | None) -> bool:
    """Reject empty secret (same invariant as PayOS checksum)."""
    if not settings.nowpayments_ipn_secret:
        return False
    if not isinstance(payload, dict):
        return False
    if not isinstance(signature, str) or not signature:
        return False
    expected = sign_ipn_payload(payload)
    return hmac.compare_digest(expected, signature)


def parse_order_id(order_id: str | int | None) -> int | None:
    """Parse DEP-{int} → intent id. Anything else → None."""
    if order_id is None:
        return None
    s = str(order_id).strip()
    if not s.startswith("DEP-"):
        return None
    rest = s[4:]
    if not rest.isdigit():
        return None
    try:
        return int(rest)
    except ValueError:
        return None


def format_order_id(intent_id: int) -> str:
    return f"DEP-{intent_id}"


def parse_decimal(value: Any) -> Decimal | None:
    if value is None or value is False:
        return None
    if isinstance(value, bool):
        return None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not d.is_finite():
        return None
    return d


async def get_min_amount(
    *, currency_from: str, currency_to: str | None = None,
) -> Decimal:
    """GET /v1/min-amount — dynamic min for crypto pair."""
    params: dict[str, str] = {"currency_from": currency_from.lower()}
    outcome = (currency_to or settings.nowpayments_outcome_currency).lower()
    params["currency_to"] = outcome
    body = await _request("GET", "min-amount", params=params)
    min_amount = parse_decimal(body.get("min_amount"))
    if min_amount is None:
        raise NowPaymentsError(f"min-amount missing/invalid: {body}")
    return min_amount


async def get_estimate(
    *,
    amount: Decimal | float | str,
    currency_from: str,
    currency_to: str,
) -> Decimal:
    """GET /v1/estimate — fiat/crypto quote for display/validation."""
    params = {
        "amount": str(amount),
        "currency_from": currency_from.lower(),
        "currency_to": currency_to.lower(),
    }
    body = await _request("GET", "estimate", params=params)
    estimated = parse_decimal(body.get("estimated_amount"))
    if estimated is None:
        raise NowPaymentsError(f"estimate missing/invalid: {body}")
    return estimated


async def create_payment(
    *,
    price_amount: Decimal | float | str,
    price_currency: str,
    pay_currency: str,
    order_id: str,
    order_description: str | None = None,
    callback_url: str | None = None,
) -> dict:
    """POST /v1/payment — returns payment_id, pay_address, pay_amount, …"""
    if isinstance(price_amount, Decimal):
        price_val: float | str = float(price_amount)
    else:
        price_val = float(price_amount)
    body: dict[str, Any] = {
        "price_amount": price_val,
        "price_currency": price_currency.lower(),
        "pay_currency": pay_currency.lower(),
        "order_id": order_id,
        "ipn_callback_url": callback_url or ipn_callback_url(),
    }
    if order_description:
        body["order_description"] = order_description
    data = await _request("POST", "payment", json_body=body)
    if not data.get("payment_id") or not data.get("pay_address"):
        raise NowPaymentsError(f"create payment missing payment_id/pay_address: {list(data.keys())}")
    return data


async def create_invoice(
    *,
    price_amount: Decimal | float | str,
    price_currency: str,
    order_id: str,
    order_description: str | None = None,
    callback_url: str | None = None,
) -> dict:
    """POST /v1/invoice for the hosted NOWPayments checkout.

    Deliberately omit ``pay_currency``: the checkout lets the buyer select an
    enabled USDT network. The merchant's NOWPayments coin settings are the
    allowlist for that screen; do not enable non-USDT assets there.
    """
    price_val: float | str = float(price_amount)
    body: dict[str, Any] = {
        "price_amount": price_val,
        "price_currency": price_currency.lower(),
        "order_id": order_id,
        "ipn_callback_url": callback_url or ipn_callback_url(),
    }
    if order_description:
        body["order_description"] = order_description
    data = await _request("POST", "invoice", json_body=body)
    if not data.get("id") or not data.get("invoice_url"):
        raise NowPaymentsError(f"create invoice missing id/invoice_url: {list(data.keys())}")
    return data


async def get_payment(payment_id: str | int) -> dict:
    """GET /v1/payment/{payment_id}"""
    return await _request("GET", f"payment/{payment_id}")


async def _get_payment_history_token() -> str:
    """Exchange server-side NOW credentials for a cached short-lived JWT."""
    global _payment_history_token, _payment_history_token_expires_at
    if _payment_history_token and monotonic() < _payment_history_token_expires_at:
        return _payment_history_token
    if not is_reconciliation_configured():
        raise NowPaymentsError("NOWPayments payment-history credentials are not configured")

    body = await _request(
        "POST",
        "auth",
        json_body={
            "email": settings.nowpayments_auth_email,
            "password": settings.nowpayments_auth_password,
        },
        headers={"Content-Type": "application/json"},
    )
    token = str(body.get("token") or "").strip()
    if not token:
        raise NowPaymentsError("NOWPayments auth response missing token")
    _payment_history_token = token
    _payment_history_token_expires_at = monotonic() + _AUTH_TOKEN_TTL_SECONDS
    return token


async def list_payments_by_invoice(invoice_id: str | int) -> list[dict]:
    """GET /v1/payment/?invoiceId=... using NOW's short-lived auth token."""
    token = await _get_payment_history_token()
    body = await _request(
        "GET",
        "payment/",
        params={"invoiceId": str(invoice_id), "limit": "50"},
        headers={**_headers(), "Authorization": f"Bearer {token}"},
    )
    rows = body.get("data")
    if not isinstance(rows, list):
        raise NowPaymentsError("NOWPayments payment history response missing data list")
    return [row for row in rows if isinstance(row, dict)]
