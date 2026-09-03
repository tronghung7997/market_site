"""add buyer-withdrawn dispute outcome

Revision ID: ac1b2c3d4e5f6
Revises: ab1b2c3d4e5f6
Create Date: 2026-09-03
"""
from alembic import op


revision = "ac1b2c3d4e5f6"
down_revision = "ab1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE disputestatus ADD VALUE IF NOT EXISTS 'withdrawn_by_buyer'")


def downgrade() -> None:
    # PostgreSQL cannot safely remove a populated enum value.
    pass
