"""Security telemetry (channel S) — structured logs only, never DB.

Auth rejection and similar signals must survive request rollback and must not
create an unbounded synchronous write path on every failed login.
"""
from __future__ import annotations

import hashlib
import hmac

import structlog

from src.config import settings
from src.logging import current_request_id

logger = structlog.get_logger()


def principal_fingerprint(identifier: str) -> str:
    """Keyed HMAC of a normalized login principal (email).

    Plain SHA-256 is dictionary-attackable for common addresses; HMAC with a
    dedicated secret is not reversible without that secret.
    """
    normalized = identifier.strip().casefold().encode("utf-8")
    digest = hmac.new(
        settings.principal_hmac_secret.encode("utf-8"),
        normalized,
        hashlib.sha256,
    ).hexdigest()
    return digest[:32]


def security_event(event: str, *, level: str = "warning", **fields) -> None:
    """Emit one structured security telemetry event to stdout.

    Never accepts or logs password, raw email, full API keys, cookies, or
    authorization headers. Callers must pre-fingerprint principals.
    """
    blocked = {"password", "email", "token", "api_key", "authorization", "cookie", "raw_key"}
    safe = {k: v for k, v in fields.items() if k.lower() not in blocked and v is not None}
    if "request_id" not in safe:
        rid = current_request_id()
        if rid:
            safe["request_id"] = rid
    log = getattr(logger, level, logger.warning)
    log(event, **safe)
