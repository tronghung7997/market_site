import uuid

import structlog


def setup_logging() -> None:
    """Configure structured JSON logs for stdout shipping.

    Canonical production fields (when present): timestamp, level, event,
    service, request_id/job_id, route, status, duration_ms. Auth outcomes use
    separate security events; business facts use log_entries.
    """
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", key="timestamp"),
            structlog.processors.EventRenamer("event"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(0),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def generate_request_id() -> str:
    """Canonical UUID request id (36 chars, fits log_entries.request_id)."""
    return str(uuid.uuid4())


def current_request_id() -> str | None:
    return structlog.contextvars.get_contextvars().get("request_id")
