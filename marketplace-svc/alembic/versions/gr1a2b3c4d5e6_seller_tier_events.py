"""seller tier history: one row per tier change with its reason

Revision ID: gr1a2b3c4d5e6
Revises: gq1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op

revision = "gr1a2b3c4d5e6"
down_revision = "gq1a2b3c4d5e6"
branch_labels = None
depends_on = None

_TIERS = "('new', 'verified', 'trusted', 'enterprise')"


def upgrade() -> None:
    op.create_table(
        "seller_tier_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("old_tier", sa.String(20), nullable=False),
        sa.Column("new_tier", sa.String(20), nullable=False),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(f"old_tier IN {_TIERS}", name="ck_seller_tier_events_old_tier"),
        sa.CheckConstraint(f"new_tier IN {_TIERS}", name="ck_seller_tier_events_new_tier"),
        sa.CheckConstraint("old_tier != new_tier", name="ck_seller_tier_events_changed"),
    )
    op.create_index("ix_seller_tier_events_account", "seller_tier_events", ["account_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_seller_tier_events_account", table_name="seller_tier_events")
    op.drop_table("seller_tier_events")
