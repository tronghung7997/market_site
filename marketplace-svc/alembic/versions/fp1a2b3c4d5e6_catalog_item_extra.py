"""supplier_catalog_items.extra — machine attributes of an upstream plan/SKU

Revision ID: fp1a2b3c4d5e6
Revises: fo1a2b3c4d5e6
Create Date: 2026-09-22

Proxy providers (DProxy plans, TopProxy loaiproxy table) are synced into the
same catalog snapshot as account shops so /admin/sources can browse and import
them. Their rows need the plan's duration, upstream code and currency to build
config-pricing parameters at import time; ``extra`` carries those verbatim.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "fp1a2b3c4d5e6"
down_revision = "fo1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "supplier_catalog_items",
        sa.Column("extra", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("supplier_catalog_items", "extra")
