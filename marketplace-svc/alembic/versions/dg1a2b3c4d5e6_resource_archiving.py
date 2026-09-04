"""add is_archived column to resources

Revision ID: dg1a2b3c4d5e6
Revises: df1a2b3c4d5e6
Create Date: 2026-09-04
"""
import sqlalchemy as sa
from alembic import op

revision = "dg1a2b3c4d5e6"
down_revision = "df1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resources",
        sa.Column("is_archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_index(
        "ix_resources_variant_archived",
        "resources",
        ["variant_id", "is_archived", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_resources_variant_archived", table_name="resources")
    op.drop_column("resources", "is_archived")
