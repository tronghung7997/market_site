"""add gateway_call_logs table

Buyer-facing "request history" for /gw/{key}/<endpoint> calls — separate from
usage_records on purpose: usage_records is the permanent billing/dispute
ledger (never pruned). This table is a bounded, recent-only convenience log,
safe to prune on a schedule (see GATEWAY_CALL_LOG_RETENTION_DAYS,
scheduler.py gateway_call_log_cleanup_job) without touching billing.

Unlike provider_call_logs (admin-facing, metadata-only — a provision response
can carry a credential), this DOES store the request payload and a capped
response snippet: the payload is buyer-supplied (a url/handle/query, not a
secret), and the response is data the buyer already received live over HTTP.

Revision ID: ch1a2b3c4d5e6
Revises: cg1a2b3c4d5e6
Create Date: 2026-07-31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ch1a2b3c4d5e6"
down_revision = "cg1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gateway_call_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("endpoint", sa.String(100), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("request_payload", postgresql.JSONB(), nullable=True),
        sa.Column("response_snippet", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_gateway_call_logs_order_id", "gateway_call_logs", ["order_id"])
    op.create_index("ix_gateway_call_logs_endpoint", "gateway_call_logs", ["endpoint"])
    op.create_index("ix_gateway_call_logs_status_code", "gateway_call_logs", ["status_code"])
    op.create_index("ix_gateway_call_logs_created_at", "gateway_call_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_gateway_call_logs_created_at", table_name="gateway_call_logs")
    op.drop_index("ix_gateway_call_logs_status_code", table_name="gateway_call_logs")
    op.drop_index("ix_gateway_call_logs_endpoint", table_name="gateway_call_logs")
    op.drop_index("ix_gateway_call_logs_order_id", table_name="gateway_call_logs")
    op.drop_table("gateway_call_logs")
