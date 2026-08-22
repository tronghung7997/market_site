"""SePay Webhooks + VietQR integration helpers.

No provider-side order is created for a bank deposit.  We generate a unique
payment code and VietQR URL locally, then use SePay only for authenticated bank
transaction delivery and API v2 reconciliation.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
from datetime import datetime
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx

from src.config import settings


class SePayError(Exception):
    """SePay returned a business error or a response with an invalid shape."""


class SePayUnavailableError(Exception):
    """SePay could not be reached or returned a transient HTTP failure."""


_HCM = ZoneInfo("Asia/Ho_Chi_Minh")
_PAYMENT_PREFIX_RE = re.compile(r"^[A-Z]{2,5}$")
_PAYMENT_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_PAYMENT_CODE_SUFFIX_LENGTH = 10


def payment_code_prefix() -> str:
    return str(settings.sepay_payment_code_prefix or "").strip().upper()


def is_configured(
    *,
    bank_code: str | None = None,
    account_number: str | None = None,
    account_name: str | None = None,
    account_id: str | None = None,
) -> bool:
    """Whether the bank rail can safely create QR-backed deposit intents."""
    return bool(
        (settings.sepay_bank_code if bank_code is None else bank_code).strip()
        and (settings.sepay_bank_account_number if account_number is None else account_number).strip()
        and (settings.sepay_bank_account_name if account_name is None else account_name).strip()
        and len(settings.sepay_webhook_secret.encode("utf-8")) >= 32
        and _PAYMENT_PREFIX_RE.fullmatch(payment_code_prefix())
    )


def is_reconciliation_configured(
    *,
    bank_code: str | None = None,
    account_number: str | None = None,
    account_name: str | None = None,
    account_id: str | None = None,
) -> bool:
    """API v2 reconciliation also requires a scoped sandbox/live account ID."""
    return bool(
        is_configured(
            bank_code=bank_code,
            account_number=account_number,
            account_name=account_name,
            account_id=account_id,
        )
        and settings.sepay_api_token
        and (settings.sepay_bank_account_id if account_id is None else account_id).strip()
    )


def generate_payment_code() -> str:
    """Generate a short opaque code that does not expose a database ID."""
    prefix = payment_code_prefix()
    if not _PAYMENT_PREFIX_RE.fullmatch(prefix):
        raise ValueError("SEPAY_PAYMENT_CODE_PREFIX must be 2-5 uppercase letters")
    suffix = "".join(secrets.choice(_PAYMENT_CODE_ALPHABET) for _ in range(_PAYMENT_CODE_SUFFIX_LENGTH))
    return f"{prefix}{suffix}"


def is_valid_payment_code(code: object) -> bool:
    value = str(code or "").strip().upper()
    prefix = payment_code_prefix()
    if not prefix or not value.startswith(prefix):
        return False
    suffix = value[len(prefix):]
    return (
        len(suffix) == _PAYMENT_CODE_SUFFIX_LENGTH
        and suffix.isascii()
        and suffix.isalnum()
        and suffix == suffix.upper()
    )


def build_vietqr_url(
    *, amount: int, payment_code: str,
    bank_code: str | None = None,
    account_number: str | None = None,
) -> str:
    if amount <= 0:
        raise ValueError("amount must be positive")
    query = urlencode({
        "acc": (settings.sepay_bank_account_number if account_number is None else account_number).strip(),
        "bank": (settings.sepay_bank_code if bank_code is None else bank_code).strip(),
        "amount": amount,
        "des": payment_code,
    })
    return f"{settings.sepay_vietqr_base_url.rstrip('/')}?{query}"


def sign_webhook(
    raw_body: bytes,
    timestamp: str | int,
    secret: str | None = None,
) -> str:
    """Return the exact ``sha256=<hex>`` signature SePay sends."""
    key = settings.sepay_webhook_secret if secret is None else secret
    signed = str(timestamp).encode("ascii") + b"." + raw_body
    digest = hmac.new(key.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def verify_webhook_signature(
    raw_body: bytes,
    signature: str | None,
    timestamp: str | None,
    *,
    now: float | None = None,
) -> bool:
    secret = settings.sepay_webhook_secret
    if not secret or not signature or not timestamp:
        return False
    try:
        timestamp_int = int(timestamp)
    except (TypeError, ValueError):
        return False
    current = time.time() if now is None else now
    if abs(current - timestamp_int) > settings.sepay_webhook_timestamp_tolerance_seconds:
        return False
    expected = sign_webhook(raw_body, timestamp_int, secret)
    return hmac.compare_digest(expected, signature)


def _api_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.sepay_api_token}",
        "Accept": "application/json",
    }


def destination_matches(
    expected_destination: str,
    *,
    account_number: object,
    sub_account: object = None,
) -> bool:
    """Match either a real bank account or a SePay VA/TKP destination.

    SePay always reports the parent bank account in ``accountNumber`` /
    ``account_number``. For official VAs and content-based TKP accounts, the
    actual matched destination is reported separately in ``subAccount`` /
    ``va``. The configured QR beneficiary may therefore match either field.
    """
    expected = str(expected_destination or "").strip()
    if not expected:
        return False
    return expected in {
        str(account_number or "").strip(),
        str(sub_account or "").strip(),
    }


def _api_base_url() -> str:
    """Return the SePay API host without a version suffix.

    ``SEPAY_API_BASE_URL`` is documented as the host (for example,
    ``https://userapi.sepay.vn``), while older deployments sometimes stored
    ``/v2`` in the value.  Normalising here keeps both configurations from
    producing the invalid ``/v2/v2/transactions`` URL.
    """
    base_url = str(settings.sepay_api_base_url or "").strip().rstrip("/")
    while base_url.lower().endswith("/v2"):
        base_url = base_url[:-3].rstrip("/")
    return base_url


async def list_matching_transactions(
    *,
    payment_code: str,
    amount: int,
    created_at: datetime,
    bank_code: str | None = None,
    bank_account_id: str | None = None,
    bank_account_number: str | None = None,
    bank_account_name: str | None = None,
) -> list[dict]:
    """Return API v2 transactions that exactly match one deposit intent.

    SePay's ``q`` parameter is a contains-search, so all security-sensitive
    fields are checked again locally before a transaction is eligible.
    """
    if not is_reconciliation_configured(
        bank_code=bank_code,
        account_number=bank_account_number,
        account_name=bank_account_name,
        account_id=bank_account_id,
    ):
        raise SePayError("SePay API reconciliation is not configured")

    local_created = created_at.astimezone(_HCM)
    params: dict[str, str | int] = {
        "q": payment_code,
        "bank_account_id": (settings.sepay_bank_account_id if bank_account_id is None else bank_account_id).strip(),
        "transaction_date_from": local_created.strftime("%Y-%m-%d %H:%M:%S"),
        "amount_in_min": amount,
        "amount_in_max": amount,
        "transfer_type": "in",
        "transaction_date_sort": "asc",
        "per_page": 100,
        "timestamp_format": "iso8601",
    }
    url = f"{_api_base_url()}/v2/transactions"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, headers=_api_headers(), params=params)
    except httpx.RequestError as exc:
        raise SePayUnavailableError(str(exc)) from exc

    if response.status_code >= 500:
        raise SePayUnavailableError(f"HTTP {response.status_code}")
    try:
        body = response.json()
    except ValueError as exc:
        raise SePayError(f"SePay API returned non-JSON HTTP {response.status_code}") from exc
    if response.status_code >= 400:
        raise SePayError(f"HTTP {response.status_code}: {body}")
    if not isinstance(body, dict) or body.get("status") != "success":
        raise SePayError("SePay API response status is not success")
    rows = body.get("data")
    if not isinstance(rows, list):
        raise SePayError("SePay API response is missing data[]")

    expected_code = payment_code.upper()
    expected_account = (settings.sepay_bank_account_number if bank_account_number is None else bank_account_number).strip()
    expected_account_id = (settings.sepay_bank_account_id if bank_account_id is None else bank_account_id).strip()
    matches: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            amount_in = int(row.get("amount_in") or 0)
        except (TypeError, ValueError):
            continue
        if (
            str(row.get("transfer_type") or "").lower() == "in"
            and str(row.get("code") or "").strip().upper() == expected_code
            and destination_matches(
                expected_account,
                account_number=row.get("account_number"),
                sub_account=row.get("va"),
            )
            and str(row.get("bank_account_id") or "").strip() == expected_account_id
            and amount_in == amount
            and row.get("id")
        ):
            matches.append(row)
    return matches
