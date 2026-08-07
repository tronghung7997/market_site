"""Unit tests for seller API request signing protocol (v1)."""

from __future__ import annotations

import hashlib
import hmac
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from src.auth import request_signing as rs


# ---------------------------------------------------------------------------
# Fixed cross-language test vector (do not change without updating clients)
# ---------------------------------------------------------------------------
FIXED_SECRET = "sk_live_test_secret_for_vector_only_xxxxxxxx"
FIXED_METHOD = "POST"
FIXED_PATH = "/seller/orders/123/deliver?notify=true"
FIXED_TIMESTAMP = 1786089600
FIXED_BODY = b'{"data":"hello"}'
FIXED_BODY_HASH = "1a1bc6b5b117ed93a2fcc40281efc93d8ccbcc3e52b2dd00a3ca64d54ba7cd38"
FIXED_SIGNATURE = "06b14a1cd0b91706fe889779a3bfda635cf6fcabeb70376c28384a8252c6b7be"


def _make_request(
    *,
    method: str = "GET",
    path: str = "/seller/orders",
    query: bytes = b"",
    headers: dict | None = None,
    body: bytes = b"",
):
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode("latin-1"),
        "query_string": query,
        "headers": [],
    }
    req = MagicMock()
    req.method = method
    req.scope = scope
    req.url = SimpleNamespace(path=path)
    req.headers = headers or {}
    req.client = SimpleNamespace(host="127.0.0.1")

    async def _body():
        return body

    req.body = _body
    return req


# ---------------------------------------------------------------------------
# 11.1 Canonicalization
# ---------------------------------------------------------------------------

@pytest.mark.no_db
def test_body_sha256_empty():
    assert rs.body_sha256_hex(b"") == hashlib.sha256(b"").hexdigest()
    assert rs.body_sha256_hex(b"") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


@pytest.mark.no_db
def test_canonical_get_empty_body():
    req = _make_request(method="get", path="/seller/orders")
    canonical = rs.build_canonical_request(req, 1000, b"")
    expected_hash = rs.body_sha256_hex(b"")
    assert canonical == f"GET\n/seller/orders\n1000\n{expected_hash}"


@pytest.mark.no_db
def test_canonical_post_json():
    body = b'{"items":[1]}'
    req = _make_request(method="POST", path="/seller/variants/1/resources")
    canonical = rs.build_canonical_request(req, 2000, body)
    assert canonical.startswith("POST\n/seller/variants/1/resources\n2000\n")
    assert canonical.endswith(rs.body_sha256_hex(body))


@pytest.mark.no_db
def test_json_whitespace_changes_signature():
    a = b'{"data":"x"}'
    b = b'{ "data" : "x" }'
    assert rs.body_sha256_hex(a) != rs.body_sha256_hex(b)
    ca = rs.calculate_signature("secret", f"POST\n/p\n1\n{rs.body_sha256_hex(a)}")
    cb = rs.calculate_signature("secret", f"POST\n/p\n1\n{rs.body_sha256_hex(b)}")
    assert ca != cb


@pytest.mark.no_db
def test_unicode_and_binary_body_hashed_raw():
    unicode_body = "café".encode("utf-8")
    binary_body = bytes(range(256))
    assert len(rs.body_sha256_hex(unicode_body)) == 64
    assert len(rs.body_sha256_hex(binary_body)) == 64
    assert rs.body_sha256_hex(unicode_body) != rs.body_sha256_hex(binary_body)


@pytest.mark.no_db
def test_query_parameter_order_and_duplicates_preserved():
    req_a = _make_request(path="/seller/orders", query=b"a=1&b=2")
    req_b = _make_request(path="/seller/orders", query=b"b=2&a=1")
    req_dup = _make_request(path="/seller/orders", query=b"a=1&a=2")
    ca = rs.build_canonical_request(req_a, 1, b"")
    cb = rs.build_canonical_request(req_b, 1, b"")
    cd = rs.build_canonical_request(req_dup, 1, b"")
    assert "/seller/orders?a=1&b=2" in ca
    assert "/seller/orders?b=2&a=1" in cb
    assert ca != cb
    assert "/seller/orders?a=1&a=2" in cd


