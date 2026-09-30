"""Public buyer sales API v1: api keys, idempotency records, admin switches

Revision ID: hs1a2b3c4d5e6
Revises: hr1a2b3c4d5e6
Create Date: 2026-09-30
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = "hs1a2b3c4d5e6"
down_revision = "hr1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("api_access_enabled", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("products", sa.Column("api_enabled", sa.Boolean(), nullable=False, server_default="false"))
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("prefix", sa.String(16), nullable=False),
        sa.Column("key_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("scopes", ARRAY(sa.String()), nullable=False),
        sa.Column("allowed_ips", ARRAY(sa.String()), nullable=True),
        sa.Column("daily_spend_limit", sa.Integer(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_ip", sa.String(45), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_api_keys_account_active", "api_keys", ["account_id", "revoked_at"])
    op.create_table(
        "api_idempotency",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("api_key_id", sa.Integer(), sa.ForeignKey("api_keys.id", ondelete="CASCADE"), nullable=False),
        sa.Column("idem_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("reserved_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("response_json", sa.JSON(), nullable=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("api_key_id", "idem_key", name="uq_api_idempotency_key"),
    )
    op.create_index("ix_api_idempotency_key_created", "api_idempotency", ["api_key_id", "created_at"])
    op.create_index("ix_api_idempotency_order_id", "api_idempotency", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_api_idempotency_order_id", table_name="api_idempotency")
    op.drop_index("ix_api_idempotency_key_created", table_name="api_idempotency")
    op.drop_table("api_idempotency")
    op.drop_index("ix_api_keys_account_active", table_name="api_keys")
    op.drop_table("api_keys")
    op.drop_column("products", "api_enabled")
    op.drop_column("accounts", "api_access_enabled")
