"""Structured JSON logs on stdout, shipped to OpenObserve by a collector.

One JSON object per line. Canonical fields (when present):

    timestamp, level, event, service, env, version, logger,
    request_id, method, route, status, duration_ms, account_id, error_code,
    job, job_run_id, integration, upstream_host, upstream_path, outcome,
    error_type, error_message, error_where, error_stack

`error_where` is the innermost frame inside this codebase (`src/...:line in
func`), so a reader — human or model — sees where it broke without reading the
whole stack. Stdlib loggers (uvicorn, sqlalchemy, third-party SDKs) are routed
through the same pipeline so every stdout line is JSON.

Business facts stay in `log_entries`; this stream is for operations.
"""

import logging
import os
import re
import sys
import traceback
import uuid
from typing import Any, TextIO

import structlog

from src.observability.tracing import add_trace_ids

_SECRET_KEY_RE = re.compile(
    r"pass(word)?|secret|token|api[_-]?key|authorization|cookie|signature|private[_-]?key|otp|totp|mnemonic",
    re.IGNORECASE,
)
# Booleans and counters about a secret are useful and harmless.
_SAFE_KEY_RE = re.compile(
    r"^(is|has|requires)_|_(valid|tokens|count|enabled|present|configured|ok|kind|type)$",
    re.IGNORECASE,
)
_REDACTED = "[REDACTED]"
_MAX_VALUE_CHARS = 2000
_MAX_STACK_CHARS = 8000
# Third-party bodies on `upstream_call` (src/observability/exchanges.py) are
# shipped whole on purpose, already capped by upstream_exchange_log_max_chars.
_BODY_KEYS = frozenset({"request_body", "response_body"})
# Frames under this directory are "ours"; everything else is a library.
_SRC_DIR = os.path.dirname(os.path.abspath(__file__)) + os.sep
_SRC_ROOT = os.path.dirname(_SRC_DIR.rstrip(os.sep)) + os.sep
# Plumbing every request passes through; never the place something broke.
_PLUMBING = tuple(
    _SRC_DIR + name for name in ("middleware.py", "logging.py", "observability" + os.sep, "security" + os.sep + "body_limit.py")
)

# Access logs duplicate our `http_request` event; SQL echo and per-request
# client chatter are noise (httpx logs full URLs, which can carry keys).
_QUIET_LOGGERS = {
    "uvicorn.access": logging.WARNING,
    "httpx": logging.WARNING,
    "httpcore": logging.WARNING,
    "sqlalchemy.engine": logging.WARNING,
    "apscheduler": logging.WARNING,
    "asyncio": logging.WARNING,
}


def _level_from_env() -> int:
    name = os.environ.get("LOG_LEVEL", "INFO").upper()
    return logging.getLevelNamesMapping().get(name, logging.INFO)


def _static_fields() -> dict[str, str]:
    fields = {"service": os.environ.get("SERVICE_NAME", "marketplace-svc")}
    env = os.environ.get("DEPLOYMENT_ENVIRONMENT")
    if env:
        fields["env"] = env
    version = os.environ.get("APP_VERSION") or os.environ.get("GIT_SHA")
    if version:
        fields["version"] = version
    return fields


