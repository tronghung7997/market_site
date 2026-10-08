"""Admin read side of `upstream_exchanges` (src/observability/exchanges.py).

The list carries metadata only; one row's bodies are decrypted on request and
every such view is audited, like a seller revealing stock.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.audit.service import log_event
from src.logging import current_request_id
from src.models.upstream_exchange import UpstreamExchange
from src.security.crypto import decrypt_str


async def list_exchanges(
    db: AsyncSession, *, integration: str | None = None, order_id: int | None = None,
    provider_id: int | None = None, request_id: str | None = None, failed_only: bool = False,
    before_id: int | None = None, limit: int = 50,
) -> list[UpstreamExchange]:
    stmt = select(UpstreamExchange)
    if integration:
        stmt = stmt.where(UpstreamExchange.integration == integration)
    if order_id is not None:
        stmt = stmt.where(UpstreamExchange.order_id == order_id)
    if provider_id is not None:
        stmt = stmt.where(UpstreamExchange.provider_id == provider_id)
    if request_id:
        stmt = stmt.where(UpstreamExchange.request_id == request_id)
    if failed_only:
        stmt = stmt.where(UpstreamExchange.outcome != "ok")
    if before_id is not None:
        stmt = stmt.where(UpstreamExchange.id < before_id)
    stmt = stmt.order_by(UpstreamExchange.id.desc()).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


def _decrypt(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return decrypt_str(value)
    except Exception:  # noqa: BLE001 — wrong/rotated key: say so instead of a 500
        return "<không giải mã được — ENCRYPTION_KEY đã đổi?>"


async def reveal_exchange(db: AsyncSession, exchange_id: int, *, actor_id: int) -> tuple[UpstreamExchange, dict]:
    row = await db.get(UpstreamExchange, exchange_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy bản ghi")
    bodies = {
        "url_path": _decrypt(row.url_path),
        "request_body": _decrypt(row.request_body),
        "response_body": _decrypt(row.response_body),
    }
    await log_event(
        db, "info", f"Admin viewed upstream exchange #{exchange_id}",
        request_id=current_request_id(),
        metadata={
            "event": "upstream_exchange_viewed", "actor_id": actor_id,
            "subject_type": "upstream_exchange", "subject_id": exchange_id,
            "integration": row.integration, "order_id": row.order_id,
        },
    )
    await db.commit()
    return row, bodies
