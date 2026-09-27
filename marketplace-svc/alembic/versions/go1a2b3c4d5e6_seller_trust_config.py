"""seller trust score & tier criteria settings (singleton)

Revision ID: go1a2b3c4d5e6
Revises: gn1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "go1a2b3c4d5e6"
down_revision = "gn1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The row is seeded on first read from src/sellers/trust.py defaults.
    op.create_table(
        "seller_trust_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("settings", JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("seller_trust_config")
