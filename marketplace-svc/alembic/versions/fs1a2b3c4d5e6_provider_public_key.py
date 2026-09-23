"""providers.public_key — seller surfaces address a source by key, not row id

Revision ID: fs1a2b3c4d5e6
Revises: fq1a2b3c4d5e6
Create Date: 2026-09-23

AGENTS.md: buyer- and seller-facing URLs never show sequential row ids. The
seller "Nguồn cung" area used /seller/sources/{providers.id}; it now uses
/seller/sources/{public_key}. Existing rows are backfilled with random base36
keys (same generator as products.public_key).
"""
from alembic import op
import sqlalchemy as sa

from src.i18n.slug import new_public_key

revision = "fs1a2b3c4d5e6"
down_revision = "fq1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("providers", sa.Column("public_key", sa.String(12), nullable=True))
    conn = op.get_bind()
    ids = [row[0] for row in conn.execute(sa.text("SELECT id FROM providers ORDER BY id"))]
    used: set[str] = set()
    for provider_id in ids:
        key = new_public_key()
        while key in used:
            key = new_public_key()
        used.add(key)
        conn.execute(sa.text("UPDATE providers SET public_key = :k WHERE id = :i"), {"k": key, "i": provider_id})
    op.alter_column("providers", "public_key", nullable=False)
    op.create_unique_constraint("uq_providers_public_key", "providers", ["public_key"])


def downgrade() -> None:
    op.drop_constraint("uq_providers_public_key", "providers", type_="unique")
    op.drop_column("providers", "public_key")
