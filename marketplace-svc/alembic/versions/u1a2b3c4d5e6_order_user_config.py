"""add orders.user_config

Provisioning through RealApiAdapter now runs after the request returns, so the
buyer's product options have to outlive the request: both the background task
and the stuck-order sweeper replay them to call the provider.

Holds product options (type/network/days/platform/...), never credentials.

Revision ID: u1a2b3c4d5e6
Revises: t1a2b3c4d5e6
Create Date: 2026-07-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "u1a2b3c4d5e6"
down_revision = "t1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("user_config", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "user_config")
