"""Add repeatable dispute claim batches and append-only case messages.

Revision ID: d1e2f3a4b5c6
Revises: c1d2e3f4a5b6
"""

from alembic import op
import sqlalchemy as sa


revision = "d1e2f3a4b5c6"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resources", sa.Column("refund_amount_cap", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_resources_refund_amount_cap_nonnegative",
        "resources",
        "refund_amount_cap IS NULL OR refund_amount_cap >= 0",
    )
    op.execute(
        """
        WITH ranked AS (
            SELECT
                resources.id,
                orders.total_amount / NULLIF(orders.quantity, 0) AS base_amount,
                orders.total_amount % NULLIF(orders.quantity, 0) AS remainder,
                row_number() OVER (PARTITION BY resources.order_id ORDER BY resources.id) AS line_number,
                count(*) OVER (PARTITION BY resources.order_id) AS resource_count,
                orders.quantity
            FROM resources
            JOIN orders ON orders.id = resources.order_id
            WHERE resources.order_id IS NOT NULL
        )
        UPDATE resources
        SET refund_amount_cap = ranked.base_amount + CASE WHEN ranked.line_number <= ranked.remainder THEN 1 ELSE 0 END
        FROM ranked
        WHERE resources.id = ranked.id
          AND ranked.resource_count = ranked.quantity
          AND resources.refund_amount_cap IS NULL
        """
    )
    op.add_column("dispute_claim_resources", sa.Column("batch_key", sa.String(length=128), nullable=True))
    op.add_column("dispute_claim_resources", sa.Column("reason", sa.Text(), nullable=True))
    op.create_index(
        "ix_dispute_claim_resources_batch",
        "dispute_claim_resources",
        ["dispute_id", "batch_key"],
    )
    op.create_unique_constraint(
        "uq_dispute_resource_actions_idempotent_item",
        "dispute_resource_actions",
        ["dispute_id", "idempotency_key", "original_resource_id"],
    )
    op.create_table(
        "dispute_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dispute_id", sa.Integer(), sa.ForeignKey("disputes.id"), nullable=False),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("actor_role", sa.String(length=20), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("actor_role IN ('buyer', 'seller', 'admin')", name="ck_dispute_messages_actor_role"),
    )
    op.create_index("ix_dispute_messages_case_time", "dispute_messages", ["dispute_id", "created_at"])
    op.create_index(
        "uq_dispute_messages_idempotency",
        "dispute_messages",
        ["dispute_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_dispute_messages_idempotency", table_name="dispute_messages")
    op.drop_index("ix_dispute_messages_case_time", table_name="dispute_messages")
    op.drop_table("dispute_messages")
    op.drop_constraint(
        "uq_dispute_resource_actions_idempotent_item",
        "dispute_resource_actions",
        type_="unique",
    )
    op.drop_index("ix_dispute_claim_resources_batch", table_name="dispute_claim_resources")
    op.drop_column("dispute_claim_resources", "reason")
    op.drop_column("dispute_claim_resources", "batch_key")
    op.drop_constraint("ck_resources_refund_amount_cap_nonnegative", "resources", type_="check")
    op.drop_column("resources", "refund_amount_cap")
