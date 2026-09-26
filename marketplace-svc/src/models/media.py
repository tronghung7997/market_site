"""Uploaded images. Metadata and bytes live in separate tables so no listing
query ever touches image data; ``media_blobs`` is used only while an object's
``storage`` is ``db`` — once it is moved to S3/R2 its blob rows are deleted.

Objects are immutable: an edit uploads a new object. Keys therefore never
change and public ones can be cached for a year (see docs/media-storage.md).
"""

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, Index, Integer, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.database import Base


class MediaPurpose(str, PyEnum):
    product_image = "product_image"
    category_image = "category_image"
    seller_logo = "seller_logo"
    seller_banner = "seller_banner"
    avatar = "avatar"
    chat_attachment = "chat_attachment"
    dispute_evidence = "dispute_evidence"
    payout_receipt = "payout_receipt"


PUBLIC_PURPOSES = frozenset({
    MediaPurpose.product_image, MediaPurpose.category_image, MediaPurpose.seller_logo,
    MediaPurpose.seller_banner, MediaPurpose.avatar,
})


class MediaStatus(str, PyEnum):
    # Uploaded, not referenced yet; garbage-collected after a day.
    pending = "pending"
    attached = "attached"
    # No longer referenced; bytes are kept for a grace period (open pages, caches).
    detached = "detached"
    # Taken down by an admin; bytes already deleted.
    removed = "removed"


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v.value) for v in values)})"


class MediaObject(Base):
    __tablename__ = "media_objects"
    __table_args__ = (
        CheckConstraint(_in("purpose", MediaPurpose), name="ck_media_objects_purpose"),
        CheckConstraint(_in("status", MediaStatus), name="ck_media_objects_status"),
        CheckConstraint("visibility IN ('public', 'private')", name="ck_media_objects_visibility"),
        CheckConstraint("storage IN ('db', 's3')", name="ck_media_objects_storage"),
        CheckConstraint(
            "(subject_type IS NULL) = (subject_id IS NULL)", name="ck_media_objects_subject_pair"
        ),
        Index("ix_media_objects_status_created", "status", "created_at"),
        Index("ix_media_objects_subject", "subject_type", "subject_id"),
        Index("ix_media_objects_owner_created", "owner_id", "created_at"),
        Index("ix_media_objects_purpose_created", "purpose", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # Random, unguessable id used in URLs and payloads (never the row id).
    public_id: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    visibility: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default=MediaStatus.pending.value)
    # Where the bytes currently are. Reads follow this, not the MEDIA_STORAGE setting.
    storage: Mapped[str] = mapped_column(String(8), nullable=False)
    # Object key without the variant suffix: pub|prv/<purpose>/<yyyy>/<mm>/<public_id>
    key_prefix: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    # {"full": {"w", "h", "bytes", "sha256"}, "thumb": {...}} — every variant is image/webp.
    variants: Mapped[dict] = mapped_column(JSONB, nullable=False)
    bytes_total: Mapped[int] = mapped_column(Integer, nullable=False)
    # What the image belongs to once attached ("product", "chat_message", ...).
    subject_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    subject_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    attached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    detached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    removed_by_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    removed_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)


class MediaBlob(Base):
    """Image bytes for objects stored in Postgres (``storage='db'``). The column
    uses STORAGE EXTERNAL: WebP is already compressed, so TOAST skips pglz."""

    __tablename__ = "media_blobs"

    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
