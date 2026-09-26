"""Media admin: tier badges and the upload size setting

- seller_tier_config.badge: icon an admin uploads for a seller tier (shown
  next to the seller name); purpose ``tier_badge``;
- site_runtime_config.media_max_upload_mb: admin-editable upload cap
  (Settings › System), bounded by env MEDIA_MAX_UPLOAD_BYTES.

Revision ID: gi1a2b3c4d5e6
Revises: gh1a2b3c4d5e6
Create Date: 2026-09-26
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "gi1a2b3c4d5e6"
down_revision = "gh1a2b3c4d5e6"
branch_labels = None
depends_on = None

OLD_PURPOSES = (
    "product_image", "category_image", "seller_logo", "seller_banner", "avatar",
    "chat_attachment", "dispute_evidence", "payout_receipt", "adjustment_proof",
)
NEW_PURPOSES = (*OLD_PURPOSES, "tier_badge")


def _in(values: tuple[str, ...]) -> str:
    return f"purpose IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.drop_constraint("ck_media_objects_purpose", "media_objects", type_="check")
    op.create_check_constraint("ck_media_objects_purpose", "media_objects", _in(NEW_PURPOSES))
    op.add_column("seller_tier_config", sa.Column("badge", postgresql.JSONB(), nullable=True))
    op.add_column(
        "site_runtime_config",
        sa.Column("media_max_upload_mb", sa.Integer(), nullable=False, server_default="10"),
    )


def downgrade() -> None:
    op.drop_column("site_runtime_config", "media_max_upload_mb")
    op.drop_column("seller_tier_config", "badge")
    op.execute("DELETE FROM media_objects WHERE purpose = 'tier_badge'")
    op.drop_constraint("ck_media_objects_purpose", "media_objects", type_="check")
    op.create_check_constraint("ck_media_objects_purpose", "media_objects", _in(OLD_PURPOSES))
