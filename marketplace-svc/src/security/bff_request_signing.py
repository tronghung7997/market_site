"""Authenticate requests forwarded by the Market Site BFF.

The browser never receives ``BFF_REQUEST_SIGNING_SECRET``. The Next.js BFF
signs the exact upstream method, path+query, timestamp, and raw body before
forwarding it to FastAPI. This is service authentication; route dependencies
still enforce the user's JWT role.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time

from fastapi import HTTPException, Request, status

from src.config import settings

SIGNING_HEADER_NAMES = ("x-api-key", "x-timestamp", "x-signature")
_SIGNATURE_RE = re.compile(r"^v1=([0-9a-f]{64})$")
_AUTH_FAIL_DETAIL = "Chữ ký BFF không hợp lệ"
_UNSIGNED_EXACT_PATHS = {"/health", "/webhooks/payos", "/webhooks/sepay", "/webhooks/nowpayments"}


def requires_bff_signature(request: Request) -> bool:
    path = request.url.path
    return path not in _UNSIGNED_EXACT_PATHS and not path.startswith("/webhooks/providers/")


def _raw_target(request: Request) -> bytes:
    raw_path = request.scope.get("raw_path")
    if isinstance(raw_path, (bytes, bytearray)):
        path = bytes(raw_path)
    else:
        try:
            path = request.url.path.encode("ascii")
        except UnicodeEncodeError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL) from exc
    query = request.scope.get("query_string") or b""
    if isinstance(query, str):
        try:
            query = query.encode("ascii")
        except UnicodeEncodeError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL) from exc
    target = path + b"?" + query if query else path
    if any(octet > 0x7F for octet in target):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)
    return target


def canonical_request(request: Request, timestamp: int, raw_body: bytes) -> bytes:
    return b"\n".join((
        request.method.upper().encode("ascii"),
        _raw_target(request),
        str(timestamp).encode("ascii"),
        hashlib.sha256(raw_body).hexdigest().encode("ascii"),
    ))


async def verify_bff_request_signature(request: Request) -> None:
    if not all(name in request.headers for name in SIGNING_HEADER_NAMES):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)
    key_id = request.headers.get("x-api-key") or ""
    raw_timestamp = request.headers.get("x-timestamp") or ""
    raw_signature = request.headers.get("x-signature") or ""
    if (
        not hmac.compare_digest(key_id, settings.bff_request_signing_key_id)
        or not raw_timestamp
        or len(raw_timestamp) > 20
        or not raw_timestamp.isdigit()
        or (raw_timestamp.startswith("0") and raw_timestamp != "0")
        or len(raw_signature) > 80
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)
    match = _SIGNATURE_RE.match(raw_signature)
    if match is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)
    timestamp = int(raw_timestamp)
    if abs(int(time.time()) - timestamp) > settings.bff_request_signing_timestamp_tolerance_seconds:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)
    expected = hmac.new(
        settings.bff_request_signing_secret.encode("utf-8"),
        canonical_request(request, timestamp, await request.body()),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, match.group(1)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)
