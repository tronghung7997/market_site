"""ledger: backfill legacy refunds and pre-lock withdrawals so the nightly check reads clean

Two leftovers from older schemas made every reconcile run report the same
mismatches although no money was missing:

1. orders.refunded_amount (b1c2d3e4f5a6, 2026-08-28) was added with default 0
   and never backfilled, so orders refunded before that date show a refund in
   the transaction log but 0 on the row. Copy Σ refund from the log onto the
   row — only where the row is lower and the sum fits the order total.

2. Withdrawals approved before wallet balance layers (q1a2b3c4d5e6,
   2026-07-16) have a `withdraw` row but no `withdraw_lock`. After that
   migration `withdraw` only leaves locked_balance, so the log computes a
   negative locked balance. Such wallets were already patched by hand with an
   adjustment_debit naming q1a2b3c4d5e6, which fixed available_balance but
   counted the payout as money out twice. Append the missing lock plus an
   adjustment_credit reversing the patch: available is unchanged, locked
   returns to 0 and the platform totals match. Nothing existing is rewritten.

Revision ID: gb1a2b3c4d5e6
Revises: ga1a2b3c4d5e6
Create Date: 2026-09-24
"""
from alembic import op

revision = "gb1a2b3c4d5e6"
down_revision = "ga1a2b3c4d5e6"
branch_labels = None
depends_on = None

FIX_REF = "legacy-withdraw-lock/wallet-"


BACKFILL_REFUNDS_SQL = r"""
        UPDATE orders o SET refunded_amount = r.total
        FROM (
            SELECT CAST(substring(reference_id FROM '^order-(\d+)(?::|$)') AS integer) AS order_id,
                   SUM(amount) AS total
            FROM transactions
            WHERE type = 'refund' AND reference_id LIKE 'order-%'
            GROUP BY 1
        ) r
        WHERE o.id = r.order_id AND o.refunded_amount < r.total AND r.total <= o.total_amount
"""

LEGACY_WITHDRAW_SQL = f"""
        WITH ledger AS (
            SELECT w.id AS wallet_id,
                   COALESCE(SUM(CASE t.type
                       WHEN 'withdraw_lock' THEN t.amount
                       WHEN 'withdraw_unlock' THEN -t.amount
                       WHEN 'withdraw' THEN -t.amount
                       WHEN 'withdraw_fee' THEN -t.amount
                       ELSE 0 END), 0) AS locked
            FROM wallets w LEFT JOIN transactions t ON t.wallet_id = w.id
            WHERE w.locked_balance = 0
            GROUP BY w.id
        ),
        legacy AS (
            SELECT l.wallet_id, -l.locked AS deficit
            FROM ledger l
            WHERE l.locked < 0
              AND EXISTS (SELECT 1 FROM transactions p
                          WHERE p.wallet_id = l.wallet_id AND p.type = 'adjustment_debit'
                            AND p.description LIKE '%q1a2b3c4d5e6%' AND p.amount >= -l.locked)
              AND NOT EXISTS (SELECT 1 FROM transactions d
                              WHERE d.reference_id = '{FIX_REF}' || l.wallet_id)
        )
        INSERT INTO transactions (wallet_id, type, amount, description, reference_id)
        SELECT wallet_id, CAST('withdraw_lock' AS transactiontype), deficit,
               'Bù khoá cho lệnh rút trước migration q1a2b3c4d5e6 (chưa có bước khoá tiền)',
               '{FIX_REF}' || wallet_id
        FROM legacy
        UNION ALL
        SELECT wallet_id, CAST('adjustment_credit' AS transactiontype), deficit,
               'Đảo bút toán đối soát tay q1a2b3c4d5e6 — thay bằng khoá bù cùng số tiền',
               '{FIX_REF}' || wallet_id
        FROM legacy
"""


def upgrade() -> None:
    op.execute(BACKFILL_REFUNDS_SQL)
    op.execute(LEGACY_WITHDRAW_SQL)


def downgrade() -> None:
    op.execute(f"DELETE FROM transactions WHERE reference_id LIKE '{FIX_REF}%'")
    # refunded_amount stays: it now matches the transaction log, which is the source of truth.
