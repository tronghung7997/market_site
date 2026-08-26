"""persist seller integration contract test results

Revision ID: dc1a2b3c4d5e6
Revises: db1a2b3c4d5e6
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "dc1a2b3c4d5e6"
down_revision = "db1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("providers", sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("providers", sa.Column("last_test_result", postgresql.JSON(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("providers", "last_test_result")
    op.drop_column("providers", "last_tested_at")
