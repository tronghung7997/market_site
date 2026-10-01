"""Public API is open to every verified buyer; admins switch it off per account

Revision ID: ht1a2b3c4d5e6
Revises: hs1a2b3c4d5e6
Create Date: 2026-10-01
"""
import sqlalchemy as sa
from alembic import op

revision = "ht1a2b3c4d5e6"
down_revision = "hs1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("accounts", "api_access_enabled", server_default=sa.true())
    op.execute("UPDATE accounts SET api_access_enabled = true WHERE api_access_enabled = false")


def downgrade() -> None:
    op.alter_column("accounts", "api_access_enabled", server_default=sa.false())
