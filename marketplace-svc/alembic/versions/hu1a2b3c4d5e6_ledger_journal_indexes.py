"""Indexes behind the admin money journal (Tài chính › Dòng tiền)

The journal pages the whole ledger newest-first, filters by wallet and by
reference group, and computes running balances per wallet:

- (created_at, id): keyset paging and date ranges over every wallet;
- (wallet_id, created_at, id) INCLUDE (type, amount): one wallet's history
  and its running balance as an index-only scan;
- reference_id with varchar_pattern_ops: a reference group
  (``order-12`` plus ``order-12:dispute-3``) by equality or prefix LIKE.
  The existing unique (type, reference_id) index cannot serve a lookup
  without the type.

Built CONCURRENTLY so the migration never blocks wallet writes.

Revision ID: hu1a2b3c4d5e6
Revises: ht1a2b3c4d5e6
Create Date: 2026-10-01
"""
from alembic import op

revision = "hu1a2b3c4d5e6"
down_revision = "ht1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_transactions_created_at_id "
            "ON transactions (created_at, id)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_transactions_wallet_created_id "
            "ON transactions (wallet_id, created_at, id) INCLUDE (type, amount)"
        )
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_transactions_reference_pattern "
            "ON transactions (reference_id varchar_pattern_ops) WHERE reference_id IS NOT NULL"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_transactions_reference_pattern")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_transactions_wallet_created_id")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_transactions_created_at_id")
