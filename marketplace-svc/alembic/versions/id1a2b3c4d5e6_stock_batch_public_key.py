"""stock_batches.public_key — seller URLs and filters name a batch by key

Revision ID: id1a2b3c4d5e6
Revises: ib1a2b3c4d5e6
Create Date: 2026-10-06

AGENTS.md: seller-facing URLs never show sequential row ids. The package stock
table and the export page filtered by `?batch=<stock_batches.id>`; they now use
`?batch=<public_key>` (an all-digit value is still read as a legacy id).
Existing rows are backfilled with random base36 keys (same generator as
products.public_key).
"""
from alembic import op
import sqlalchemy as sa

from src.i18n.slug import new_public_key

revision = "id1a2b3c4d5e6"
down_revision = "ib1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stock_batches", sa.Column("public_key", sa.String(12), nullable=True))
    conn = op.get_bind()
    ids = [row[0] for row in conn.execute(sa.text("SELECT id FROM stock_batches ORDER BY id"))]
    used: set[str] = set()
    rows = []
    for batch_id in ids:
        key = new_public_key()
        while key in used:
            key = new_public_key()
        used.add(key)
        rows.append({"k": key, "i": batch_id})
    if rows:
        conn.execute(sa.text("UPDATE stock_batches SET public_key = :k WHERE id = :i"), rows)
    op.alter_column("stock_batches", "public_key", nullable=False)
    op.create_unique_constraint("uq_stock_batches_public_key", "stock_batches", ["public_key"])


def downgrade() -> None:
    op.drop_constraint("uq_stock_batches_public_key", "stock_batches", type_="unique")
    op.drop_column("stock_batches", "public_key")
