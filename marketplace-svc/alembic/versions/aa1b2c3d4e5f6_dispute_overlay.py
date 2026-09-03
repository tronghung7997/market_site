"""Keep disputes separate from the order lifecycle.

Revision ID: aa1b2c3d4e5f6
Revises: z1a2b3c4d5e6, d1e2f3a4b5c6
"""
from alembic import op


revision = "aa1b2c3d4e5f6"
down_revision = ("z1a2b3c4d5e6", "d1e2f3a4b5c6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A dispute could previously only be opened after delivery, so this is a
    # lossless conversion. Its open/settled state already lives in disputes.
    op.execute("UPDATE orders SET status = 'delivered' WHERE status = 'disputed'")


def downgrade() -> None:
    # Restoring the overloaded representation is intentionally lossy only for
    # the lifecycle interpretation, not financial records.
    op.execute("""
        UPDATE orders
        SET status = 'disputed'
        WHERE id IN (SELECT order_id FROM disputes WHERE status = 'open')
          AND status = 'delivered'
    """)
