"""SEO pack: review images, post tags/canonical, category slug redirects

* ``media_objects.purpose`` accepts ``review_image`` (public, buyer uploads).
* ``reviews.images``: up to 3 PublicImage snapshots per review.
* ``posts.tags`` (JSONB list, default []) and ``posts.canonical_url``.
  Per-locale meta title/description live in ``posts.i18n`` and category SEO
  fields in ``categories.i18n``: no column needed for those.
* ``category_redirects``: old category slug -> category, served as a
  permanent redirect by the storefront.

Revision ID: kd1a2b3c4d5e6
Revises: ie1a2b3c4d5e6
Create Date: 2026-10-07
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "kd1a2b3c4d5e6"
down_revision = "ie1a2b3c4d5e6"
branch_labels = None
depends_on = None

OLD_PURPOSES = (
    "product_image", "category_image", "seller_logo", "seller_banner", "avatar",
    "chat_attachment", "dispute_evidence", "payout_receipt", "adjustment_proof", "tier_badge",
    "post_cover",
)
NEW_PURPOSES = (*OLD_PURPOSES, "review_image")


def _in(values: tuple[str, ...]) -> str:
    return f"purpose IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.drop_constraint("ck_media_objects_purpose", "media_objects", type_="check")
    op.create_check_constraint("ck_media_objects_purpose", "media_objects", _in(NEW_PURPOSES))

    op.add_column("reviews", sa.Column("images", JSONB(), nullable=True))

    op.add_column("posts", sa.Column("tags", JSONB(), nullable=False, server_default="[]"))
    op.add_column("posts", sa.Column("canonical_url", sa.String(500), nullable=True))

    op.create_table(
        "category_redirects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("old_slug", sa.String(100), nullable=False, unique=True),
        sa.Column(
            "category_id", sa.Integer(), sa.ForeignKey("categories.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_category_redirects_category_id", "category_redirects", ["category_id"])


def downgrade() -> None:
    op.drop_index("ix_category_redirects_category_id", table_name="category_redirects")
    op.drop_table("category_redirects")
    op.drop_column("posts", "canonical_url")
    op.drop_column("posts", "tags")
    op.drop_column("reviews", "images")
    op.execute("DELETE FROM media_objects WHERE purpose = 'review_image'")
    op.drop_constraint("ck_media_objects_purpose", "media_objects", type_="check")
    op.create_check_constraint("ck_media_objects_purpose", "media_objects", _in(OLD_PURPOSES))
