"""products.public_key + products.slug — public URL identity without integer ids

Buyer-facing URLs move from /products/{id} to /products/{slug}-{public_key}.
The key is an 8-char base36 random string (always contains a letter so it can
never be mistaken for a legacy integer id). The slug is derived from the
stored title and is editable; it is intentionally NOT unique because the key
carries uniqueness.

Revision ID: dp1a2b3c4d5e6
Revises: dm1a2b3c4d5e6
Create Date: 2026-09-15
"""
import re
import secrets
import unicodedata

from alembic import op
import sqlalchemy as sa

revision = "dp1a2b3c4d5e6"
down_revision = "dm1a2b3c4d5e6"
branch_labels = None
depends_on = None

# Inlined copies of src/i18n/slug.py helpers: a migration must keep producing
# the same rows even if the application module changes later.
_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"
_NON_SLUG_RE = re.compile(r"[^a-z0-9]+")


def new_public_key() -> str:
    while True:
        key = "".join(secrets.choice(_ALPHABET) for _ in range(8))
        if not key.isdigit():
            return key


def slugify_text(value, *, max_length: int = 140) -> str:
    text = (value or "").replace("đ", "d").replace("Đ", "D")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = _NON_SLUG_RE.sub("-", text.lower()).strip("-")
    if len(text) > max_length:
        text = text[:max_length].rstrip("-")
    return text or "product"


def upgrade() -> None:
    op.add_column("products", sa.Column("public_key", sa.String(length=12), nullable=True))
    op.add_column("products", sa.Column("slug", sa.String(length=160), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, title FROM products ORDER BY id")).all()
    used: set[str] = set()
    for product_id, title in rows:
        key = new_public_key()
        while key in used:
            key = new_public_key()
        used.add(key)
        bind.execute(
            sa.text("UPDATE products SET public_key = :key, slug = :slug WHERE id = :id"),
            {"key": key, "slug": slugify_text(title), "id": product_id},
        )

    op.alter_column("products", "public_key", nullable=False)
    op.alter_column("products", "slug", nullable=False)
    op.create_unique_constraint("uq_products_public_key", "products", ["public_key"])


def downgrade() -> None:
    op.drop_constraint("uq_products_public_key", "products", type_="unique")
    op.drop_column("products", "slug")
    op.drop_column("products", "public_key")
