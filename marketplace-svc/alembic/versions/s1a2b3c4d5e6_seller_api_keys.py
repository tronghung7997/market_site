"""add seller_api_keys table

Lets Trusted/Enterprise sellers generate an API key to call the marketplace
programmatically (currently scoped to GET /seller/orders only). Only the
key_hash (sha256) is stored — the plaintext is shown once at creation time
and never persisted.

Revision ID: s1a2b3c4d5e6
Revises: r1a2b3c4d5e6
Create Date: 2026-07-16
"""
from alembic import op
import sqlalchemy as sa

revision = "s1a2b3c4d5e6"
down_revision = "r1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "seller_api_keys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False),
        sa.Column("key_prefix", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_seller_api_keys_key_hash", "seller_api_keys", ["key_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_seller_api_keys_key_hash", table_name="seller_api_keys")
    op.drop_table("seller_api_keys")
