"""add abandoned dispute outcome after escrow silence

Revision ID: df1a2b3c4d5e6
Revises: ac1b2c3d4e5f6
Create Date: 2026-09-03
"""
from alembic import op


revision = "df1a2b3c4d5e6"
down_revision = "ac1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE disputestatus ADD VALUE IF NOT EXISTS 'resolved_abandoned'")


def downgrade() -> None:
    # PostgreSQL cannot safely remove a populated enum value.
    pass
