"""Per-admin "bell last opened" marker

Revision ID: ia1a2b3c4d5e6
Revises: hz1a2b3c4d5e6
Create Date: 2026-10-05
"""
import sqlalchemy as sa
from alembic import op

revision = "ia1a2b3c4d5e6"
down_revision = "hz1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_notification_seen",
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("admin_notification_seen")
