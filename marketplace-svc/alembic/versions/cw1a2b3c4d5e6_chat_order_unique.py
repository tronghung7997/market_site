"""enforce one conversation per order

Revision ID: cw1a2b3c4d5e6
Revises: cv1a2b3c4d5e6
Create Date: 2026-08-20
"""

from alembic import op
import sqlalchemy as sa


revision = "cw1a2b3c4d5e6"
down_revision = "cv1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_chat_order_conversation",
        "chat_conversations",
        ["order_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'order'"),
    )


def downgrade() -> None:
    op.drop_index("uq_chat_order_conversation", table_name="chat_conversations")
