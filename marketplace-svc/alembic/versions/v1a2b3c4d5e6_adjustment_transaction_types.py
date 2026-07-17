"""add adjustment_credit / adjustment_debit transaction types

Split from the backfill that uses them (w1a2b3c4d5e6): Postgres refuses to use a
new enum value in the same transaction that added it.

Revision ID: v1a2b3c4d5e6
Revises: u1a2b3c4d5e6
Create Date: 2026-07-17
"""
from alembic import op

revision = "v1a2b3c4d5e6"
down_revision = "u1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'adjustment_credit'")
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'adjustment_debit'")


def downgrade() -> None:
    # Postgres cannot drop a single enum value. Leaving them is harmless: nothing
    # references them once w1a2b3c4d5e6 is rolled back.
    pass
