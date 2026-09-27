"""orders: delivered_at / completed_at for the buyer's order timeline

Set by the Order status hooks from now on; older orders keep NULL (the
timeline then shows the step without a time).

Revision ID: gt1a2b3c4d5e6
Revises: gs1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op

revision = "gt1a2b3c4d5e6"
down_revision = "gs1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("orders", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "completed_at")
    op.drop_column("orders", "delivered_at")
