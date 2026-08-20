"""add scoped marketplace conversations

Revision ID: cv1a2b3c4d5e6
Revises: cu1a2b3c4d5e6
Create Date: 2026-08-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "cv1a2b3c4d5e6"
down_revision = "cu1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="open"),
        sa.Column("product_id", sa.Integer(), nullable=True),
        sa.Column("order_id", sa.Integer(), nullable=True),
        sa.Column("buyer_id", sa.Integer(), nullable=True),
        sa.Column("seller_id", sa.Integer(), nullable=True),
        sa.Column("requester_id", sa.Integer(), nullable=True),
        sa.Column("requester_role", sa.String(length=16), nullable=True),
        sa.Column("subject", sa.String(length=160), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("last_message_id", sa.BigInteger(), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('product_inquiry', 'order', 'support')", name="ck_chat_conversations_kind"),
        sa.CheckConstraint("status IN ('open', 'resolved', 'closed', 'blocked', 'read_only')", name="ck_chat_conversations_status"),
        sa.CheckConstraint("kind != 'product_inquiry' OR (product_id IS NOT NULL AND buyer_id IS NOT NULL AND seller_id IS NOT NULL)", name="ck_chat_conversations_inquiry_context"),
        sa.ForeignKeyConstraint(["buyer_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.ForeignKeyConstraint(["requester_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["seller_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_conversations_last_message", "chat_conversations", ["last_message_at", "id"])
    op.create_index(
        "uq_chat_product_inquiry",
        "chat_conversations",
        ["buyer_id", "seller_id", "product_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'product_inquiry'"),
    )
    op.create_table(
        "chat_participants",
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=False),
        sa.Column("context_role", sa.String(length=16), nullable=False),
        sa.Column("last_read_message_id", sa.BigInteger(), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("context_role IN ('buyer', 'seller', 'admin')", name="ck_chat_participants_context_role"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("conversation_id", "account_id"),
    )
    op.create_index("ix_chat_participants_account", "chat_participants", ["account_id", "archived_at"])
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=False),
        sa.Column("sender_role", sa.String(length=16), nullable=False),
        sa.Column("client_message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("length(body) BETWEEN 1 AND 4000", name="ck_chat_messages_body"),
        sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("conversation_id", "client_message_id", name="uq_chat_message_client_id"),
    )
    op.create_index("ix_chat_messages_conversation_id", "chat_messages", ["conversation_id", "id"])


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("chat_participants")
    op.drop_table("chat_conversations")
