"""Promotions + support desk rework: child promo codes, archived campaigns,
desk ticket fields, conversation tags, canned replies, text admin-note subjects

Revision ID: hr1a2b3c4d5e6
Revises: hq1a2b3c4d5e6
Create Date: 2026-09-30
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "hr1a2b3c4d5e6"
down_revision = "hq1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Promotions ──
    op.add_column("promotions", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("promotion_redemptions", sa.Column("code", sa.String(32), nullable=True))
    op.execute(
        "UPDATE promotion_redemptions r SET code = p.code FROM promotions p WHERE p.id = r.promotion_id"
    )
    op.create_table(
        "promotion_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("promotion_id", sa.Integer(), sa.ForeignKey("promotions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("redeemed_order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_promotion_codes_promotion", "promotion_codes", ["promotion_id", "redeemed_at"])

    # ── Desk tickets ──
    for name, col in (
        ("assignee_id", sa.Column("assignee_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True)),
        ("resolved_at", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True)),
        ("resolved_by_id", sa.Column("resolved_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True)),
        ("first_response_at", sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True)),
        ("last_requester_message_at", sa.Column("last_requester_message_at", sa.DateTime(timezone=True), nullable=True)),
        ("blocked_reason", sa.Column("blocked_reason", sa.String(300), nullable=True)),
    ):
        op.add_column("chat_conversations", col)
    op.create_index("ix_chat_conversations_desk", "chat_conversations", ["kind", "status", "last_message_at"])
    op.execute("""
        UPDATE chat_conversations c SET
          last_requester_message_at = (
            SELECT max(m.created_at) FROM chat_messages m
            WHERE m.conversation_id = c.id AND m.sender_id = c.requester_id
          ),
          first_response_at = (
            SELECT min(m.created_at) FROM chat_messages m
            WHERE m.conversation_id = c.id AND m.sender_role = 'admin'
          )
        WHERE c.kind IN ('support', 'helpdesk')
    """)
    op.execute("""
        UPDATE chat_conversations SET resolved_at = updated_at
        WHERE kind IN ('support', 'helpdesk') AND status = 'resolved'
    """)

    op.create_table(
        "conversation_tags",
        sa.Column(
            "conversation_id", UUID(as_uuid=True),
            sa.ForeignKey("chat_conversations.id", ondelete="CASCADE"), primary_key=True,
        ),
        sa.Column("tag", sa.String(40), primary_key=True),
    )
    op.create_index("ix_conversation_tags_tag", "conversation_tags", ["tag"])

    op.create_table(
        "canned_replies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_type", sa.String(16), nullable=False, server_default="admin"),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("shortcut", sa.String(32), nullable=False),
        sa.Column("title", sa.String(80), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("owner_type IN ('admin', 'seller')", name="ck_canned_replies_owner_type"),
        sa.CheckConstraint("length(body) BETWEEN 1 AND 2000", name="ck_canned_replies_body"),
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_canned_replies_owner_shortcut "
        "ON canned_replies (owner_type, coalesce(owner_id, 0), shortcut)"
    )

    # ── Admin notes on uuid subjects ──
    op.alter_column(
        "admin_notes", "subject_id", type_=sa.String(64), existing_type=sa.Integer(),
        postgresql_using="subject_id::text", existing_nullable=False,
    )
    op.drop_constraint("ck_admin_notes_subject_type", "admin_notes", type_="check")
    op.create_check_constraint(
        "ck_admin_notes_subject_type", "admin_notes",
        "subject_type IN ('account', 'seller_application', 'conversation')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM admin_notes WHERE subject_type = 'conversation'")
    op.drop_constraint("ck_admin_notes_subject_type", "admin_notes", type_="check")
    op.create_check_constraint(
        "ck_admin_notes_subject_type", "admin_notes", "subject_type IN ('account', 'seller_application')",
    )
    op.alter_column(
        "admin_notes", "subject_id", type_=sa.Integer(), existing_type=sa.String(64),
        postgresql_using="subject_id::integer", existing_nullable=False,
    )
    op.execute("DROP INDEX IF EXISTS uq_canned_replies_owner_shortcut")
    op.drop_table("canned_replies")
    op.drop_index("ix_conversation_tags_tag", table_name="conversation_tags")
    op.drop_table("conversation_tags")
    op.drop_index("ix_chat_conversations_desk", table_name="chat_conversations")
    for name in (
        "blocked_reason", "last_requester_message_at", "first_response_at", "resolved_by_id", "resolved_at",
        "assignee_id",
    ):
        op.drop_column("chat_conversations", name)
    op.drop_index("ix_promotion_codes_promotion", table_name="promotion_codes")
    op.drop_table("promotion_codes")
    op.drop_column("promotion_redemptions", "code")
    op.drop_column("promotions", "archived_at")
