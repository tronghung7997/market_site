"""chat: one helpdesk thread per account and role (buyer, seller)

A seller keeps shop questions apart from their own purchases: the account
gets a buyer thread and, once it sells, a separate seller thread.

Revision ID: gq1a2b3c4d5e6
Revises: gp1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op

revision = "gq1a2b3c4d5e6"
down_revision = "gp1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("uq_chat_helpdesk_requester", table_name="chat_conversations")
    op.create_index(
        "uq_chat_helpdesk_requester",
        "chat_conversations",
        ["requester_id", "requester_role"],
        unique=True,
        postgresql_where=sa.text("kind = 'helpdesk'"),
    )


def downgrade() -> None:
    # Back to one thread per account: keep the seller thread where both exist.
    op.execute(
        "DELETE FROM chat_conversations buyer WHERE buyer.kind = 'helpdesk' "
        "AND buyer.requester_role = 'buyer' AND EXISTS ("
        "SELECT 1 FROM chat_conversations shop WHERE shop.kind = 'helpdesk' "
        "AND shop.requester_id = buyer.requester_id AND shop.requester_role = 'seller')"
    )
    op.drop_index("uq_chat_helpdesk_requester", table_name="chat_conversations")
    op.create_index(
        "uq_chat_helpdesk_requester",
        "chat_conversations",
        ["requester_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'helpdesk'"),
    )
