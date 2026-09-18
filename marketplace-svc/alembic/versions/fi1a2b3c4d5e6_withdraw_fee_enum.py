"""transactiontype: add withdraw_fee

Split from fj1a2b3c4d5e6 (which uses it): Postgres refuses to use a new enum
value in the same transaction that added it.

Revision ID: fi1a2b3c4d5e6
Revises: fh1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op

revision = "fi1a2b3c4d5e6"
down_revision = "fh1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'withdraw_fee'")


def downgrade() -> None:
    # Postgres cannot drop a single enum value; leaving it is harmless.
    pass
