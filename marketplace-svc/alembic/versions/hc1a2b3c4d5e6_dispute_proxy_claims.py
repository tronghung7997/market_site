"""dispute_claim_proxies + dispute_proxy_actions: per-proxy disputes

Revision ID: hc1a2b3c4d5e6
Revises: hb1a2b3c4d5e6
Create Date: 2026-09-29

A buyer can name specific proxy lines (`proxy_allocations`, `#NN`) of a
multi-proxy order in a dispute, and the seller (or Marketplace) refunds
exactly those lines — the proxy counterpart of dispute_claim_resources /
dispute_resource_actions. New tables only; no existing row changes.
"""
import sqlalchemy as sa
from alembic import op

revision = "hc1a2b3c4d5e6"
down_revision = "hb1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dispute_claim_proxies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dispute_id", sa.Integer(), sa.ForeignKey("disputes.id"), nullable=False),
        sa.Column("allocation_id", sa.Integer(), sa.ForeignKey("proxy_allocations.id"), nullable=False),
        sa.Column("batch_key", sa.String(128), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("dispute_id", "allocation_id", name="uq_dispute_claim_proxies_dispute_allocation"),
    )
    op.create_index("ix_dispute_claim_proxies_batch", "dispute_claim_proxies", ["dispute_id", "batch_key"])

    op.create_table(
        "dispute_proxy_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dispute_id", sa.Integer(), sa.ForeignKey("disputes.id"), nullable=False),
        sa.Column("allocation_id", sa.Integer(), sa.ForeignKey("proxy_allocations.id"), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("refund_amount", sa.Integer(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("actor_role", sa.String(10), nullable=False, server_default="seller"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("action IN ('refund')", name="ck_dispute_proxy_action_type"),
        sa.CheckConstraint("refund_amount >= 0", name="ck_dispute_proxy_refund_nonnegative"),
        sa.CheckConstraint("actor_role IN ('seller', 'admin')", name="ck_dispute_proxy_action_actor_role"),
        sa.UniqueConstraint("dispute_id", "allocation_id", name="uq_dispute_proxy_action_allocation"),
        sa.UniqueConstraint(
            "dispute_id", "idempotency_key", "allocation_id", name="uq_dispute_proxy_actions_idempotent_item",
        ),
    )
    op.create_index("ix_dispute_proxy_actions_dispute_created", "dispute_proxy_actions", ["dispute_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_dispute_proxy_actions_dispute_created", table_name="dispute_proxy_actions")
    op.drop_table("dispute_proxy_actions")
    op.drop_index("ix_dispute_claim_proxies_batch", table_name="dispute_claim_proxies")
    op.drop_table("dispute_claim_proxies")
