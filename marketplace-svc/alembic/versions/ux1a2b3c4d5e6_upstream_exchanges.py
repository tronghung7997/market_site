"""upstream_exchanges: request/response bodies of supplier and payment calls

One row per HTTP call to a supplier or payment integration (DProxy, TopProxy,
igbm, ghlab, PayOS, SePay, NowPayments, or any call made inside a provider
adapter), so a dispute with the third party can be settled from what was sent
and received. Bodies are Fernet-encrypted by the application; headers are never
stored. No FK on order_id / provider_id: the row is written on its own session
while the caller's order may still be uncommitted (same as provider_call_logs).
Pruned after upstream_exchange_retention_days (default 90) by the operational
log cleanup job.

Revision ID: ux1a2b3c4d5e6
Revises: kp1a2b3c4d5e6
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op

revision = "ux1a2b3c4d5e6"
down_revision = "kp1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "upstream_exchanges",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("integration", sa.String(length=50), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("path", sa.String(length=255), nullable=False),
        sa.Column("url_path", sa.Text(), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("job", sa.String(length=64), nullable=True),
        sa.Column("provider_id", sa.Integer(), nullable=True),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("operation", sa.String(length=50), nullable=True),
        sa.Column("request_body", sa.Text(), nullable=True),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("request_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("response_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("truncated", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_upstream_exchanges_created_at", "upstream_exchanges", ["created_at"])
    op.create_index("ix_upstream_exchanges_integration", "upstream_exchanges", ["integration"])
    op.create_index("ix_upstream_exchanges_request_id", "upstream_exchanges", ["request_id"])
    op.create_index("ix_upstream_exchanges_provider_id", "upstream_exchanges", ["provider_id"])
    op.create_index("ix_upstream_exchanges_order_id", "upstream_exchanges", ["order_id"])


def downgrade() -> None:
    op.drop_table("upstream_exchanges")
