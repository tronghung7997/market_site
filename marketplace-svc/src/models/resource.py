from datetime import datetime
from enum import Enum as PyEnum

from cryptography.fernet import InvalidToken
from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Text, and_, event, func, inspect, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from src.database import Base
from src.security.crypto import FERNET_PREFIX, decrypt_str, encrypt_str, keyed_digest


class EncryptedText(TypeDecorator):
    """Stock content encrypted at rest (Fernet under ENCRYPTION_KEY). Reads
    decrypt transparently; a value that is not a Fernet token is returned as-is
    so rows written before the backfill migration stay readable.

    Ciphertext is randomised: never filter or compare on this column in SQL —
    use `data_hash` (duplicates) or `data_lookup` (exact search)."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):  # noqa: ANN001, ARG002
        return None if value is None else encrypt_str(value)

    def process_result_value(self, value, dialect):  # noqa: ANN001, ARG002
        return read_stored_text(value)


def read_stored_text(value: str | None) -> str | None:
    """Plaintext of a stored `EncryptedText` value (raw column read). Values
    written before the encryption backfill are not Fernet tokens and pass
    through unchanged."""
    if value is None or not value.startswith(FERNET_PREFIX):
        return value
    try:
        return decrypt_str(value)
    except InvalidToken:
        return value


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
    # Up to 200 000 chars, decrypted on load: never loaded with the row. Select it
    # explicitly (undefer / select(Resource.data)) only where the line is used.
    data: Mapped[str] = mapped_column(EncryptedText, nullable=False, deferred=True, deferred_raiseload=True)
    # Keyed HMAC of the normalised content, unique per seller (see
    # `__table_args__`): a shop can list and sell one credential only once.
    data_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Keyed HMAC of the first `|` field (username / UID / whole licence key),
    # case-folded: exact-match search now that the content itself is encrypted.
    data_lookup: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # Derived on every write (see `line_summary`) so lists, previews and field
    # counts never decrypt a whole line: its first LINE_HEAD_CHARS characters
    # (encrypted like `data`, it can hold a password), its length in
    # characters and its `|`-field count. NULL only on rows the gv migration
    # has not reached; readers fall back to `data` for those.
    data_head: Mapped[str | None] = mapped_column(EncryptedText, nullable=True, deferred=True, deferred_raiseload=True)
    data_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    field_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provider_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("providers.id"), nullable=True)
    # Immutable escrow allocation for this delivered unit. A replacement inherits
    # the original unit's cap so repeated remedies can never exceed the order hold.
    refund_amount_cap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=func.false(), nullable=False)
    # Upload this line came in with (its format + login notes). NULL for stock
    # uploaded before batches existed: shown as it is until given a format.
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("stock_batches.id"), nullable=True)

    __table_args__ = (
        Index("uq_resources_seller_data_hash", "seller_id", "data_hash", unique=True),
        # Exact-content search (seller, dispute and admin lookups) by digest alone.
        Index("ix_resources_data_hash", "data_hash"),
        Index("ix_resources_batch_id", "batch_id"),
        # resource_expire_job: due rows of one status, earliest expiry first.
        # Only rows with an expiry (time-boxed proxies); `expires_at <= $1`
        # implies the predicate, so a generic plan can use it too.
        Index(
            "ix_resources_status_expires_at", "status", "expires_at", "id",
            postgresql_where=text("expires_at IS NOT NULL"),
        ),
    )


# --- Seller-facing status ------------------------------------------------
# `error` is split by whether the line was delivered. A line the seller
# flagged before selling is a stock error ("error"); a delivered line swapped
# or refunded in a dispute keeps its order and is a buyer return ("returned").
# Returns can never go back on sale (restock/edit refuse a line with an order).
SELLER_RESOURCE_STATUSES = ("available", "assigned", "error", "returned", "expired")


def is_returned_sql():
    return and_(Resource.status == ResourceStatus.error, Resource.order_id.is_not(None))


def is_stock_error_sql():
    return and_(Resource.status == ResourceStatus.error, Resource.order_id.is_(None))


def seller_status_clause(value: str):
    """SQL condition for one of SELLER_RESOURCE_STATUSES."""
    if value == "returned":
        return is_returned_sql()
    if value == "error":
        return is_stock_error_sql()
    return Resource.status == ResourceStatus(value)


def seller_status_of(status: ResourceStatus, order_id: int | None) -> str:
    if status == ResourceStatus.error and order_id is not None:
        return "returned"
    return status.value


# --- Per-seller duplicate detection -------------------------------------
# `(seller_id, data_hash)` is unique — sold, archived and errored rows
# included — so a shop can never list one credential twice nor re-sell it
# after it was delivered once. Different shops may hold the same content:
# checking across shops would refuse an honest seller and tell them that
# somebody else holds that credential.
# Normalisation is deliberately minimal (line endings + surrounding
# whitespace): credentials are case-sensitive. Digests are HMACs under a
# subkey of ENCRYPTION_KEY, so rotating that key re-keys every row
# (scripts/rotate_encryption_key.py does it).

HASH_PURPOSE = "resource-data-hash"
LOOKUP_PURPOSE = "resource-lookup"


LINE_HEAD_CHARS = 240


def line_summary(data: str) -> tuple[str, int, int]:
    """(`data_head`, `data_length`, `field_count`) of a stock line."""
    return data[:LINE_HEAD_CHARS], len(data), data.count("|") + 1


def normalize_resource_data(data: str) -> str:
    return data.replace("\r\n", "\n").replace("\r", "\n").strip(" \t\r\n")


def resource_data_hash(data: str, *, secret: str | None = None) -> str:
    return keyed_digest(HASH_PURPOSE, normalize_resource_data(data), secret=secret)


def salted_resource_hash(data: str, salt: str) -> str:
    """Digest for a row allowed to coexist with an identical one (a supplier
    delivering the same line again under another order). The salt goes first
    so the plain digest of that data can never collide with it."""
    return keyed_digest(HASH_PURPOSE, f"{salt}\n{normalize_resource_data(data)}")


def resource_lookup_term(term: str) -> str:
    return term.strip().casefold()


def resource_lookup_key(data: str, *, secret: str | None = None) -> str | None:
    """Search key of a stock line: its first `|` field. None when empty."""
    first = resource_lookup_term(normalize_resource_data(data).split("|", 1)[0])
    return keyed_digest(LOOKUP_PURPOSE, first, secret=secret) if first else None


def resource_search_key(term: str) -> str | None:
    """Digest to compare with `data_lookup` for what a seller typed."""
    normalized = resource_lookup_term(term)
    return keyed_digest(LOOKUP_PURPOSE, normalized) if normalized else None


@event.listens_for(Resource, "before_insert")
def _hash_on_insert(mapper, connection, target: Resource) -> None:  # noqa: ANN001
    if not target.data_hash:
        target.data_hash = resource_data_hash(target.data)
    target.data_lookup = resource_lookup_key(target.data)
    target.data_head, target.data_length, target.field_count = line_summary(target.data)


@event.listens_for(Resource, "before_update")
def _hash_on_update(mapper, connection, target: Resource) -> None:  # noqa: ANN001
    # Editing the content (fixing a typo, restocking with a new key) re-keys the row.
    if inspect(target).attrs.data.history.has_changes():
        target.data_hash = resource_data_hash(target.data)
        target.data_lookup = resource_lookup_key(target.data)
        target.data_head, target.data_length, target.field_count = line_summary(target.data)
