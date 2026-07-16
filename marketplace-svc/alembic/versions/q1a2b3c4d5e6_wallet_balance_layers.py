"""split wallet.balance into pending/available/locked balance

request_withdraw only checked balance without locking it — a seller could
submit multiple withdraw requests exceeding actual balance before any got
approved. Splitting into 3 columns lets us lock funds atomically at request
time. All existing balance is preserved as available_balance; pending stays
at 0 (escrow is still tracked via Order.status, not reworked here). Any
withdraw_requests still pending at migration time get their amount moved
from available_balance into locked_balance so the money isn't double-counted.

Revision ID: q1a2b3c4d5e6
Revises: p1a2b3c4d5e6
Create Date: 2026-07-16
"""
from alembic import op
import sqlalchemy as sa

revision = "q1a2b3c4d5e6"
down_revision = "p1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("wallets", sa.Column("pending_balance", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("wallets", sa.Column("available_balance", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("wallets", sa.Column("locked_balance", sa.Integer(), nullable=False, server_default="0"))

    op.execute("UPDATE wallets SET available_balance = balance")
    op.execute("""
        UPDATE wallets w SET available_balance = available_balance - sub.total,
                              locked_balance = sub.total
        FROM (SELECT account_id, SUM(amount) AS total FROM withdraw_requests
              WHERE status = 'pending' GROUP BY account_id) sub
        WHERE w.account_id = sub.account_id
    """)

    op.drop_column("wallets", "balance")
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'withdraw_lock'")
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'withdraw_unlock'")


def downgrade() -> None:
    op.add_column("wallets", sa.Column("balance", sa.Integer(), nullable=False, server_default="0"))
    op.execute("UPDATE wallets SET balance = pending_balance + available_balance + locked_balance")
    op.drop_column("wallets", "locked_balance")
    op.drop_column("wallets", "available_balance")
    op.drop_column("wallets", "pending_balance")
    # Postgres has no DROP VALUE for enums — withdraw_lock/withdraw_unlock stay,
    # matching convention of other additive migrations here.
