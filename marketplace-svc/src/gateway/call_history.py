from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import SessionLocal
from src.models.usage import GatewayCallLog

logger = structlog.get_logger()

# Response bodies can be large (TikTok/YouTube profile payloads run tens of
# KB) — this is a "what did I get" preview for the history list, not a
# durable copy. Same capping idea as ProviderCallLog's error truncation.
_RESPONSE_SNIPPET_MAX_LEN = 4000
_ERROR_MAX_LEN = 500
_REQUEST_PREVIEW_MAX_BYTES = 8 * 1024
_MAX_DEPTH = 6
_MAX_COLLECTION_LEN = 50
_MAX_STRING_LEN = 500
_REDACTED = "[REDACTED]"
_TRUNCATED_MARKER = "…(cắt bớt)"

# Match sensitive key names case-insensitively after normalizing separators.
_SENSITIVE_KEY_RE = re.compile(
    r"(password|token|secret|api[_-]?key|authorization|cookie|checksum|"
    r"private[_-]?key|gateway[_-]?key|client[_-]?secret|access[_-]?key|"
    r"delivered[_-]?data)",
    re.IGNORECASE,
)


def _normalize_key(key: Any) -> str:
    return re.sub(r"[\s-]+", "_", str(key)).lower()


def _is_sensitive_key(key: Any) -> bool:
    return bool(_SENSITIVE_KEY_RE.search(_normalize_key(key)))


def sanitize_for_history(value: Any, *, depth: int = 0) -> Any:
    """Recursively redact secrets and bound nested structures for storage.

    Does not mutate the input. Used for gateway request/response previews
    so buyer-supplied tokens and oversized payloads never land in history.
    """
    if depth >= _MAX_DEPTH:
        return {"_truncated": True, "_reason": "max_depth"}

    if isinstance(value, dict):
        out: dict[str, Any] = {}
        items = list(value.items())
        truncated = len(items) > _MAX_COLLECTION_LEN
        for key, item in items[:_MAX_COLLECTION_LEN]:
            if _is_sensitive_key(key):
                out[str(key)] = _REDACTED
            else:
                out[str(key)] = sanitize_for_history(item, depth=depth + 1)
        if truncated:
            out["_truncated"] = True
        return out

    if isinstance(value, (list, tuple)):
        items = list(value)
        truncated = len(items) > _MAX_COLLECTION_LEN
        out_list = [sanitize_for_history(item, depth=depth + 1) for item in items[:_MAX_COLLECTION_LEN]]
        if truncated:
            out_list.append({"_truncated": True})
        return out_list

    if isinstance(value, str):
        if len(value) > _MAX_STRING_LEN:
            return value[:_MAX_STRING_LEN] + _TRUNCATED_MARKER
        return value

    if isinstance(value, (int, float, bool)) or value is None:
        return value

    # Fallback for unexpected types (bytes, custom objects).
    text = str(value)
    if len(text) > _MAX_STRING_LEN:
        return text[:_MAX_STRING_LEN] + _TRUNCATED_MARKER
    return text


def bound_request_preview(payload: dict | None) -> dict | None:
    """Serialize-bound the request preview to 8 KiB of valid JSON."""
    if payload is None:
        return None
    sanitized = sanitize_for_history(payload)
    try:
        encoded = json.dumps(sanitized, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return {"_truncated": True, "_reason": "unserializable"}

    if len(encoded.encode("utf-8")) <= _REQUEST_PREVIEW_MAX_BYTES:
        return sanitized

    # Drop body first, then shrink to a marker-only object.
    if isinstance(sanitized, dict) and "body" in sanitized:
        slim = {k: v for k, v in sanitized.items() if k != "body"}
        slim["_truncated"] = True
        slim["_reason"] = "request_preview_max_bytes"
        try:
            if len(json.dumps(slim, ensure_ascii=False, default=str).encode("utf-8")) <= _REQUEST_PREVIEW_MAX_BYTES:
                return slim
        except (TypeError, ValueError):
            pass

    return {"_truncated": True, "_reason": "request_preview_max_bytes"}


def sanitize_error_text(error: str | None) -> str | None:
    if error is None:
        return None
    # Avoid persisting accidental secret material from exception strings.
    text = re.sub(
        r"(?i)(authorization|api[_-]?key|token|password|secret|checksum)\s*[:=]\s*\S+",
        r"\1=[REDACTED]",
        error,
    )
    if len(text) > _ERROR_MAX_LEN:
        text = text[:_ERROR_MAX_LEN] + _TRUNCATED_MARKER
    return text


def sanitize_response_snippet(response_body: bytes | None) -> str | None:
    if not response_body:
        return None
    try:
        decoded = response_body.decode("utf-8", errors="replace")
    except Exception:
        return None

    snippet: str
    try:
        parsed = json.loads(decoded)
        snippet = json.dumps(sanitize_for_history(parsed), ensure_ascii=False, default=str)
    except (ValueError, TypeError):
        # Opaque text cannot be reliably classified/redacted. Keep metadata,
        # not content, rather than risk persisting a credential or PII blob.
        snippet = "[non-JSON response omitted]"

    if len(snippet) > _RESPONSE_SNIPPET_MAX_LEN:
        snippet = snippet[:_RESPONSE_SNIPPET_MAX_LEN] + _TRUNCATED_MARKER
    return snippet


async def record_gateway_call_log(
    *,
    order_id: int,
    endpoint: str,
    latency_ms: int,
    status_code: int | None = None,
    request_payload: dict | None = None,
    response_body: bytes | None = None,
    error: str | None = None,
) -> None:
    """Persist one buyer-facing gateway call on its own session — mirrors
    adapters/call_log.py::record_provider_call. Never raises: a history
    write must not be what breaks a real gateway call.

    Buyer-supplied query/body can contain tokens or PII — always sanitize
    and bound before persistence. This is a short-TTL convenience log, not
    a durable audit of raw payloads.
    """
    # Copy so caller-owned dicts are never mutated by redaction.
    request_preview = bound_request_preview(
        copy.deepcopy(request_payload) if request_payload is not None else None
    )
    response_snippet = sanitize_response_snippet(response_body)
    error_text = sanitize_error_text(error)

    try:
        async with SessionLocal() as session:
            session.add(
                GatewayCallLog(
                    order_id=order_id,
                    endpoint=endpoint,
                    status_code=status_code,
                    latency_ms=latency_ms,
                    request_payload=request_preview,
                    response_snippet=response_snippet,
                    error=error_text,
                )
            )
            await session.commit()
    except Exception as e:
        logger.warning(
            "gateway_call_log_failed", order_id=order_id, endpoint=endpoint, error=str(e),
        )


async def list_gateway_call_logs(
    order_id: int,
    db: AsyncSession,
    *,
    endpoint: str | None = None,
    status_code: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[GatewayCallLog]:
    query = select(GatewayCallLog).where(GatewayCallLog.order_id == order_id)
    if endpoint:
        query = query.where(GatewayCallLog.endpoint == endpoint)
    if status_code is not None:
        query = query.where(GatewayCallLog.status_code == status_code)
    query = query.order_by(GatewayCallLog.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def purge_old_gateway_call_logs() -> int:
    """Delete rows older than settings.gateway_call_log_retention_days.

    Safe to run on any schedule — this table is a recent-only convenience
    log, never the source of truth for billing/quota (that's usage_records,
    untouched here). Returns the number of rows deleted, for the job log.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.gateway_call_log_retention_days)
    async with SessionLocal() as db:
        result = await db.execute(delete(GatewayCallLog).where(GatewayCallLog.created_at < cutoff))
        await db.commit()
        return result.rowcount or 0
