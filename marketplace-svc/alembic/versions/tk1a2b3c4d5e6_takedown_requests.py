"""takedown: link takedown requests fulfilled by an external partner

``takedown_requests`` holds one buyer link each (public code ``TD-…``), the
partner order it became, the partner's cost quote and GMMO's buyer price, and
the marketplace order created once the buyer accepts. ``takedown_events`` is
the request history; ``partner_event_id`` is unique so a redelivered partner
webhook is applied once.

Revision ID: tk1a2b3c4d5e6
Revises: ms1a2b3c4d5e6
Create Date: 2026-10-09
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "tk1a2b3c4d5e6"
down_revision = "ms1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "takedown_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(16), nullable=False, unique=True),
        sa.Column("buyer_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("service", sa.String(32), nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("warranty_hours", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="review"),
        sa.Column("partner_order_id", sa.Integer(), nullable=True, unique=True),
        sa.Column("partner_status", sa.String(24), nullable=True),
        sa.Column("partner_price", sa.Integer(), nullable=True),
        sa.Column("price", sa.Integer(), nullable=True),
        sa.Column("warranty_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evidence_live_url", sa.Text(), nullable=True),
        sa.Column("evidence_dead_url", sa.Text(), nullable=True),
        sa.Column("partner_refunded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=True, unique=True),
        sa.Column("needs_sync", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("sync_error", sa.Text(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("quoted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("processing_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("price IS NULL OR price > 0", name="ck_takedown_requests_price_positive"),
        sa.CheckConstraint("warranty_hours IN (24, 72)", name="ck_takedown_requests_warranty_hours"),
    )
    op.create_index("ix_takedown_requests_buyer_id", "takedown_requests", ["buyer_id"])
    op.create_index("ix_takedown_requests_status", "takedown_requests", ["status"])

    op.create_table(
        "takedown_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_id", sa.Integer(), sa.ForeignKey("takedown_requests.id"), nullable=True),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("partner_event_id", sa.Integer(), nullable=True, unique=True),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("from_status", sa.String(24), nullable=True),
        sa.Column("to_status", sa.String(24), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column("applied", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_takedown_events_request_id", "takedown_events", ["request_id"])


def downgrade() -> None:
    op.drop_index("ix_takedown_events_request_id", table_name="takedown_events")
    op.drop_table("takedown_events")
    op.drop_index("ix_takedown_requests_status", table_name="takedown_requests")
    op.drop_index("ix_takedown_requests_buyer_id", table_name="takedown_requests")
    op.drop_table("takedown_requests")
