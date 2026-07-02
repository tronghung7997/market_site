"""reviews: buyer ratings/comments on completed orders

Adds the reviews table backing the Review model — it existed in code but
was never migrated, so every review submission and any order list querying
review status (has_review) failed with UndefinedTableError.

Revision ID: l1a2b3c4d5e6
Revises: k1a2b3c4d5e6
Create Date: 2026-07-02
"""
import sqlalchemy as sa
from alembic import op

revision = "l1a2b3c4d5e6"
down_revision = "k1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False, unique=True),
        sa.Column("buyer_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_reviews_product_id", "reviews", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_reviews_product_id", table_name="reviews")
    op.drop_table("reviews")
