"""financial sign invariants and transaction idempotency

Revision ID: cs1a2b3c4d5e6
Revises: cr1a2b3c4d5e6
Create Date: 2026-08-18
"""

from alembic import op
import sqlalchemy as sa


revision = "cs1a2b3c4d5e6"
down_revision = "cr1a2b3c4d5e6"
branch_labels = None
depends_on = None


CHECKS = (
    ("wallets", "ck_wallets_pending_nonnegative", "pending_balance >= 0"),
    ("wallets", "ck_wallets_available_nonnegative", "available_balance >= 0"),
    ("wallets", "ck_wallets_locked_nonnegative", "locked_balance >= 0"),
    ("transactions", "ck_transactions_amount_positive", "amount > 0"),
    ("withdraw_requests", "ck_withdraw_requests_amount_positive", "amount > 0"),
    ("orders", "ck_orders_quantity_positive", "quantity > 0"),
    ("orders", "ck_orders_total_nonnegative", "total_amount >= 0"),
    ("product_variants", "ck_product_variants_price_nonnegative", "price >= 0"),
    ("products", "ck_products_commission_rate_range", "commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100)"),
    ("categories", "ck_categories_commission_rate_range", "commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100)"),
    ("affiliate_commissions", "ck_affiliate_commissions_rate_range", "rate_percent > 0 AND rate_percent <= 100"),
    ("affiliate_commissions", "ck_affiliate_commissions_amount_positive", "amount > 0"),
    ("order_balances", "ck_order_balances_total_positive", "units_total > 0"),
    ("order_balances", "ck_order_balances_used_nonnegative", "units_used >= 0"),
    ("order_balances", "ck_order_balances_used_within_total", "units_used <= units_total"),
    ("order_balances", "ck_order_balances_default_rate_positive", "default_rate IS NULL OR default_rate > 0"),
    ("usage_records", "ck_usage_records_units_positive", "units > 0"),
)


def upgrade() -> None:
    # NOT VALID avoids silently rewriting or deleting historical audit data.
    # PostgreSQL still enforces each constraint for every new/updated row; ops
    # can reconcile old violations and VALIDATE CONSTRAINT separately.
    for table, name, expression in CHECKS:
        op.execute(
            sa.text(f'ALTER TABLE "{table}" ADD CONSTRAINT "{name}" CHECK ({expression}) NOT VALID')
        )

    # Older order creation wrote the literal placeholder ``order-pending``
    # before an order ID was available.  Those rows are separate purchases,
    # not double-postings, so preserve every ledger entry while repairing its
    # reference.  An exact account/amount/timestamp match restores the real
    # order link; orphaned demo/legacy rows receive an explicit immutable key.
    # Any other duplicate shape is intentionally left untouched and will still
    # fail the unique-index creation below for manual reconciliation.
    op.execute(sa.text("""
        WITH exact_order_matches AS (
            SELECT t.id AS transaction_id, MIN(o.id) AS order_id
            FROM transactions AS t
            JOIN wallets AS w ON w.id = t.wallet_id
            JOIN orders AS o
              ON o.buyer_id = w.account_id
             AND o.total_amount = t.amount
             AND o.created_at = t.created_at
            WHERE t.type::text = 'purchase_hold'
              AND t.reference_id = 'order-pending'
            GROUP BY t.id
            HAVING COUNT(*) = 1
        )
        UPDATE transactions AS t
        SET reference_id = 'order-' || matches.order_id::text
        FROM exact_order_matches AS matches
        WHERE t.id = matches.transaction_id
    """))
    op.execute(sa.text("""
        UPDATE transactions
        SET reference_id = 'legacy-purchase-hold-' || id::text
        WHERE type::text = 'purchase_hold'
          AND reference_id = 'order-pending'
    """))

    # A duplicate means a historical double-posting that must be reconciled,
    # not auto-deleted by a migration. In that case this deliberately fails.
    op.create_index(
        "uq_transactions_type_reference",
        "transactions",
        ["type", "reference_id"],
        unique=True,
        postgresql_where=sa.text("reference_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_transactions_type_reference", table_name="transactions")
    for table, name, _ in reversed(CHECKS):
        op.drop_constraint(name, table, type_="check")
