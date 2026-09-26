"""media_objects + media_blobs: uploaded images

Metadata lives in `media_objects`; bytes live in `media_blobs` only while an
object's `storage` is `db`. Moving to S3/R2 later is `scripts/media_migrate.py`
plus env, no schema change. `media_blobs.data` uses STORAGE EXTERNAL because
WebP is already compressed, so TOAST should not spend CPU trying pglz.

Revision ID: gf1a2b3c4d5e6
Revises: ge1a2b3c4d5e6
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "gf1a2b3c4d5e6"
down_revision = "ge1a2b3c4d5e6"
branch_labels = None
depends_on = None

PURPOSES = (
    "product_image", "category_image", "seller_logo", "seller_banner", "avatar",
    "chat_attachment", "dispute_evidence", "payout_receipt",
)
STATUSES = ("pending", "attached", "detached", "removed")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "media_objects",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("public_id", sa.String(24), nullable=False, unique=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("visibility", sa.String(8), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("storage", sa.String(8), nullable=False),
        sa.Column("key_prefix", sa.String(160), nullable=False, unique=True),
        sa.Column("variants", postgresql.JSONB(), nullable=False),
        sa.Column("bytes_total", sa.Integer(), nullable=False),
        sa.Column("subject_type", sa.String(24), nullable=True),
        sa.Column("subject_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("attached_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("detached_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("removed_reason", sa.String(300), nullable=True),
        sa.CheckConstraint(_in("purpose", PURPOSES), name="ck_media_objects_purpose"),
        sa.CheckConstraint(_in("status", STATUSES), name="ck_media_objects_status"),
        sa.CheckConstraint("visibility IN ('public', 'private')", name="ck_media_objects_visibility"),
        sa.CheckConstraint("storage IN ('db', 's3')", name="ck_media_objects_storage"),
        sa.CheckConstraint("(subject_type IS NULL) = (subject_id IS NULL)", name="ck_media_objects_subject_pair"),
    )
    op.create_index("ix_media_objects_status_created", "media_objects", ["status", "created_at"])
    op.create_index("ix_media_objects_subject", "media_objects", ["subject_type", "subject_id"])
    op.create_index("ix_media_objects_owner_created", "media_objects", ["owner_id", "created_at"])
    op.create_index("ix_media_objects_purpose_created", "media_objects", ["purpose", "created_at"])

    op.create_table(
        "media_blobs",
        sa.Column("key", sa.String(200), primary_key=True),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute("ALTER TABLE media_blobs ALTER COLUMN data SET STORAGE EXTERNAL")


def downgrade() -> None:
    op.drop_table("media_blobs")
    op.drop_index("ix_media_objects_purpose_created", table_name="media_objects")
    op.drop_index("ix_media_objects_owner_created", table_name="media_objects")
    op.drop_index("ix_media_objects_subject", table_name="media_objects")
    op.drop_index("ix_media_objects_status_created", table_name="media_objects")
    op.drop_table("media_objects")
