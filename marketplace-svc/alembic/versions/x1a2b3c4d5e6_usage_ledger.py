"""add order_balances + usage_records (usage ledger for credit-strategy orders)

Order strategy=credit today only computes a purchase-time price (see
CreditPricing) — nothing tracks how many requests a buyer has actually
consumed against the package they bought, so quota is unenforceable. This adds
the ledger: `order_balances` (1-1 with a delivered credit order, units_total
chốt tại thời điểm giao hàng) and `usage_records` (mỗi lần trừ, kể cả bị từ
chối, để tra lại lịch sử khi có tranh chấp).

Revision ID: x1a2b3c4d5e6
Revises: w1a2b3c4d5e6
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "x1a2b3c4d5e6"
down_revision = "w1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "order_balances",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False, unique=True),
        sa.Column("units_total", sa.Integer(), nullable=False),
        sa.Column("units_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "usage_records",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("request_id", sa.String(100), nullable=True),
        sa.Column("endpoint", sa.String(100), nullable=False),
        sa.Column("units", sa.Integer(), nullable=False),
        sa.Column("status", sa.Enum("ok", "rejected_quota", "rejected_expired", name="usagerecordstatus"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_usage_records_order_id", "usage_records", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_usage_records_order_id", table_name="usage_records")
    op.drop_table("usage_records")
    sa.Enum(name="usagerecordstatus").drop(op.get_bind(), checkfirst=True)
    op.drop_table("order_balances")
