"""ledger_reconcile_runs: stored reports of the nightly books check

Revision ID: fh1a2b3c4d5e6
Revises: fg1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "fh1a2b3c4d5e6"
down_revision = "fg1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ledger_reconcile_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ran_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("trigger", sa.String(length=20), nullable=False, server_default="schedule"),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("wallets_checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("orders_checked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mismatch_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("totals", postgresql.JSON(), nullable=False, server_default="{}"),
        sa.Column("findings", postgresql.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_table("ledger_reconcile_runs")
