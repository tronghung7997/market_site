"""OpenTelemetry traces + metrics, exported over OTLP/HTTP (OpenObserve).

Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set — then every request becomes a
trace with child spans for each SQL statement and outbound HTTP call, and the
standard HTTP server/client and DB pool metrics are pushed every 30 s.

Configured with the standard OTel environment variables:

    OTEL_EXPORTER_OTLP_ENDPOINT   e.g. http://localhost:5080/api/default
    OTEL_EXPORTER_OTLP_HEADERS    Authorization=Basic <base64 user:token>
    OTEL_TRACES_SAMPLER           parentbased_traceidratio (default here)
    OTEL_TRACES_SAMPLER_ARG       0.1 = keep 10 % of traces (default 1.0)

Log lines inside a span carry `trace_id`/`span_id` (src/logging.py), so a log
row links to its waterfall and back.
"""

from __future__ import annotations

import os
from typing import Any

import structlog
from opentelemetry import metrics, trace

logger = structlog.get_logger("tracing")

# Probes and streams: no value as traces, and long-lived SSE spans never end.
_EXCLUDED_URLS = "/health,/internal/metrics,/chat/events"

_enabled = False


def tracing_enabled() -> bool:
    return _enabled


def init_tracing(app: Any, engine: Any) -> None:
    """Install providers and instrument FastAPI, httpx and SQLAlchemy once."""
    global _enabled
    if _enabled or not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return

    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.trace.sampling import ParentBasedTraceIdRatio

    resource = Resource.create({
        "service.name": os.environ.get("SERVICE_NAME", "marketplace-svc"),
        "deployment.environment": os.environ.get("DEPLOYMENT_ENVIRONMENT", "development"),
        "service.version": os.environ.get("APP_VERSION") or os.environ.get("GIT_SHA") or "unknown",
    })

    if os.environ.get("OTEL_TRACES_SAMPLER"):
        tracer_provider = TracerProvider(resource=resource)  # SDK reads the env sampler
    else:
        ratio = float(os.environ.get("OTEL_TRACES_SAMPLER_ARG", "1.0"))
        tracer_provider = TracerProvider(resource=resource, sampler=ParentBasedTraceIdRatio(ratio))
    # Spans leave on a background thread in batches; requests never wait on export.
    tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(tracer_provider)

    reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=30_000)
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))

    FastAPIInstrumentor.instrument_app(app, excluded_urls=_EXCLUDED_URLS)
    HTTPXClientInstrumentor().instrument()
    SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine, enable_commenter=False)

    _enabled = True
    logger.info("tracing_enabled", endpoint=os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"])


def add_trace_ids(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """structlog processor: stamp the active span's ids on the log line."""
    span = trace.get_current_span()
    ctx = span.get_span_context()
    if ctx.is_valid:
        event_dict.setdefault("trace_id", format(ctx.trace_id, "032x"))
        event_dict.setdefault("span_id", format(ctx.span_id, "016x"))
    return event_dict


def shutdown_tracing() -> None:
    """Flush pending spans/metrics on shutdown."""
    if not _enabled:
        return
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        provider.shutdown()
    meter_provider = metrics.get_meter_provider()
    if hasattr(meter_provider, "shutdown"):
        meter_provider.shutdown()
