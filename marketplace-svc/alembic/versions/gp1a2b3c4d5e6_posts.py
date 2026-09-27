"""blog posts and the post_cover media purpose

Revision ID: gp1a2b3c4d5e6
Revises: go1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "gp1a2b3c4d5e6"
down_revision = "go1a2b3c4d5e6"
branch_labels = None
depends_on = None

OLD_PURPOSES = (
    "product_image", "category_image", "seller_logo", "seller_banner", "avatar",
    "chat_attachment", "dispute_evidence", "payout_receipt", "adjustment_proof", "tier_badge",
)
NEW_PURPOSES = (*OLD_PURPOSES, "post_cover")


def _in(values: tuple[str, ...]) -> str:
    return f"purpose IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.drop_constraint("ck_media_objects_purpose", "media_objects", type_="check")
    op.create_check_constraint("ck_media_objects_purpose", "media_objects", _in(NEW_PURPOSES))
    op.create_table(
        "posts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(80), nullable=False, unique=True),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cover", JSONB(), nullable=True),
        sa.Column("i18n", JSONB(), nullable=False, server_default="{}"),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("category IN ('guide', 'news')", name="ck_posts_category"),
        sa.CheckConstraint("status IN ('draft', 'published')", name="ck_posts_status"),
        sa.CheckConstraint("status = 'draft' OR published_at IS NOT NULL", name="ck_posts_published_at"),
    )
    op.create_index("ix_posts_public", "posts", ["status", "published_at"])


def downgrade() -> None:
    op.drop_index("ix_posts_public", table_name="posts")
    op.drop_table("posts")
    op.execute("DELETE FROM media_objects WHERE purpose = 'post_cover'")
    op.drop_constraint("ck_media_objects_purpose", "media_objects", type_="check")
    op.create_check_constraint("ck_media_objects_purpose", "media_objects", _in(OLD_PURPOSES))
