"""seller applications: "needs more information" status

Revision ID: gl1a2b3c4d5e6
Revises: gk1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op

revision = "gl1a2b3c4d5e6"
down_revision = "gk1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A new enum value cannot be used in the transaction that adds it.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE applicationstatus ADD VALUE IF NOT EXISTS 'needs_info'")
    op.add_column("seller_applications", sa.Column("info_request", sa.String(1000), nullable=True))
    op.add_column("seller_applications", sa.Column("info_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("seller_applications", sa.Column("info_responded_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # Postgres cannot drop an enum value; waiting applications go back to the queue.
    op.execute("UPDATE seller_applications SET status = 'pending' WHERE status = 'needs_info'")
    op.drop_column("seller_applications", "info_responded_at")
    op.drop_column("seller_applications", "info_requested_at")
    op.drop_column("seller_applications", "info_request")
