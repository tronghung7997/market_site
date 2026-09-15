"""review window + auto 5★ config; reviews.is_auto

Admin-tunable: how long after protection ends a buyer may still review, and
after how many days an unreviewed order gets an automatic 5★.

Revision ID: do1a2b3c4d5e6
Revises: dn1a2b3c4d5e6
Create Date: 2026-09-15
"""
from alembic import op
import sqlalchemy as sa

revision = "do1a2b3c4d5e6"
down_revision = "dn1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reviews", sa.Column("is_auto", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("seller_runtime_config", sa.Column("review_window_days", sa.Integer(), nullable=False, server_default="30"))
    op.add_column("seller_runtime_config", sa.Column("auto_review_days", sa.Integer(), nullable=False, server_default="7"))
    op.add_column("seller_runtime_config", sa.Column("auto_review_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    op.drop_column("seller_runtime_config", "auto_review_enabled")
    op.drop_column("seller_runtime_config", "auto_review_days")
    op.drop_column("seller_runtime_config", "review_window_days")
    op.drop_column("reviews", "is_auto")
