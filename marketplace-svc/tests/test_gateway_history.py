"""Unit tests for gateway call-history sanitization (WP3)."""
import json
from unittest.mock import AsyncMock, patch

import pytest

from src.gateway.call_history import (
    bound_request_preview,
    record_gateway_call_log,
    sanitize_error_text,
    sanitize_for_history,
    sanitize_response_snippet,
)


@pytest.mark.no_db
def test_nested_sensitive_keys_redacted():
    raw = {
        "query": {"Authorization": "Bearer secret-token", "q": "ok"},
        "body": {
            "apiKey": "abc",
            "nested": {"password": "p", "safe": 1},
            "checksum": "deadbeef",
        },
    }
    out = sanitize_for_history(raw)
    assert out["query"]["Authorization"] == "[REDACTED]"
    assert out["query"]["q"] == "ok"
    assert out["body"]["apiKey"] == "[REDACTED]"
    assert out["body"]["nested"]["password"] == "[REDACTED]"
    assert out["body"]["nested"]["safe"] == 1
    assert out["body"]["checksum"] == "[REDACTED]"


@pytest.mark.no_db
def test_case_variants_redacted():
    raw = {"Cookie": "a=b", "TOKEN": "t", "client_secret": "s", "private-key": "k"}
    out = sanitize_for_history(raw)
    assert all(v == "[REDACTED]" for v in out.values())


@pytest.mark.no_db
def test_does_not_mutate_input():
    raw = {"token": "secret", "nested": {"api_key": "x"}}
    snapshot = json.dumps(raw, sort_keys=True)
    sanitize_for_history(raw)
    assert json.dumps(raw, sort_keys=True) == snapshot


@pytest.mark.no_db
def test_deep_and_large_payloads_bounded():
    deep = current = {}
    for _ in range(20):
        nxt = {}
        current["child"] = nxt
        current = nxt
    current["leaf"] = "x"
    out = sanitize_for_history(deep)
    # Walk until truncated marker
    node = out
    saw_trunc = False
    for _ in range(10):
        if isinstance(node, dict) and node.get("_truncated"):
            saw_trunc = True
            break
        node = node.get("child") if isinstance(node, dict) else None
        if node is None:
            break
    assert saw_trunc

    big_list = list(range(200))
    listed = sanitize_for_history(big_list)
    assert len(listed) <= 51  # 50 items + truncation marker
    assert any(isinstance(x, dict) and x.get("_truncated") for x in listed)

    long_str = "a" * 5000
    assert len(sanitize_for_history(long_str)) < 600


@pytest.mark.no_db
def test_request_preview_8kib_bound():
    # Many medium strings still exceed 8 KiB after per-string bounds.
    payload = {
        "query": {"q": "x", "Authorization": "Bearer secret-token"},
        "body": {f"field_{i}": ("Z" * 400) for i in range(40)},
    }
    preview = bound_request_preview(payload)
    assert preview is not None
    encoded = json.dumps(preview, ensure_ascii=False)
    assert len(encoded.encode("utf-8")) <= 8 * 1024
    assert preview.get("_truncated") is True or "body" not in preview
    blob = json.dumps(preview)
    assert "secret-token" not in blob
    assert "Bearer" not in blob or "[REDACTED]" in blob


@pytest.mark.no_db
def test_error_text_redacts_and_bounds():
    err = "failed Authorization: Bearer abc.def " + ("x" * 1000)
    out = sanitize_error_text(err)
    assert out is not None
    assert "Bearer abc" not in out
    assert "[REDACTED]" in out
    assert len(out) <= 520


@pytest.mark.no_db
def test_response_snippet_sanitizes_json():
    body = json.dumps({"ok": True, "api_key": "should-not-store", "data": {"n": 1}}).encode()
    snippet = sanitize_response_snippet(body)
    assert snippet is not None
    assert "should-not-store" not in snippet
    assert "[REDACTED]" in snippet
    assert "ok" in snippet


@pytest.mark.asyncio
@pytest.mark.no_db
async def test_record_is_best_effort_on_db_failure(monkeypatch):
    class Boom:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr("src.gateway.call_history.SessionLocal", lambda: Boom())
    # Must not raise.
    await record_gateway_call_log(
        order_id=1,
        endpoint="search",
        latency_ms=10,
        request_payload={"token": "secret"},
        error="password=hunter2",
    )
