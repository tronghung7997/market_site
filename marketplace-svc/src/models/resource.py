import hashlib
from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, event, func, inspect
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class ResourceStatus(str, PyEnum):
    available = "available"
    assigned = "assigned"
    expired = "expired"
    error = "error"


class Resource(Base):
    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(primary_key=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id"), nullable=False)
    seller_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    status: Mapped[ResourceStatus] = mapped_column(Enum(ResourceStatus), default=ResourceStatus.available)
    data: Mapped[str] = mapped_column(Text, nullable=False)
    # sha256 of the normalised content, unique across the whole marketplace so
    # one credential can only ever be listed and sold once (see resources/dedup.py).
    data_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provider_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("providers.id"), nullable=True)
    # Immutable escrow allocation for this delivered unit. A replacement inherits
    # the original unit's cap so repeated remedies can never exceed the order hold.
    refund_amount_cap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=func.false(), nullable=False)


# --- Marketplace-wide duplicate detection -------------------------------
# `data_hash` is unique across the whole table — sold, archived and errored
# rows included — so one credential can never be listed twice (by the same
# seller or anyone else) nor re-sold after it was delivered once.
# Normalisation is deliberately minimal (line endings + surrounding
# whitespace): credentials are case-sensitive, and the SQL backfill in the
# migration must produce the same digest (`btrim(..., E' \t\r\n')`).

def normalize_resource_data(data: str) -> str:
    return data.replace("\r\n", "\n").replace("\r", "\n").strip(" \t\r\n")


def resource_data_hash(data: str) -> str:
    return hashlib.sha256(normalize_resource_data(data).encode("utf-8")).hexdigest()


def salted_resource_hash(data: str, salt: str) -> str:
    """Digest for a row allowed to coexist with an identical one (a supplier
    delivering the same line again under another order). The salt goes first
    so the plain digest of that data can never collide with it."""
    return hashlib.sha256(f"{salt}\n{normalize_resource_data(data)}".encode("utf-8")).hexdigest()


@event.listens_for(Resource, "before_insert")
def _hash_on_insert(mapper, connection, target: Resource) -> None:  # noqa: ANN001
    if not target.data_hash:
        target.data_hash = resource_data_hash(target.data)


@event.listens_for(Resource, "before_update")
def _hash_on_update(mapper, connection, target: Resource) -> None:  # noqa: ANN001
    # Editing the content (fixing a typo, restocking with a new key) re-keys the row.
    if inspect(target).attrs.data.history.has_changes():
        target.data_hash = resource_data_hash(target.data)
