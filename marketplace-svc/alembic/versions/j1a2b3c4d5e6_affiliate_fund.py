"""affiliate fund ledger (single global budget)

Adds affiliate_fund_entries: a signed ledger where positive rows are admin
top-ups and negative rows are commission draw-downs. Balance = SUM(amount),
allowed to go negative.

Revision ID: j1a2b3c4d5e6
Revises: i1a2b3c4d5e6
Create Date: 2026-07-02
"""
import sqlalchemy as sa
from alembic import op

revision = "j1a2b3c4d5e6"
down_revision = "i1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "affiliate_fund_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("reference_id", sa.String(length=255), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_affiliate_fund_entries_created_at",
        "affiliate_fund_entries",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_affiliate_fund_entries_created_at", table_name="affiliate_fund_entries")
    op.drop_table("affiliate_fund_entries")
