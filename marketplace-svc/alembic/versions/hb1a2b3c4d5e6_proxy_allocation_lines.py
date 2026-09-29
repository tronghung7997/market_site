"""proxy_allocations: several proxies per order (line_no, per-line delivery)

Revision ID: hb1a2b3c4d5e6
Revises: ha1a2b3c4d5e6
Create Date: 2026-09-29

An order of quantity N now binds N upstream proxies, one row per line
(`line_no` 1..N). UNIQUE(order_id) becomes UNIQUE(order_id, line_no); every
existing row is line 1. `delivered_text` (Fernet ciphertext, like
orders.delivered_data) keeps each line's credentials; NULL on existing rows,
which keep reading orders.delivered_data. `refund_amount_cap` is the line's
share of the order total.
"""
import sqlalchemy as sa
from alembic import op

revision = "hb1a2b3c4d5e6"
down_revision = "ha1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("proxy_allocations", sa.Column("line_no", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("proxy_allocations", sa.Column("delivered_text", sa.Text(), nullable=True))
    op.add_column("proxy_allocations", sa.Column("refund_amount_cap", sa.Integer(), nullable=True))
    op.drop_constraint("uq_proxy_allocations_order", "proxy_allocations", type_="unique")
    op.create_unique_constraint("uq_proxy_allocations_order_line", "proxy_allocations", ["order_id", "line_no"])
    op.create_check_constraint("ck_proxy_allocations_line_no_positive", "proxy_allocations", "line_no >= 1")


def downgrade() -> None:
    # Only safe while every order still holds a single line.
    op.drop_constraint("ck_proxy_allocations_line_no_positive", "proxy_allocations", type_="check")
    op.drop_constraint("uq_proxy_allocations_order_line", "proxy_allocations", type_="unique")
    op.create_unique_constraint("uq_proxy_allocations_order", "proxy_allocations", ["order_id"])
    op.drop_column("proxy_allocations", "refund_amount_cap")
    op.drop_column("proxy_allocations", "delivered_text")
    op.drop_column("proxy_allocations", "line_no")
