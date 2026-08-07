"""HMAC-SHA256 request signing for Seller API (v1).

Canonical request (LF-separated, **ASCII only**):

    HTTP_METHOD
    RAW_PATH_WITH_QUERY
    X_TIMESTAMP
    SHA256_HEX(RAW_BODY)

The path+query line is taken from ASGI ``raw_path`` / ``query_string`` and
must be pure ASCII (percent-encode any non-ASCII before signing). HMAC is
computed over the canonical string encoded as ASCII bytes so clients and
server share a single unambiguous octet sequence.

Signature header: ``X-Signature: v1=<lowercase-hex(HMAC-SHA256(api_secret, canonical))>``

Replay protection is *bounded by timestamp window only* — identical requests
replayed within the tolerance window are accepted. Full anti-replay would
require a nonce store (not implemented in v1).
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.account import Account
from src.models.seller_api_key import SellerApiKey
from src.observability import metrics as metrics
from src.rate_limit import check_rate_limit
from src.security.client_ip import client_ip
from src.security.crypto import decrypt_str, encrypt_str
from src.security.events import security_event

SIGNING_VERSION = "v1"

# Header max lengths (abuse / log-injection guard).
_MAX_API_KEY_LEN = 128
_MAX_TIMESTAMP_LEN = 20
_MAX_SIGNATURE_LEN = 80

# ak_live_ + urlsafe token (16 bytes → ~22 chars). Allow some headroom.
_KEY_ID_RE = re.compile(r"^ak_live_[A-Za-z0-9_-]{16,64}$")
# v1= + 64 lowercase hex chars
_SIGNATURE_RE = re.compile(r"^v1=([0-9a-f]{64})$")

# Dummy plaintext secret; always Fernet-decrypted via a cached ciphertext so
# unknown-key paths pay roughly the same decrypt cost as known keys.
_DUMMY_SIGNING_SECRET = "sk_live_" + ("0" * 43)
_dummy_ciphertext: str | None = None

_AUTH_FAIL_DETAIL = "Chữ ký request không hợp lệ"
_RATE_WINDOW_SECONDS = 60

SIGNING_HEADER_NAMES = ("x-api-key", "x-timestamp", "x-signature")


@dataclass(frozen=True, slots=True)
class SigningHeaders:
    key_id: str
    timestamp: int
    signature_hex: str  # 64 lowercase hex chars, without v1= prefix


def _dummy_encrypted_secret() -> str:
    """Process-cached Fernet ciphertext of the dummy secret for equal-cost decrypt."""
    global _dummy_ciphertext
    if _dummy_ciphertext is None:
        _dummy_ciphertext = encrypt_str(_DUMMY_SIGNING_SECRET)
    return _dummy_ciphertext


def reset_dummy_ciphertext_cache() -> None:
    """Test helper when ENCRYPTION_KEY is monkeypatched."""
    global _dummy_ciphertext
    _dummy_ciphertext = None


def has_any_signing_header(request: Request) -> bool:
    """True if any of the three signing headers is present (even if empty)."""
    return any(name in request.headers for name in SIGNING_HEADER_NAMES)


def has_all_signing_headers(request: Request) -> bool:
    return all(name in request.headers for name in SIGNING_HEADER_NAMES)


def parse_signing_headers(request: Request) -> SigningHeaders:
    """Validate presence, length, and format of the three signing headers."""
    if not has_all_signing_headers(request):
        metrics.observe_auth_rejection("missing_signing_header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Thiếu header ký request (X-API-Key, X-Timestamp, X-Signature)",
        )

    raw_key = request.headers.get("x-api-key") or ""
    raw_ts = request.headers.get("x-timestamp") or ""
    raw_sig = request.headers.get("x-signature") or ""

    # Present-but-empty is not a missing-header fallback path — hard fail.
    if not raw_key or not raw_ts or not raw_sig:
        metrics.observe_auth_rejection("missing_signing_header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Thiếu header ký request (X-API-Key, X-Timestamp, X-Signature)",
        )

    if len(raw_key) > _MAX_API_KEY_LEN or len(raw_ts) > _MAX_TIMESTAMP_LEN or len(raw_sig) > _MAX_SIGNATURE_LEN:
        metrics.observe_auth_rejection("header_too_long")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    if not _KEY_ID_RE.match(raw_key):
        metrics.observe_auth_rejection("bad_key_format")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    if not raw_ts.isdigit() or (raw_ts.startswith("0") and raw_ts != "0"):
        # Reject negatives, floats, leading zeros, non-digits.
        metrics.observe_auth_rejection("bad_timestamp")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    try:
        timestamp = int(raw_ts)
    except ValueError:
        metrics.observe_auth_rejection("bad_timestamp")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    if timestamp < 0:
        metrics.observe_auth_rejection("bad_timestamp")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    match = _SIGNATURE_RE.match(raw_sig)
    if not match:
        metrics.observe_auth_rejection("bad_signature_format")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    return SigningHeaders(key_id=raw_key, timestamp=timestamp, signature_hex=match.group(1))


def validate_timestamp(
    timestamp: int,
    *,
    now: int | None = None,
    tolerance: int | None = None,
) -> None:
    """Reject timestamps outside ±tolerance of UTC now (seconds)."""
    if now is None:
        now = int(time.time())
    if tolerance is None:
        tolerance = settings.api_signing_timestamp_tolerance_seconds

    delta = timestamp - now
    if delta < -tolerance or delta > tolerance:
        metrics.observe_auth_rejection("timestamp_out_of_window")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)


def raw_path_with_query_bytes(request: Request) -> bytes:
    """Raw path + query octets from ASGI — no re-encoding or query sorting.

    Contract (v1): every octet must be ASCII (0x00–0x7F). Clients must
    percent-encode non-ASCII before signing. Non-ASCII targets are rejected
    rather than silently re-encoded (latin-1 → utf-8 would break signatures).
    """
    raw_path = request.scope.get("raw_path")
    if isinstance(raw_path, (bytes, bytearray)):
        path = bytes(raw_path)
    else:
        # Fallback for unusual ASGI servers — only accept if already ASCII.
        try:
            path = str(request.url.path).encode("ascii")
        except UnicodeEncodeError:
            metrics.observe_auth_rejection("non_ascii_path")
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    query = request.scope.get("query_string") or b""
    if isinstance(query, str):
        try:
            query = query.encode("ascii")
        except UnicodeEncodeError:
            metrics.observe_auth_rejection("non_ascii_path")
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    target = path + b"?" + query if query else path
    if any(b > 0x7F for b in target):
        metrics.observe_auth_rejection("non_ascii_path")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)
    return target


def raw_path_with_query(request: Request) -> str:
    """ASCII path+query string (for logging/tests). Rejects non-ASCII targets."""
    return raw_path_with_query_bytes(request).decode("ascii")


def body_sha256_hex(raw_body: bytes) -> str:
    return hashlib.sha256(raw_body).hexdigest()


def build_canonical_request_bytes(
    request: Request,
    timestamp: int,
    raw_body: bytes,
) -> bytes:
    """Build the exact octet sequence that is HMAC'd (ASCII canonical form)."""
    method = (request.method or "GET").upper().encode("ascii")
    path = raw_path_with_query_bytes(request)
    ts = str(timestamp).encode("ascii")
    body_hash = body_sha256_hex(raw_body).encode("ascii")
    return method + b"\n" + path + b"\n" + ts + b"\n" + body_hash


