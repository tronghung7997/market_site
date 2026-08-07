"""Unit coverage for telemetry privacy and output safety."""

import structlog
import pytest

from src.observability.metrics import observe_http_request, render_prometheus, snapshot
from src.observability.sentry import scrub_sentry_event


@pytest.mark.no_db
def test_prometheus_label_values_are_escaped():
    observe_http_request(
        method="GET",
        route='/bad"route\\segment\nnext',
        status=200,
        duration_ms=1,
    )

    rendered = render_prometheus()

    assert 'method="GET"' in rendered
    assert 'route="/bad\\"route\\\\segment\\nnext"' in rendered
    assert '/bad"route\\segment\nnext' not in rendered


@pytest.mark.no_db
def test_unknown_http_methods_share_one_low_cardinality_bucket():
    observe_http_request(
        method="ATTACKER-CONTROLLED-ONE",
        route="__unmatched__",
        status=404,
        duration_ms=1,
    )
    observe_http_request(
        method="ATTACKER-CONTROLLED-TWO",
        route="__unmatched__",
        status=404,
        duration_ms=1,
    )

    requests = snapshot()["http_requests"]
    assert requests[("OTHER", "__unmatched__", "4xx")] == 2


@pytest.mark.no_db
def test_sentry_event_strips_request_secrets_and_attaches_request_id():
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id="request-123")
    try:
        event = {
            "request": {
                "url": "https://api.example/gw/live-secret/search?token=query-secret#fragment",
                "query_string": "token=query-secret",
                "data": {"password": "body-secret"},
                "cookies": {"session": "cookie-secret"},
                "headers": {
                    "Authorization": "Bearer header-secret",
                    "X-Seller-Api-Key": "seller-secret",
                    "X-API-Key": "ak_live_public-id",
                    "X-Signature": "v1=deadbeef",
                    "Accept": "application/json",
                },
            }
        }

        scrubbed = scrub_sentry_event(event)

        request = scrubbed["request"]
        assert request["url"] == "https://api.example/gw/[REDACTED]/search"
        assert "query_string" not in request
        assert "data" not in request
        assert "cookies" not in request
        assert request["headers"]["Authorization"] == "[REDACTED]"
        assert request["headers"]["X-Seller-Api-Key"] == "[REDACTED]"
        assert request["headers"]["X-API-Key"] == "[REDACTED]"
        assert request["headers"]["X-Signature"] == "[REDACTED]"
        assert request["headers"]["Accept"] == "application/json"
        assert scrubbed["tags"]["request_id"] == "request-123"
        assert "query-secret" not in repr(scrubbed)
        assert "header-secret" not in repr(scrubbed)
        assert "body-secret" not in repr(scrubbed)
        assert "cookie-secret" not in repr(scrubbed)
        assert "live-secret" not in repr(scrubbed)
        assert "ak_live_public-id" not in repr(scrubbed)
        assert "deadbeef" not in repr(scrubbed)
    finally:
        structlog.contextvars.clear_contextvars()
