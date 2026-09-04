"""pause dispute clocks for Marketplace review chat

Revision ID: dh1a2b3c4d5e6
Revises: dg1a2b3c4d5e6
Create Date: 2026-09-04
"""
import sqlalchemy as sa
from alembic import op

revision = "dh1a2b3c4d5e6"
down_revision = "dg1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "disputes",
        sa.Column("review_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_disputes_review_requested",
        "disputes",
        ["review_requested_at"],
        postgresql_where=sa.text("review_requested_at IS NOT NULL"),
    )
    op.create_index(
        "uq_chat_support_order_requester",
        "chat_conversations",
        ["order_id", "requester_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'support'"),
    )
    op.create_check_constraint(
        "ck_chat_conversations_support_context",
        "chat_conversations",
        "kind != 'support' OR "
        "(order_id IS NOT NULL AND requester_id IS NOT NULL AND requester_role IN ('buyer', 'seller'))",
    )


def downgrade() -> None:
    op.drop_constraint("ck_chat_conversations_support_context", "chat_conversations")
    op.drop_index("uq_chat_support_order_requester", table_name="chat_conversations")
    op.drop_index("ix_disputes_review_requested", table_name="disputes")
    op.drop_column("disputes", "review_requested_at")
