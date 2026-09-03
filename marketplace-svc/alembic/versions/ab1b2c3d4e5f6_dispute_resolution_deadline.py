"""add dispute resolution response deadlines

Revision ID: ab1b2c3d4e5f6
Revises: aa1b2c3d4e5f6
Create Date: 2026-09-03
"""
from alembic import op
import sqlalchemy as sa


revision = "ab1b2c3d4e5f6"
down_revision = "aa1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE disputestatus ADD VALUE IF NOT EXISTS 'resolved_timeout'")
    op.add_column("disputes", sa.Column("resolution_offered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("disputes", sa.Column("resolution_deadline_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_disputes_open_resolution_deadline",
        "disputes",
        ["resolution_deadline_at"],
        postgresql_where=sa.text("status = 'open' AND resolution_deadline_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_disputes_open_resolution_deadline", table_name="disputes")
    op.drop_column("disputes", "resolution_deadline_at")
    op.drop_column("disputes", "resolution_offered_at")
    # PostgreSQL cannot safely remove a populated enum value.
