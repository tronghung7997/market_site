"""Index the seller Telegram dispatch reads: alerts by recipient, chats by seller activity

telegram_dispatch_job (every 20 s) asks, per bot, whether the seller has an
alert above the bot's cursor and unread buyer chat newer than the watermark,
and deliver() reads the same rows.

- alerts had no index that leads with the recipient for an id range (the only
  one, ix_alerts_active_target, is partial on is_active and carries no id), so
  both reads walked every alert above the cursor, whoever it was for, and
  filtered. ix_alerts_target_id (target_type, target_id, id) serves the
  "aimed at the seller" scope directly and the "provider of the seller" scope
  through a join on the seller's providers.
- chat_conversations had no index on seller_id; the chat check went through
  every conversation the seller ever took part in (via chat_participants) and
  probed its messages. ix_chat_conversations_seller_activity
  (seller_id, last_message_at) lets the dispatch read only conversations with
  activity since its watermark.

The newest settled alert (cursor floor) walks the primary key backwards and
stops after the last few minutes of alerts, so created_at is not indexed.

Plain CREATE INDEX inside the migration transaction, not CONCURRENTLY: the
production tables are small (the latest local production copy, 2026-10-03,
holds under a hundred alerts and chat conversations), so the SHARE lock
blocking writes lasts well under a second, and CONCURRENTLY cannot run inside
Alembic's transaction.

Revision ID: ic1a2b3c4d5e6
Revises: ib1a2b3c4d5e6
Create Date: 2026-10-06
"""
from alembic import op

revision = "ic1a2b3c4d5e6"
down_revision = "ib1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_alerts_target_id", "alerts", ["target_type", "target_id", "id"])
    op.create_index(
        "ix_chat_conversations_seller_activity", "chat_conversations", ["seller_id", "last_message_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_chat_conversations_seller_activity", table_name="chat_conversations")
    op.drop_index("ix_alerts_target_id", table_name="alerts")
