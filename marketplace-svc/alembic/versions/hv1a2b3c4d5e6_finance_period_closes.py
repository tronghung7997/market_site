"""Closed accounting periods (Tài chính › Báo cáo › Chốt kỳ)

Revision ID: hv1a2b3c4d5e6
Revises: hu1a2b3c4d5e6
Create Date: 2026-10-01
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "hv1a2b3c4d5e6"
down_revision = "hu1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "finance_period_closes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("label", sa.String(40), nullable=False),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_transaction_id", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.CheckConstraint("period_end > period_start", name="ck_finance_period_closes_range"),
    )
    op.create_index("ix_finance_period_closes_period", "finance_period_closes", ["period_start", "period_end"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_finance_period_closes_period", table_name="finance_period_closes")
    op.drop_table("finance_period_closes")
