"""post an adjusting entry where the ledger no longer sums to available_balance

Migration q1a2b3c4d5e6 (3-layer balance) moved money out of available_balance and
into locked_balance for every withdraw_request that was pending at the time, using
raw SQL and writing no transaction rows. Withdrawals approved before that migration
also debited available_balance directly, whereas `withdraw` now only draws down
locked_balance. Either way the transaction ledger stopped summing to the balance,
which is the one thing a ledger is for.

We do not rewrite history: no fabricated withdraw_lock rows for locks that were
never journalled (and, for pre-q1 withdrawals, never happened as locks at all).
Instead each affected wallet gets one adjusting entry recording the divergence, so
Σ(in) − Σ(out) == available_balance holds from here on.

Direction comes from the sign of the gap, so amount stays positive as everywhere
else in the ledger. On the dev database exactly one wallet is affected
(seller@dxtrade, −9,200,000 = a 9,000,000 still-pending request never journalled,
plus 2 × 100,000 from pre-q1 withdrawal handling).

Revision ID: w1a2b3c4d5e6
Revises: v1a2b3c4d5e6
Create Date: 2026-07-17
"""
from alembic import op

revision = "w1a2b3c4d5e6"
down_revision = "v1a2b3c4d5e6"
branch_labels = None
depends_on = None

# Must mirror models/wallet.py::TRANSACTION_DIRECTION. `withdraw` is deliberately
# absent from both lists: it draws down locked_balance only.
_LEDGER = """
    SELECT w.id AS wallet_id,
           w.available_balance - COALESCE(SUM(CASE
             WHEN t.type IN ('topup','purchase_release','refund','affiliate_commission',
                             'withdraw_unlock','platform_fee','adjustment_credit')
               THEN t.amount
             WHEN t.type IN ('purchase_hold','withdraw_lock','adjustment_debit')
               THEN -t.amount
             ELSE 0 END), 0) AS gap
    FROM wallets w
    LEFT JOIN transactions t ON t.wallet_id = w.id
    GROUP BY w.id, w.available_balance
"""


def upgrade() -> None:
    op.execute(f"""
        INSERT INTO transactions (wallet_id, type, amount, description, created_at)
        SELECT wallet_id,
               CASE WHEN gap > 0 THEN 'adjustment_credit' ELSE 'adjustment_debit' END::transactiontype,
               ABS(gap),
               'Đối soát số dư — chênh lệch do migration q1a2b3c4d5e6 đổi lớp số dư mà không ghi sổ',
               now()
        FROM ({_LEDGER}) x
        WHERE gap <> 0
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM transactions
        WHERE type IN ('adjustment_credit', 'adjustment_debit')
          AND description LIKE 'Đối soát số dư%'
    """)
