"""chat: helpdesk conversations (one standing Marketplace thread per account)

Revision ID: gk1a2b3c4d5e6
Revises: gj1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op

revision = "gk1a2b3c4d5e6"
down_revision = "gj1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_chat_conversations_kind", "chat_conversations", type_="check")
    op.create_check_constraint(
        "ck_chat_conversations_kind",
        "chat_conversations",
        "kind IN ('product_inquiry', 'order', 'support', 'helpdesk')",
    )
    op.create_check_constraint(
        "ck_chat_conversations_helpdesk_context",
        "chat_conversations",
        "kind != 'helpdesk' OR "
        "(order_id IS NULL AND requester_id IS NOT NULL AND requester_role IN ('buyer', 'seller'))",
    )
    op.create_index(
        "uq_chat_helpdesk_requester",
        "chat_conversations",
        ["requester_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'helpdesk'"),
    )


def downgrade() -> None:
    op.execute("DELETE FROM chat_conversations WHERE kind = 'helpdesk'")
    op.drop_index("uq_chat_helpdesk_requester", table_name="chat_conversations")
    op.drop_constraint("ck_chat_conversations_helpdesk_context", "chat_conversations", type_="check")
    op.drop_constraint("ck_chat_conversations_kind", "chat_conversations", type_="check")
    op.create_check_constraint(
        "ck_chat_conversations_kind",
        "chat_conversations",
        "kind IN ('product_inquiry', 'order', 'support')",
    )
