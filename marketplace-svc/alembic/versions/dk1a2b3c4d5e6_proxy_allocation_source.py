"""proxy_allocations.source — pool vs purchase binding

Revision ID: dk1a2b3c4d5e6
Revises: dj1a2b3c4d5e6
Create Date: 2026-09-14
"""

import sqlalchemy as sa
from alembic import op


revision = "dk1a2b3c4d5e6"
down_revision = "dj1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "proxy_allocations",
        sa.Column("source", sa.String(length=16), nullable=False, server_default="pool"),
    )


def downgrade() -> None:
    op.drop_column("proxy_allocations", "source")
