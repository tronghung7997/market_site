"""reviews: seller reply + admin hide

Sellers answer a review in public (one editable reply); admins can hide a
review, which drops it from the storefront and from the product rating
without deleting the buyer's record.

Revision ID: dn1a2b3c4d5e6
Revises: dm1a2b3c4d5e6
Create Date: 2026-09-15
"""
from alembic import op
import sqlalchemy as sa

revision = "dn1a2b3c4d5e6"
down_revision = "dm1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reviews", sa.Column("seller_reply", sa.Text(), nullable=True))
    op.add_column("reviews", sa.Column("seller_replied_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("reviews", sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("reviews", sa.Column("hidden_reason", sa.Text(), nullable=True))
    op.add_column("reviews", sa.Column("hidden_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True))
    op.add_column("reviews", sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_reviews_product_hidden", "reviews", ["product_id", "is_hidden"])


def downgrade() -> None:
    op.drop_index("ix_reviews_product_hidden", table_name="reviews")
    for col in ("hidden_at", "hidden_by_id", "hidden_reason", "is_hidden", "seller_replied_at", "seller_reply"):
        op.drop_column("reviews", col)
