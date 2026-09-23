"""DProxy go-live: upstream revocation outbox + purchase identifiers on allocations

Revision ID: fq1a2b3c4d5e6
Revises: fp1a2b3c4d5e6
Create Date: 2026-09-23

- ``upstream_revocations``: partner-dispute calls queued inside the refund
  transaction and sent by ``upstream_revocation_job`` after commit, with
  retries and an admin incident when they run out.
- ``proxy_allocations``: the partner_order_id actually used for the purchase,
  DProxy's (nullable) order id and the upstream cost of the purchase.
"""
from alembic import op
import sqlalchemy as sa

revision = "fq1a2b3c4d5e6"
down_revision = "fp1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("proxy_allocations", sa.Column("partner_order_id", sa.String(100), nullable=True))
    op.add_column("proxy_allocations", sa.Column("upstream_order_id", sa.String(100), nullable=True))
    op.add_column("proxy_allocations", sa.Column("upstream_cost_usd", sa.Numeric(12, 4), nullable=True))
    op.add_column("proxy_allocations", sa.Column("upstream_cost_vnd", sa.Integer(), nullable=True))

    op.create_table(
        "upstream_revocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider_id", sa.Integer(), sa.ForeignKey("providers.id"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("partner_order_id", sa.String(100), nullable=False),
        sa.Column("reason", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("outcome", sa.String(16), nullable=True),
        sa.Column("last_error", sa.String(255), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("provider_id", "partner_order_id", name="uq_upstream_revocations_partner_order"),
    )
    op.create_index("ix_upstream_revocations_status_next", "upstream_revocations", ["status", "next_attempt_at"])


def downgrade() -> None:
    op.drop_index("ix_upstream_revocations_status_next", table_name="upstream_revocations")
    op.drop_table("upstream_revocations")
    op.drop_column("proxy_allocations", "upstream_cost_vnd")
    op.drop_column("proxy_allocations", "upstream_cost_usd")
    op.drop_column("proxy_allocations", "upstream_order_id")
    op.drop_column("proxy_allocations", "partner_order_id")
