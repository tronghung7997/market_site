import structlog

from src.database import SessionLocal
from src.models.provider import ProviderCallLog

logger = structlog.get_logger()

_ERROR_MAX_LEN = 500


async def record_provider_call(
    *,
    provider_id: int | None,
    operation: str,
    method: str,
    path: str,
    attempt: int,
    latency_ms: int,
    success: bool,
    order_id: int | None = None,
    status_code: int | None = None,
    error: str | None = None,
    idempotency_key: str | None = None,
) -> None:
    """Persist one provider HTTP attempt on its own session.

    Independent of the caller's transaction so the row survives a rollback —
    a provision failure rolls the order back, and that is exactly the case worth
    keeping a trace of.

    provider_id is None when an adapter was built outside the factory (direct
    construction in tests); nothing to attribute the call to, so skip.

    Never raises: logging must not be what breaks a provider call.
    """
    if provider_id is None:
        return

    if error is not None and len(error) > _ERROR_MAX_LEN:
        error = error[:_ERROR_MAX_LEN]

    try:
        async with SessionLocal() as session:
            session.add(
                ProviderCallLog(
                    provider_id=provider_id,
                    order_id=order_id,
                    operation=operation,
                    method=method,
                    path=path,
                    attempt=attempt,
                    status_code=status_code,
                    latency_ms=latency_ms,
                    success=success,
                    error=error,
                    idempotency_key=idempotency_key,
                )
            )
            await session.commit()
    except Exception as e:
        logger.warning(
            "provider_call_log_failed",
            provider_id=provider_id,
            operation=operation,
            error=str(e),
        )
