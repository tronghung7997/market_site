"""add seller_tier to accounts

Seller tier (New/Verified/Trusted/Enterprise) drives withdraw limits, platform
fee discount, and escrow hold-time reduction — set manually by admins for now.

Revision ID: p1a2b3c4d5e6
Revises: o1a2b3c4d5e6
Create Date: 2026-07-16
"""
from alembic import op
import sqlalchemy as sa

revision = "p1a2b3c4d5e6"
down_revision = "o1a2b3c4d5e6"
branch_labels = None
depends_on = None

seller_tier_enum = sa.Enum("new", "verified", "trusted", "enterprise", name="sellertier")


def upgrade() -> None:
    seller_tier_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "accounts",
        sa.Column("seller_tier", seller_tier_enum, nullable=False, server_default="new"),
    )


def downgrade() -> None:
    op.drop_column("accounts", "seller_tier")
    seller_tier_enum.drop(op.get_bind(), checkfirst=True)
