"""orders.order_code — buyer/seller-facing order number (ORD-XXXXXXXX)

Buyers and sellers see and link orders by this code instead of the
sequential id, so nobody can read marketplace volume off their own order
numbers. The generator is inlined: a migration must keep working even if the
application helpers change later.

Revision ID: ds1a2b3c4d5e6
Revises: dr1a2b3c4d5e6
Create Date: 2026-09-15
"""
import secrets

from alembic import op
import sqlalchemy as sa

revision = "ds1a2b3c4d5e6"
down_revision = "dr1a2b3c4d5e6"
branch_labels = None
depends_on = None

_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _new_order_code() -> str:
    while True:
        body = "".join(secrets.choice(_ALPHABET) for _ in range(8))
        if not body.isdigit():
            return "ORD-" + body


def upgrade() -> None:
    op.add_column("orders", sa.Column("order_code", sa.String(length=16), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id FROM orders ORDER BY id")).all()
    used: set[str] = set()
    for (order_id,) in rows:
        code = _new_order_code()
        while code in used:
            code = _new_order_code()
        used.add(code)
        bind.execute(
            sa.text("UPDATE orders SET order_code = :code WHERE id = :id"),
            {"code": code, "id": order_id},
        )

    op.alter_column("orders", "order_code", nullable=False)
    op.create_unique_constraint("uq_orders_order_code", "orders", ["order_code"])


def downgrade() -> None:
    op.drop_constraint("uq_orders_order_code", "orders", type_="unique")
    op.drop_column("orders", "order_code")
