from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class UpstreamExchange(Base):
    """Request and response bodies of one HTTP call to a supplier or payment
    integration, kept so a dispute with the third party can be settled from
    what was actually sent and received (src/observability/exchanges.py).

    Bodies are Fernet-encrypted (src/security/crypto.py): a supplier response
    carries the credential handed to the buyer. Headers are never stored.
    Written on its own session from the HTTP transport, so a row survives the
    caller's transaction rolling back — the same reason order_id and
    provider_id carry no FK (see ProviderCallLog). Pruned after
    `upstream_exchange_retention_days` by purge_operational_logs.
    """

    __tablename__ = "upstream_exchanges"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    integration: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    # Templated like the `upstream_call` log (ids and key-like segments replaced).
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    # The real path (assignment UUIDs etc.), encrypted like the bodies; no query string.
    url_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    job: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Filled when the call went through a provider adapter (exchange_scope).
    provider_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    order_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    operation: Mapped[str | None] = mapped_column(String(50), nullable=True)
    request_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    response_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # A body longer than upstream_exchange_max_bytes was cut before encryption.
    truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
