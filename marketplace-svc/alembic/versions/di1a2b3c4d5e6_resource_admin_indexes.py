"""add resource indexes for admin pagination and seller filtering

Revision ID: di1a2b3c4d5e6
Revises: dh1a2b3c4d5e6
Create Date: 2026-09-06
"""

import sqlalchemy as sa
from alembic import op


revision = "di1a2b3c4d5e6"
down_revision = "dh1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_resources_seller_id_created_at",
        "resources",
        ["seller_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_resources_created_at_id",
        "resources",
        [sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_resources_created_at_id", table_name="resources")
    op.drop_index("ix_resources_seller_id_created_at", table_name="resources")
