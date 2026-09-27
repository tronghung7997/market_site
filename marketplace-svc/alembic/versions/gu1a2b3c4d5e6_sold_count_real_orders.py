"""products.sold_count: count completed real orders

Until now only the trust-seed console raised ``sold_count``; completed real
orders never did, so a shop with finished sales showed "0 sold". From now on
the Order update hook counts each order that completes: the items of a stock
order, one per configured-service order (API/proxy/task quantities are
request counts). This backfills every real order already completed (the
column held only seeded bumps before, so adding is exact).

Revision ID: gu1a2b3c4d5e6
Revises: gt1a2b3c4d5e6
Create Date: 2026-09-27
"""
from alembic import op

revision = "gu1a2b3c4d5e6"
down_revision = "gt1a2b3c4d5e6"
branch_labels = None
depends_on = None

_REAL_COMPLETED_UNITS = """
    SELECT COALESCE(o.product_id, v.product_id) AS product_id,
           SUM(CASE WHEN o.variant_id IS NOT NULL THEN GREATEST(o.quantity, 1) ELSE 1 END) AS units
    FROM orders o
    LEFT JOIN product_variants v ON v.id = o.variant_id
    WHERE o.status = 'completed' AND o.is_seeded IS NOT TRUE
    GROUP BY COALESCE(o.product_id, v.product_id)
"""


def upgrade() -> None:
    op.execute(f"""
        UPDATE products p SET sold_count = COALESCE(p.sold_count, 0) + s.units
        FROM ({_REAL_COMPLETED_UNITS}) s
        WHERE s.product_id = p.id
    """)


def downgrade() -> None:
    op.execute(f"""
        UPDATE products p SET sold_count = GREATEST(COALESCE(p.sold_count, 0) - s.units, 0)
        FROM ({_REAL_COMPLETED_UNITS}) s
        WHERE s.product_id = p.id
    """)