def _add_static_fields(fields: dict[str, str]):
    def processor(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
        for key, value in fields.items():
            event_dict.setdefault(key, value)
        return event_dict

    return processor


def _where(tb: Any) -> str | None:
    """Innermost frame in this codebase as `src/x.py:12 in fn`."""
    ours = None
    for frame in traceback.extract_tb(tb):
        if frame.filename.startswith(_SRC_DIR) and not frame.filename.startswith(_PLUMBING):
            ours = frame
    if ours is None:
        return None
    return f"{os.path.relpath(ours.filename, _SRC_ROOT)}:{ours.lineno} in {ours.name}"


def exception_fields(exc: BaseException) -> dict[str, Any]:
    """Flat, searchable error fields for one exception (and its cause)."""
    fields: dict[str, Any] = {
        "error_type": type(exc).__name__,
        "error_message": str(exc)[:_MAX_VALUE_CHARS],
    }
    where = _where(exc.__traceback__)
    if where:
        fields["error_where"] = where
    cause = exc.__cause__ or exc.__context__
    if cause is not None and not exc.__suppress_context__:
        fields["error_cause"] = f"{type(cause).__name__}: {str(cause)[:500]}"
    stack = "".join(traceback.format_exception(exc))
    if len(stack) > _MAX_STACK_CHARS:
        # Keep the tail: the raising frame and the message are at the end.
        stack = "…" + stack[-_MAX_STACK_CHARS:]
    fields["error_stack"] = stack
    return fields


def _legacy_error_processor(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """Older call sites log `error=str(e)`; file it under `error_message` so
    every failure is found in one column."""
    legacy = event_dict.get("error")
    if isinstance(legacy, str) and "error_message" not in event_dict:
        event_dict["error_message"] = event_dict.pop("error")
    return event_dict


def _exception_processor(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    exc_info = event_dict.pop("exc_info", None)
    if not exc_info:
        return event_dict
    if isinstance(exc_info, BaseException):
        exc = exc_info
    elif isinstance(exc_info, tuple):
        exc = exc_info[1]
    else:
        exc = sys.exc_info()[1]
    if exc is not None:
        for key, value in exception_fields(exc).items():
            event_dict.setdefault(key, value)
    return event_dict


def _is_secret_key(key: Any) -> bool:
    return isinstance(key, str) and bool(_SECRET_KEY_RE.search(key)) and not _SAFE_KEY_RE.search(key)


def _scrub(value: Any, depth: int = 0) -> Any:
    if isinstance(value, str):
        if len(value) > _MAX_VALUE_CHARS:
            return value[:_MAX_VALUE_CHARS] + "…"
        return value
    if depth >= 3:
        return value
    if isinstance(value, dict):
        return {
            key: (_REDACTED if _is_secret_key(key) else _scrub(item, depth + 1))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_scrub(item, depth + 1) for item in value]
    return value


def _redact_processor(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    """Blank secret-named keys and bound oversized values.

    A safety net, not a licence: never pass credentials or payloads to a logger.
    """
    for key in list(event_dict):
        if key == "error_stack" or (key in _BODY_KEYS and isinstance(event_dict[key], str)):
            continue
        if _is_secret_key(key):
            event_dict[key] = _REDACTED
        else:
            event_dict[key] = _scrub(event_dict[key])
    return event_dict


class _DropDuplicateAsgiErrors(logging.Filter):
    """uvicorn re-logs every unhandled exception; the `http_request` error
    event (middleware.RequestIdMiddleware) already has it with request_id."""

    def filter(self, record: logging.LogRecord) -> bool:
        return not (record.name == "uvicorn.error" and record.getMessage() == "Exception in ASGI application")


def _drop_stdlib_noise(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    event_dict.pop("_record", None)
    event_dict.pop("_from_structlog", None)
    event_dict.pop("color_message", None)  # uvicorn duplicate of `event`
    return event_dict


class _StdoutHandler(logging.StreamHandler):
    """Writes to whatever sys.stdout is at emit time (test capture swaps it)."""

    def __init__(self, stream: TextIO | None = None) -> None:
        super().__init__(stream)
        self._fixed_stream = stream

    @property
    def stream(self) -> TextIO:  # type: ignore[override]
        return self._fixed_stream or sys.stdout

    @stream.setter
    def stream(self, value: TextIO | None) -> None:
        self._fixed_stream = value


def setup_logging(stream: TextIO | None = None) -> None:
    """Configure structlog and the stdlib root logger to emit the same JSON."""
    level = _level_from_env()
    shared: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", key="timestamp"),
        _add_static_fields(_static_fields()),
        add_trace_ids,
    ]
    tail: list[Any] = [
        _exception_processor,
        _legacy_error_processor,
        _redact_processor,
        structlog.processors.EventRenamer("event"),
    ]
    if os.environ.get("LOG_FORMAT", "json").lower() == "console":
        renderer: Any = structlog.dev.ConsoleRenderer()
    else:
        renderer = structlog.processors.JSONRenderer(ensure_ascii=False)

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *shared,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared,
        processors=[_drop_stdlib_noise, *tail, renderer],
    )
    handler = _StdoutHandler(stream)
    handler.setFormatter(formatter)
    handler.addFilter(_DropDuplicateAsgiErrors())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # uvicorn installs its own handlers before importing the app; send its
    # records through ours instead so they are JSON too.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uv = logging.getLogger(name)
        uv.handlers = []
        uv.propagate = True
    for name, quiet in _QUIET_LOGGERS.items():
        logging.getLogger(name).setLevel(max(quiet, level))


def generate_request_id() -> str:
    """Canonical UUID request id (36 chars, fits log_entries.request_id)."""
    return str(uuid.uuid4())


def current_request_id() -> str | None:
    return structlog.contextvars.get_contextvars().get("request_id")
