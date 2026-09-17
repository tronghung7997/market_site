"""site_analytics_config singleton (Microsoft Clarity project id)

Admin-editable so the storefront tag can be switched on without a rebuild.

Revision ID: ea1a2b3c4d5e6
Revises: dx1a2b3c4d5e6
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = "ea1a2b3c4d5e6"
down_revision = "dx1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "site_analytics_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("clarity_project_id", sa.String(length=32), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("site_analytics_config")
