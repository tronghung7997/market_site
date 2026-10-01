"""Structured log pipeline: JSON everywhere, readable errors, no secrets."""

import asyncio
import io
import json
import logging

import httpx
import pytest
import structlog

from src.logging import setup_logging
from src.observability import outbound
from src.observability.jobs import traced_job


def _lines(captured: str) -> list[dict]:
    return [json.loads(line) for line in captured.splitlines() if line.strip()]


def _capture() -> io.StringIO:
    buffer = io.StringIO()
    structlog.reset_defaults()
    setup_logging(buffer)
    return buffer


def _drain(buffer: io.StringIO) -> list[dict]:
    lines = _lines(buffer.getvalue())
    buffer.seek(0)
    buffer.truncate()
    return lines


@pytest.fixture
def json_logs(monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    monkeypatch.setenv("DEPLOYMENT_ENVIRONMENT", "test")
    monkeypatch.setenv("APP_VERSION", "abc123")
    buffer = _capture()
    yield lambda: _drain(buffer)
    structlog.contextvars.clear_contextvars()
    monkeypatch.undo()
    structlog.reset_defaults()
    setup_logging()


def _explode():
    raise ValueError("balance mismatch")


def test_exception_is_rendered_with_location_and_stack(json_logs):
    try:
        _explode()
    except ValueError:
        structlog.get_logger("t").error("payout_failed", exc_info=True)
    [line] = json_logs()
    assert line["event"] == "payout_failed"
    assert line["level"] == "error"
    assert line["env"] == "test" and line["version"] == "abc123"
    assert line["error_type"] == "ValueError"
    assert line["error_message"] == "balance mismatch"
    assert "exc_info" not in line
    assert "balance mismatch" in line["error_stack"]


def test_error_where_points_at_the_codebase_frame(json_logs):
    from src.errors.exceptions import CodedHTTPException

    try:
        CodedHTTPException(None, 400)  # type: ignore[arg-type]
    except KeyError:
        structlog.get_logger().exception("boom")
    [line] = json_logs()
    assert line["error_where"].startswith("src/errors/exceptions.py:")
    assert line["error_where"].endswith("in __init__")


def test_error_where_skips_logging_plumbing(json_logs):
    try:
        outbound.path_template(None)  # type: ignore[arg-type]
    except AttributeError:
        structlog.get_logger().exception("boom")
    [line] = json_logs()
    assert "error_where" not in line
    assert line["error_type"] == "AttributeError"


def test_uvicorn_duplicate_of_unhandled_exception_is_dropped(json_logs):
    logging.getLogger("uvicorn.error").error("Exception in ASGI application")
    logging.getLogger("uvicorn.error").info("Application startup complete.")
    assert [line["event"] for line in json_logs()] == ["Application startup complete."]


def test_secret_named_fields_are_redacted(json_logs):
    structlog.get_logger().info(
        "login", password="hunter2", api_key="k", nested={"access_token": "t", "ok": 1},
        signature_valid=True, prompt_tokens=12,
    )
    [line] = json_logs()
    assert line["password"] == "[REDACTED]"
    assert line["api_key"] == "[REDACTED]"
    assert line["nested"] == {"access_token": "[REDACTED]", "ok": 1}
    assert line["signature_valid"] is True
    assert line["prompt_tokens"] == 12


def test_stdlib_loggers_emit_json_with_context(json_logs):
    structlog.contextvars.bind_contextvars(request_id="req-1")
    logging.getLogger("some.sdk").warning("retrying %s", "payos")
    [line] = json_logs()
    assert line["event"] == "retrying payos"
    assert line["level"] == "warning"
    assert line["logger"] == "some.sdk"
    assert line["request_id"] == "req-1"


def test_log_level_filters_debug(monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "INFO")
    buffer = _capture()
    try:
        structlog.get_logger("lvl").debug("hidden")
        structlog.get_logger("lvl").info("shown")
        assert [line["event"] for line in _drain(buffer)] == ["shown"]
    finally:
        monkeypatch.undo()
        structlog.reset_defaults()
        setup_logging()


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/v2/payment-requests/12345", "/v2/payment-requests/{id}"),
        ("/bot123456:AAHxyz/sendMessage", "/{key}/sendMessage"),
        ("/api/orders/3f2b8c1e-0a4d-4c55-9e1f-6f0c3a2b9d11/status", "/api/orders/{id}/status"),
        ("/gw/sk_live_abcdefghijklmnopqrstuvwxyz/proxy", "/gw/{key}/proxy"),
        ("/userapi/transactions/list", "/userapi/transactions/list"),
    ],
)
def test_path_template_hides_ids_and_keys(path, expected):
    assert outbound.path_template(path) == expected


def test_integration_named_by_host_or_context():
    assert outbound.integration_for_host("api-merchant.payos.vn") == "payos"
    assert outbound.integration_for_host("my.sepay.vn") == "sepay"
    assert outbound.integration_for_host("supplier.example") == "supplier.example"
    with outbound.integration("igbm"):
        assert outbound.integration_for_host("supplier.example") == "igbm"


