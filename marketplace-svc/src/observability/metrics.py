"""Low-cardinality in-process metrics for operational export.

Labels never include raw path IDs, account IDs, order IDs, emails or request IDs.
Route templates only (e.g. /orders/{order_id}).
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Any

_lock = threading.Lock()

# Counters: key -> int
_http_requests: dict[tuple[str, str, str], int] = defaultdict(int)
_http_exceptions: int = 0
_scheduler_runs: dict[tuple[str, str], int] = defaultdict(int)
_outbound: dict[tuple[str, str], int] = defaultdict(int)

# Latency samples kept as sum + count for mean, plus coarse buckets
_http_latency_sum: dict[tuple[str, str], float] = defaultdict(float)
_http_latency_count: dict[tuple[str, str], int] = defaultdict(int)
_LATENCY_BUCKETS_MS = (50, 100, 250, 500, 1000, 2500, 5000, 10000)
_http_latency_buckets: dict[tuple[str, str, int], int] = defaultdict(int)
_KNOWN_HTTP_METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}


def _escape_label_value(value: object) -> str:
    """Escape a value for Prometheus' quoted label-string grammar."""
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _status_class(status: int) -> str:
    if status < 200:
        return "1xx"
    if status < 300:
        return "2xx"
    if status < 400:
        return "3xx"
    if status < 500:
        return "4xx"
    return "5xx"


def observe_http_request(*, method: str, route: str, status: int, duration_ms: float) -> None:
    route = route or "unknown"
    candidate_method = (method or "GET").upper()
    method = candidate_method if candidate_method in _KNOWN_HTTP_METHODS else "OTHER"
    sc = _status_class(int(status))
    key = (method, route, sc)
    lat_key = (method, route)
    with _lock:
        _http_requests[key] += 1
        _http_latency_sum[lat_key] += float(duration_ms)
        _http_latency_count[lat_key] += 1
        for boundary in _LATENCY_BUCKETS_MS:
            if duration_ms <= boundary:
                _http_latency_buckets[(method, route, boundary)] += 1
                break
        else:
            _http_latency_buckets[(method, route, _LATENCY_BUCKETS_MS[-1] + 1)] += 1


def observe_unhandled_exception() -> None:
    global _http_exceptions
    with _lock:
        _http_exceptions += 1


def observe_scheduler_job(*, job_name: str, success: bool, duration_ms: float | None = None) -> None:
    outcome = "success" if success else "failure"
    with _lock:
        _scheduler_runs[(job_name, outcome)] += 1


def observe_outbound(*, kind: str, outcome: str) -> None:
    """kind: provider|gateway; outcome: success|failure."""
    with _lock:
        _outbound[(kind, outcome)] += 1


def render_prometheus() -> str:
    """Render a Prometheus text exposition of current counters."""
    lines: list[str] = [
        "# HELP http_requests_total HTTP requests by method, route template, status class",
        "# TYPE http_requests_total counter",
    ]
    with _lock:
        for (method, route, sc), count in sorted(_http_requests.items()):
            lines.append(
                "http_requests_total{"
                f'method="{_escape_label_value(method)}",'
                f'route="{_escape_label_value(route)}",'
                f'status_class="{_escape_label_value(sc)}"'
                f"}} {count}"
            )
        lines.append("# HELP http_unhandled_exceptions_total Unhandled application exceptions")
        lines.append("# TYPE http_unhandled_exceptions_total counter")
        lines.append(f"http_unhandled_exceptions_total {_http_exceptions}")

        lines.append("# HELP http_request_duration_ms_sum Request latency sum in milliseconds")
        lines.append("# TYPE http_request_duration_ms_sum counter")
        for (method, route), total in sorted(_http_latency_sum.items()):
            lines.append(
                "http_request_duration_ms_sum{"
                f'method="{_escape_label_value(method)}",'
                f'route="{_escape_label_value(route)}"'
                f"}} {total:.3f}"
            )
        lines.append("# HELP http_request_duration_ms_count Request latency sample count")
        lines.append("# TYPE http_request_duration_ms_count counter")
        for (method, route), count in sorted(_http_latency_count.items()):
            lines.append(
                "http_request_duration_ms_count{"
                f'method="{_escape_label_value(method)}",'
                f'route="{_escape_label_value(route)}"'
                f"}} {count}"
            )

        lines.append("# HELP scheduler_job_runs_total Scheduler job outcomes")
        lines.append("# TYPE scheduler_job_runs_total counter")
        for (name, outcome), count in sorted(_scheduler_runs.items()):
            lines.append(
                "scheduler_job_runs_total{"
                f'job="{_escape_label_value(name)}",'
                f'outcome="{_escape_label_value(outcome)}"'
                f"}} {count}"
            )

        lines.append("# HELP outbound_calls_total Outbound provider/gateway attempts")
        lines.append("# TYPE outbound_calls_total counter")
        for (kind, outcome), count in sorted(_outbound.items()):
            lines.append(
                "outbound_calls_total{"
                f'kind="{_escape_label_value(kind)}",'
                f'outcome="{_escape_label_value(outcome)}"'
                f"}} {count}"
            )

    lines.append("")
    return "\n".join(lines)


def snapshot() -> dict[str, Any]:
    with _lock:
        return {
            "http_requests": dict(_http_requests),
            "http_exceptions": _http_exceptions,
            "scheduler_runs": dict(_scheduler_runs),
            "outbound": dict(_outbound),
        }