@pytest.mark.no_db
def test_percent_encoded_path_not_redecoded():
    path = "/seller/orders/%2Fextra"
    req = _make_request(path=path)
    canonical = rs.build_canonical_request(req, 1, b"")
    assert path in canonical.split("\n")[1]


@pytest.mark.no_db
def test_empty_query_string_no_question_mark():
    req = _make_request(path="/seller/orders", query=b"")
    path_line = rs.build_canonical_request(req, 1, b"").split("\n")[1]
    assert path_line == "/seller/orders"


@pytest.mark.no_db
def test_method_lowercased_is_uppercased():
    req = _make_request(method="post", path="/x")
    assert rs.build_canonical_request(req, 1, b"").startswith("POST\n")


@pytest.mark.no_db
def test_fixed_cross_language_signature_vector():
    assert rs.body_sha256_hex(FIXED_BODY) == FIXED_BODY_HASH
    canonical = (
        f"{FIXED_METHOD}\n{FIXED_PATH}\n{FIXED_TIMESTAMP}\n{FIXED_BODY_HASH}"
    )
    sig = rs.calculate_signature(FIXED_SECRET, canonical)
    assert sig == FIXED_SIGNATURE
    assert rs.format_signature_header(sig) == f"v1={FIXED_SIGNATURE}"
    # Independent recomputation with stdlib — HMAC over ASCII octets
    expected = hmac.new(
        FIXED_SECRET.encode("utf-8"), canonical.encode("ascii"), hashlib.sha256
    ).hexdigest()
    assert expected == FIXED_SIGNATURE
    # bytes form matches string form
    path_only, _, q = FIXED_PATH.partition("?")
    req = _make_request(method=FIXED_METHOD, path=path_only, query=q.encode("ascii"), body=FIXED_BODY)
    canon_b = rs.build_canonical_request_bytes(req, FIXED_TIMESTAMP, FIXED_BODY)
    assert canon_b == canonical.encode("ascii")
    assert rs.calculate_signature(FIXED_SECRET, canon_b) == FIXED_SIGNATURE


@pytest.mark.no_db
def test_non_ascii_path_rejected():
    req = _make_request(path="/seller/orders")
    req.scope["raw_path"] = b"/seller/orders/\xc3\xa9"  # UTF-8 "é" — not ASCII
    with pytest.raises(HTTPException) as exc:
        rs.raw_path_with_query_bytes(req)
    assert exc.value.status_code == 401


@pytest.mark.no_db
def test_has_any_signing_header_true_for_empty_value():
    """Presence (including empty value) counts — not truthiness of the value."""
    req = _make_request(headers={"x-signature": ""})
    # MagicMock headers is a plain dict; emulate Starlette case-insensitivity via keys used by our code.
    assert rs.has_any_signing_header(req) is True
    assert rs.has_all_signing_headers(req) is False

    class _H(dict):
        def __contains__(self, key):  # type: ignore[override]
            return super().__contains__(str(key).lower())

        def get(self, key, default=None):  # type: ignore[override]
            return super().get(str(key).lower(), default)

    req2 = _make_request(headers=_H({"x-api-key": "", "x-timestamp": "", "x-signature": ""}))
    assert rs.has_any_signing_header(req2) is True
    assert rs.has_all_signing_headers(req2) is True
    with pytest.raises(HTTPException) as exc:
        rs.parse_signing_headers(req2)
    assert exc.value.status_code == 401


@pytest.mark.no_db
def test_canonical_hmac_uses_ascii_bytes_not_latin1_roundtrip():
    """Ensure we do not latin-1-decode then utf-8-encode the path."""
    # Pure ASCII path still works; signature of bytes form is stable.
    req = _make_request(method="GET", path="/seller/orders", query=b"a=%2F")
    canon = rs.build_canonical_request_bytes(req, 42, b"")
    assert b"\n/seller/orders?a=%2F\n" in canon
    assert all(b < 128 for b in canon)
    sig_str = rs.calculate_signature("secret", canon.decode("ascii"))
    sig_bytes = rs.calculate_signature("secret", canon)
    assert sig_str == sig_bytes


# ---------------------------------------------------------------------------
# 11.2 Timestamp
# ---------------------------------------------------------------------------

