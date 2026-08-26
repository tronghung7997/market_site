"""remove the retired seller API credential store

Revision ID: db1a2b3c4d5e6
Revises: da1a2b3c4d5e6
Create Date: 2026-08-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "db1a2b3c4d5e6"
down_revision = "da1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This table existed only for the retired external Seller API credentials.
    op.drop_table("seller_api_keys")


def downgrade() -> None:
    op.create_table(
        "seller_api_keys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=True),
        sa.Column("key_prefix", sa.String(24), nullable=False),
        sa.Column("key_id", sa.String(64), nullable=True),
        sa.Column("signing_secret_encrypted", sa.Text(), nullable=True),
        sa.Column("signing_version", sa.String(8), nullable=False, server_default="v1"),
        sa.Column("scopes", postgresql.ARRAY(sa.String()), nullable=False,
                  server_default=sa.text("ARRAY['orders:read','orders:write','resources:write']::varchar[]")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now() + interval '90 days'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_seller_api_keys_key_hash", "seller_api_keys", ["key_hash"], unique=True)
    op.create_index("ix_seller_api_keys_key_id", "seller_api_keys", ["key_id"], unique=True)
    op.create_index("ix_seller_api_keys_account_expires", "seller_api_keys", ["account_id", "expires_at"])
