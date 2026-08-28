"""Seller resource-level dispute remedies and historical cases.

Revision ID: aa1b2c3d4e5f
Revises: dd1a2b3c4d5e6
"""
from alembic import op
import sqlalchemy as sa


revision = "aa1b2c3d4e5f"
down_revision = "dd1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_order_id_key")
    op.execute("DROP INDEX IF EXISTS ix_disputes_order_id")
    op.execute(
        "CREATE UNIQUE INDEX uq_disputes_one_open_case_per_order "
        "ON disputes (order_id) WHERE status = 'open'"
    )
    op.create_table(
        "dispute_resource_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dispute_id", sa.Integer(), sa.ForeignKey("disputes.id"), nullable=False),
        sa.Column("original_resource_id", sa.Integer(), sa.ForeignKey("resources.id"), nullable=False),
        sa.Column("replacement_resource_id", sa.Integer(), sa.ForeignKey("resources.id"), nullable=True),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("refund_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("action IN ('replace', 'refund')", name="ck_dispute_resource_action_type"),
        sa.CheckConstraint("refund_amount >= 0", name="ck_dispute_resource_refund_nonnegative"),
        sa.UniqueConstraint("dispute_id", "original_resource_id", name="uq_dispute_resource_action_original"),
    )
    op.create_index("ix_dispute_resource_actions_dispute_created", "dispute_resource_actions", ["dispute_id", "created_at"])
    op.create_index("ix_dispute_resource_actions_idempotency", "dispute_resource_actions", ["dispute_id", "idempotency_key"])
    op.add_column("alerts", sa.Column("href", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("alerts", "href")
    op.drop_index("ix_dispute_resource_actions_idempotency", table_name="dispute_resource_actions")
    op.drop_index("ix_dispute_resource_actions_dispute_created", table_name="dispute_resource_actions")
    op.drop_table("dispute_resource_actions")
    op.drop_index("uq_disputes_one_open_case_per_order", table_name="disputes")
    op.create_unique_constraint("disputes_order_id_key", "disputes", ["order_id"])