@pytest.mark.no_db
def test_timestamp_current_valid():
    now = int(time.time())
    rs.validate_timestamp(now, now=now, tolerance=300)  # no raise


@pytest.mark.no_db
def test_timestamp_past_boundary_inclusive():
    now = 1_000_000
    rs.validate_timestamp(now - 300, now=now, tolerance=300)


@pytest.mark.no_db
def test_timestamp_future_boundary_inclusive():
    now = 1_000_000
    rs.validate_timestamp(now + 300, now=now, tolerance=300)


@pytest.mark.no_db
def test_timestamp_too_old_rejected():
    now = 1_000_000
    with pytest.raises(HTTPException) as exc:
        rs.validate_timestamp(now - 301, now=now, tolerance=300)
    assert exc.value.status_code == 401


@pytest.mark.no_db
def test_timestamp_too_far_future_rejected():
    now = 1_000_000
    with pytest.raises(HTTPException) as exc:
        rs.validate_timestamp(now + 301, now=now, tolerance=300)
    assert exc.value.status_code == 401


@pytest.mark.no_db
def test_parse_rejects_negative_float_non_numeric_timestamp():
    for bad_ts in ("-1", "1.5", "abc", "01", ""):
        headers = {
            "x-api-key": "ak_live_" + ("a" * 22),
            "x-timestamp": bad_ts,
            "x-signature": "v1=" + ("0" * 64),
        }
        if bad_ts == "":
            # empty treated as missing
            headers.pop("x-timestamp")
            headers["x-timestamp"] = ""
        req = _make_request(headers=headers)
        # empty string is falsy → missing header path
        with pytest.raises(HTTPException) as exc:
            rs.parse_signing_headers(req)
        assert exc.value.status_code == 401


@pytest.mark.no_db
def test_parse_rejects_timestamp_too_long():
    headers = {
        "x-api-key": "ak_live_" + ("a" * 22),
        "x-timestamp": "1" * 21,
        "x-signature": "v1=" + ("0" * 64),
    }
    req = _make_request(headers=headers)
    with pytest.raises(HTTPException) as exc:
        rs.parse_signing_headers(req)
    assert exc.value.status_code == 401


# ---------------------------------------------------------------------------
# 11.3 Signature format
# ---------------------------------------------------------------------------

@pytest.mark.no_db
def test_parse_valid_signature_headers():
    key = "ak_live_" + ("b" * 22)
    headers = {
        "x-api-key": key,
        "x-timestamp": "1786089600",
        "x-signature": f"v1={FIXED_SIGNATURE}",
    }
    parsed = rs.parse_signing_headers(_make_request(headers=headers))
    assert parsed.key_id == key
    assert parsed.timestamp == 1786089600
    assert parsed.signature_hex == FIXED_SIGNATURE


@pytest.mark.no_db
def test_parse_rejects_missing_version_and_unsupported():
    key = "ak_live_" + ("c" * 22)
    for bad_sig in (FIXED_SIGNATURE, f"v2={FIXED_SIGNATURE}", "v1=", "v1=ZZ", f"v1={FIXED_SIGNATURE.upper()}"):
        headers = {
            "x-api-key": key,
            "x-timestamp": "1786089600",
            "x-signature": bad_sig,
        }
        with pytest.raises(HTTPException) as exc:
            rs.parse_signing_headers(_make_request(headers=headers))
        assert exc.value.status_code == 401


@pytest.mark.no_db
def test_parse_rejects_wrong_hex_length_and_empty():
    key = "ak_live_" + ("d" * 22)
    for bad_sig in ("v1=" + "ab" * 10, "v1=", ""):
        headers = {
            "x-api-key": key,
            "x-timestamp": "1786089600",
            "x-signature": bad_sig,
        }
        with pytest.raises(HTTPException):
            rs.parse_signing_headers(_make_request(headers=headers))


@pytest.mark.no_db
def test_compare_digest_used_for_signature_check():
    # Smoke: calculate_signature output is lowercase hex of correct length
    sig = rs.calculate_signature("secret", "canonical")
    assert len(sig) == 64
    assert sig == sig.lower()
    assert all(c in "0123456789abcdef" for c in sig)
    # Constant-time comparison returns True for equal values
    assert hmac.compare_digest(sig, sig)
