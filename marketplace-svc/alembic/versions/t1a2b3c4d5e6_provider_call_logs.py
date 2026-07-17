"""add provider_call_logs table

One row per HTTP attempt against an external provider, so a provider incident
can be debugged from something better than str(e) in log_entries.

Metadata only — no request/response bodies, since a provision response carries
the credential handed to the buyer.

order_id deliberately carries no FK: rows are written on a separate session (so
they survive the order transaction rolling back), and at provision time the
order is still uncommitted and invisible to that session.

Revision ID: t1a2b3c4d5e6
Revises: s1a2b3c4d5e6
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa

revision = "t1a2b3c4d5e6"
down_revision = "s1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_call_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider_id", sa.Integer(), sa.ForeignKey("providers.id"), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("operation", sa.String(50), nullable=False),
        sa.Column("method", sa.String(10), nullable=False),
        sa.Column("path", sa.String(255), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_provider_call_logs_provider_id", "provider_call_logs", ["provider_id"])
    op.create_index("ix_provider_call_logs_order_id", "provider_call_logs", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_provider_call_logs_order_id", table_name="provider_call_logs")
    op.drop_index("ix_provider_call_logs_provider_id", table_name="provider_call_logs")
    op.drop_table("provider_call_logs")
