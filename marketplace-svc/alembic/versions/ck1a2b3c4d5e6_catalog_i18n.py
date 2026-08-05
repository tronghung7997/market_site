"""catalog i18n JSONB columns + seed i18n.vi from legacy scalars

Adds `i18n` JSONB on categories, products, product_variants.

Shape:
  categories.i18n:        { "en": {"name": "..."}, "vi": {"name": "..."} }
  products.i18n:          { "en": {"title","description","warranty_text",
                                   "highlight_text","features":[]},
                            "vi": { ... } }
  product_variants.i18n:  { "en": {"name": "..."}, "vi": {"name": "..."} }

Legacy scalar columns (name/title/description/…) are preserved unchanged.
Existing catalog content is treated as Vietnamese and copied into i18n.vi.
English content is backfilled separately (script or later ops pass).

Revision ID: ck1a2b3c4d5e6
Revises: cj1a2b3c4d5e6
Create Date: 2026-08-05
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "ck1a2b3c4d5e6"
down_revision = "cj1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("i18n", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "products",
        sa.Column("i18n", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.add_column(
        "product_variants",
        sa.Column("i18n", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )

    # Preserve current (Vietnamese) content into i18n.vi without touching scalars.
    op.execute(
        """
        UPDATE categories
        SET i18n = jsonb_build_object(
            'vi', jsonb_strip_nulls(jsonb_build_object('name', name))
        )
        WHERE COALESCE(i18n, '{}'::jsonb) = '{}'::jsonb
        """
    )
    op.execute(
        """
        UPDATE products
        SET i18n = jsonb_build_object(
            'vi', jsonb_strip_nulls(jsonb_build_object(
                'title', title,
                'description', description,
                'warranty_text', warranty_text,
                'highlight_text', highlight_text,
                'features', CASE
                    WHEN features IS NULL THEN NULL
                    ELSE to_jsonb(features)
                END
            ))
        )
        WHERE COALESCE(i18n, '{}'::jsonb) = '{}'::jsonb
        """
    )
    op.execute(
        """
        UPDATE product_variants
        SET i18n = jsonb_build_object(
            'vi', jsonb_strip_nulls(jsonb_build_object('name', name))
        )
        WHERE COALESCE(i18n, '{}'::jsonb) = '{}'::jsonb
        """
    )


def downgrade() -> None:
    op.drop_column("product_variants", "i18n")
    op.drop_column("products", "i18n")
    op.drop_column("categories", "i18n")
