"""seller API key expiry, scopes, and active-key cap support

Revision ID: ct1a2b3c4d5e6
Revises: cs1a2b3c4d5e6
Create Date: 2026-08-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "ct1a2b3c4d5e6"
down_revision = "cs1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "seller_api_keys",
        sa.Column(
            "scopes",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default=sa.text("ARRAY['orders:read','orders:write','resources:write']::varchar[]"),
        ),
    )
    op.add_column(
        "seller_api_keys",
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now() + interval '90 days'"),
        ),
    )
    op.create_index("ix_seller_api_keys_account_expires", "seller_api_keys", ["account_id", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_seller_api_keys_account_expires", table_name="seller_api_keys")
    op.drop_column("seller_api_keys", "expires_at")
    op.drop_column("seller_api_keys", "scopes")
