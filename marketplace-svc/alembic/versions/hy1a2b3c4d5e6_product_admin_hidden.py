"""products.admin_hidden — admin can hide products from the admin product list

Revision ID: hy1a2b3c4d5e6
Revises: hx1a2b3c4d5e6
Create Date: 2026-10-05
"""
import sqlalchemy as sa
from alembic import op

revision = "hy1a2b3c4d5e6"
down_revision = "hx1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column("admin_hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("products", "admin_hidden")
