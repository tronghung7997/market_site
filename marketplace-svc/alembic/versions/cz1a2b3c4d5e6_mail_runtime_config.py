"""mail runtime config + outbox list indexes"""

from alembic import op
import sqlalchemy as sa


revision = "cz1a2b3c4d5e6"
down_revision = "cy1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mail_runtime_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("mail_from", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("mail_from_name", sa.String(length=80), nullable=False, server_default="Proxora"),
        sa.Column("worker_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    op.create_index("ix_mail_outbox_created_at", "mail_outbox", ["created_at"])
    op.create_index("ix_mail_outbox_status_created", "mail_outbox", ["status", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_mail_outbox_status_created", table_name="mail_outbox")
    op.drop_index("ix_mail_outbox_created_at", table_name="mail_outbox")
    op.drop_table("mail_runtime_config")