async def _serve(status_line: bytes):
    async def handle(reader, writer):
        await reader.readuntil(b"\r\n\r\n")
        writer.write(status_line + b"\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1]


@pytest.mark.asyncio
async def test_upstream_call_logs_status_and_outcome(json_logs):
    outbound.install()
    server, port = await _serve(b"HTTP/1.1 503 Service Unavailable")
    structlog.contextvars.bind_contextvars(request_id="req-up")
    async with server, httpx.AsyncClient() as client:
        response = await client.get(f"http://127.0.0.1:{port}/v1/orders/42?api_key=secret")
    assert response.status_code == 503
    [line] = [entry for entry in json_logs() if entry["event"] == "upstream_call"]
    assert line["level"] == "warning"
    assert line["outcome"] == "server_error"
    assert line["status"] == 503
    assert line["upstream_path"] == "/v1/orders/{id}"
    assert line["request_id"] == "req-up"
    assert "secret" not in json.dumps(line)


@pytest.mark.asyncio
async def test_upstream_call_logs_connection_failure(json_logs):
    outbound.install()
    server, port = await _serve(b"HTTP/1.1 200 OK")
    server.close()
    await server.wait_closed()
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.ConnectError):
            await client.get(f"http://127.0.0.1:{port}/health")
    [line] = [entry for entry in json_logs() if entry["event"] == "upstream_call"]
    assert line["outcome"] == "connect_error"
    assert line["error_type"] == "ConnectError"
    assert "status" not in line


@pytest.mark.asyncio
async def test_traced_job_binds_context_and_logs_failure(json_logs):
    async def job():
        structlog.get_logger().info("inside")
        raise RuntimeError("upstream down")

    with pytest.raises(RuntimeError):
        await traced_job("escrow_release", job)()
    inside, run = json_logs()
    assert inside["job"] == "escrow_release"
    assert inside["job_run_id"] == run["job_run_id"]
    assert run["event"] == "job_run"
    assert run["outcome"] == "failed"
    assert run["level"] == "error"
    assert run["error_message"] == "upstream down"
    assert structlog.contextvars.get_contextvars() == {}


def test_legacy_error_field_is_filed_as_error_message(json_logs):
    structlog.get_logger().error("mail_outbox_failed", outbox_id=1, error="[Errno 8] nodename nor servname")
    [line] = json_logs()
    assert line["error_message"] == "[Errno 8] nodename nor servname"
    assert "error" not in line


def test_log_lines_inside_a_span_carry_trace_ids(json_logs):
    from opentelemetry.sdk.trace import TracerProvider

    tracer = TracerProvider().get_tracer("test")
    with tracer.start_as_current_span("work") as span:
        structlog.get_logger().info("inside_span")
    structlog.get_logger().info("outside_span")
    inside, outside = json_logs()
    ctx = span.get_span_context()
    assert inside["trace_id"] == format(ctx.trace_id, "032x")
    assert inside["span_id"] == format(ctx.span_id, "016x")
    assert "trace_id" not in outside


def test_tracing_stays_off_without_an_endpoint(monkeypatch):
    from src.observability import tracing

    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    tracing.init_tracing(object(), object())
    assert tracing.tracing_enabled() is False


def test_business_event_is_logged_only_after_commit(json_logs):
    from sqlalchemy.orm import Session

    from src.observability import business

    business.install()
    committed, rolled_back = Session(), Session()
    business.queue_business_log(
        committed, "info", "Order 7 placed (instant)",
        {"event": "order_placed", "order_id": 7, "amount": 50000, "ip": "1.2.3.4", "resource_ids": [1, 2]},
    )
    business.queue_business_log(rolled_back, "info", "Order 8 placed", {"event": "order_placed", "order_id": 8})
    rolled_back.rollback()
    assert json_logs() == []
    committed.commit()
    [line] = json_logs()
    assert line["event"] == "order_placed"
    assert line["business"] is True
    assert line["order_id"] == 7 and line["amount"] == 50000
    assert line["audit_message"] == "Order 7 placed (instant)"
    assert "resource_ids" not in line and "ip" not in line


def test_savepoint_rollback_keeps_the_outer_transactions_business_events(json_logs):
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session

    from src.observability import business

    business.install()
    session = Session(create_engine("sqlite://"))
    session.execute(text("select 1"))
    business.queue_business_log(session, "info", "Order 9 placed", {"event": "order_placed", "order_id": 9})
    try:
        with session.begin_nested():
            business.queue_business_log(session, "info", "mail queued", {"event": "inside_savepoint"})
            raise RuntimeError("savepoint fails")
    except RuntimeError:
        pass
    session.commit()
    assert [line["event"] for line in json_logs()] == ["order_placed"]
