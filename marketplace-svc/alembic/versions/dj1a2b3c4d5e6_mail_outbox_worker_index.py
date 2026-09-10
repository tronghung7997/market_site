"""add mail outbox worker scan index

Revision ID: dj1a2b3c4d5e6
Revises: di1a2b3c4d5e6
Create Date: 2026-09-10
"""

from alembic import op


revision = "dj1a2b3c4d5e6"
down_revision = "di1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_mail_outbox_status_scheduled_id",
        "mail_outbox",
        ["status", "scheduled_at", "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_mail_outbox_status_scheduled_id", table_name="mail_outbox")
