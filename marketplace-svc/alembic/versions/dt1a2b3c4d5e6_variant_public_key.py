"""product_variants.public_key — opaque identity for seller inventory pages

Seller-facing pages move from /seller/inventory/{variant_id} to
/seller/inventory/{key}, so the sequential variant id never shows up in a URL,
a label or a notification. Same 8-char base36 scheme (always contains a
letter) as products/accounts/orders; the generator is inlined on purpose so
this migration never imports ``src``.

Revision ID: dt1a2b3c4d5e6
Revises: ds1a2b3c4d5e6
Create Date: 2026-09-16
"""
import secrets

from alembic import op
import sqlalchemy as sa

revision = "dt1a2b3c4d5e6"
down_revision = "ds1a2b3c4d5e6"
branch_labels = None
depends_on = None

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def _new_public_key() -> str:
    while True:
        key = "".join(secrets.choice(_ALPHABET) for _ in range(8))
        if not key.isdigit():
            return key


def upgrade() -> None:
    op.add_column("product_variants", sa.Column("public_key", sa.String(length=12), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id FROM product_variants ORDER BY id")).all()
    used: set[str] = set()
    for (variant_id,) in rows:
        key = _new_public_key()
        while key in used:
            key = _new_public_key()
        used.add(key)
        bind.execute(
            sa.text("UPDATE product_variants SET public_key = :key WHERE id = :id"),
            {"key": key, "id": variant_id},
        )

    op.alter_column("product_variants", "public_key", nullable=False)
    op.create_unique_constraint("uq_product_variants_public_key", "product_variants", ["public_key"])


def downgrade() -> None:
    op.drop_constraint("uq_product_variants_public_key", "product_variants", type_="unique")
    op.drop_column("product_variants", "public_key")