def build_canonical_request(
    request: Request,
    timestamp: int,
    raw_body: bytes,
) -> str:
    """ASCII string form of the canonical request (tests / docs)."""
    return build_canonical_request_bytes(request, timestamp, raw_body).decode("ascii")


def calculate_signature(secret: str, canonical_request: str | bytes) -> str:
    """Return lowercase hex HMAC-SHA256 of the canonical request octets."""
    if isinstance(canonical_request, str):
        # Documented contract: canonical form is ASCII.
        message = canonical_request.encode("ascii")
    else:
        message = canonical_request
    digest = hmac.new(
        secret.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()
    return digest


def format_signature_header(signature_hex: str) -> str:
    return f"{SIGNING_VERSION}={signature_hex}"


def _opaque_bucket(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def _rate_limit_or_429(request: Request, *, bucket: str, limit: int, scope: str) -> None:
    if await check_rate_limit(
        bucket,
        limit=limit,
        window_seconds=_RATE_WINDOW_SECONDS,
        fail_open=False,
    ):
        return
    metrics.observe_auth_rejection("rate_limited")
    security_event(
        "api_signing_rate_limited",
        level="warning",
        scope=scope,
        path=request.url.path,
    )
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Quá nhiều request",
        headers={"Retry-After": str(_RATE_WINDOW_SECONDS)},
    )


async def verify_signed_request(request: Request, db: AsyncSession) -> Account:
    """Full v1 signed-request verification. Sets request.state on success."""
    # IP limit before any DB work. Uses trusted-proxy-aware client_ip().
    await _rate_limit_or_429(
        request,
        bucket=f"api-sign-ip:{client_ip(request)}",
        limit=settings.api_signing_ip_limit,
        scope="ip",
    )

    headers = parse_signing_headers(request)
    # Key bucket uses opaque hash of key_id — never the raw credential.
    await _rate_limit_or_429(
        request,
        bucket=f"api-sign-key:{_opaque_bucket(headers.key_id)}",
        limit=settings.api_signing_key_limit,
        scope="key",
    )
    validate_timestamp(headers.timestamp)

    row = await db.scalar(
        select(SellerApiKey).where(
            SellerApiKey.key_id == headers.key_id,
            SellerApiKey.revoked_at.is_(None),
            SellerApiKey.signing_secret_encrypted.is_not(None),
        )
    )

    if row is not None and row.signing_version != SIGNING_VERSION:
        metrics.observe_auth_rejection("unsupported_signing_version")
        security_event(
            "api_signing_rejected",
            level="warning",
            reason="unsupported_version",
            path=request.url.path,
            key_prefix=row.key_prefix,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    # Always Fernet-decrypt (real or dummy ciphertext) so unknown keys pay a
    # similar cost before HMAC — not a perfect equal-time path, but closes the
    # "skip decrypt on miss" gap.
    ciphertext = row.signing_secret_encrypted if row is not None else _dummy_encrypted_secret()
    try:
        secret = decrypt_str(ciphertext)
    except Exception:
        metrics.observe_auth_rejection("decrypt_failed")
        security_event(
            "api_signing_rejected",
            level="error",
            reason="decrypt_failed",
            path=request.url.path,
            key_prefix=(row.key_prefix if row is not None else headers.key_id[:12]),
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    raw_body = await request.body()
    canonical = build_canonical_request_bytes(request, headers.timestamp, raw_body)
    expected = calculate_signature(secret, canonical)

    if not hmac.compare_digest(expected, headers.signature_hex):
        metrics.observe_auth_rejection("bad_signature")
        security_event(
            "api_signing_rejected",
            level="warning",
            reason="bad_signature",
            path=request.url.path,
            key_prefix=(row.key_prefix if row is not None else headers.key_id[:12]),
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    if row is None:
        metrics.observe_auth_rejection("unknown_key")
        security_event(
            "api_signing_rejected",
            level="warning",
            reason="unknown_key",
            path=request.url.path,
            key_prefix=headers.key_id[:12],
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    account = await db.get(Account, row.account_id)
    if not account or not account.is_active:
        metrics.observe_auth_rejection("inactive_account")
        security_event(
            "api_signing_rejected",
            level="warning",
            reason="inactive_account",
            path=request.url.path,
            key_prefix=row.key_prefix,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_AUTH_FAIL_DETAIL)

    if "seller" not in (account.roles or []):
        metrics.observe_auth_rejection("not_seller")
        security_event(
            "api_signing_rejected",
            level="warning",
            reason="not_seller",
            path=request.url.path,
            key_prefix=row.key_prefix,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Yêu cầu quyền seller",
        )

    row.last_used_at = func.now()
    await db.commit()

    request.state.account_id = account.id
    request.state.api_key_id = row.id
    metrics.observe_auth_method("signed_v1")
    return account
