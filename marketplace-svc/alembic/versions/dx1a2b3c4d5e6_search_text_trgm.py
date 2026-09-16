"""global search: unaccent + pg_trgm, generated search_text columns, GIN indexes

Revision ID: dx1a2b3c4d5e6
Revises: dw1a2b3c4d5e6
Create Date: 2026-09-16

Storefront search must be diacritic-insensitive ("tai khoan" finds
"Tài khoản"), typo-tolerant and index-backed. Both extensions are
"trusted" in PostgreSQL 13+, so the database owner can install them
without superuser rights.

``immutable_unaccent`` wraps ``unaccent`` (which is only STABLE because the
dictionary could change) so it can be used in generated columns and
expression indexes. The query side calls the same function on the user
input, so the stored text and the needle are normalised identically.
"""

import sqlalchemy as sa
from alembic import op


revision = "dx1a2b3c4d5e6"
down_revision = "dw1a2b3c4d5e6"
branch_labels = None
depends_on = None


PRODUCT_SEARCH_TEXT = (
    "immutable_unaccent(lower("
    "coalesce(title, '') || ' ' || "
    "coalesce(i18n->'vi'->>'title', '') || ' ' || "
    "coalesce(i18n->'en'->>'title', '') || ' ' || "
    "coalesce(highlight_text, '') || ' ' || "
    "coalesce(i18n->'vi'->>'highlight_text', '') || ' ' || "
    "coalesce(i18n->'en'->>'highlight_text', '')"
    "))"
)

CATEGORY_SEARCH_TEXT = (
    "immutable_unaccent(lower("
    "coalesce(name, '') || ' ' || "
    "coalesce(i18n->'vi'->>'name', '') || ' ' || "
    "coalesce(i18n->'en'->>'name', '') || ' ' || "
    "coalesce(slug, '')"
    "))"
)

SELLER_NAME_EXPR = "immutable_unaccent(lower(business_name))"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute(
        "CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text "
        "LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS "
        "$$ SELECT public.unaccent('public.unaccent', $1) $$"
    )

    op.add_column(
        "products",
        sa.Column("search_text", sa.Text(), sa.Computed(PRODUCT_SEARCH_TEXT, persisted=True), nullable=False),
    )
    op.create_index(
        "ix_products_search_text_trgm",
        "products",
        ["search_text"],
        postgresql_using="gin",
        postgresql_ops={"search_text": "gin_trgm_ops"},
    )

    op.add_column(
        "categories",
        sa.Column("search_text", sa.Text(), sa.Computed(CATEGORY_SEARCH_TEXT, persisted=True), nullable=False),
    )
    op.create_index(
        "ix_categories_search_text_trgm",
        "categories",
        ["search_text"],
        postgresql_using="gin",
        postgresql_ops={"search_text": "gin_trgm_ops"},
    )

    op.execute(
        "CREATE INDEX ix_seller_applications_business_name_trgm "
        "ON seller_applications USING gin "
        f"(({SELLER_NAME_EXPR}) gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_seller_applications_business_name_trgm")
    op.drop_index("ix_categories_search_text_trgm", table_name="categories")
    op.drop_column("categories", "search_text")
    op.drop_index("ix_products_search_text_trgm", table_name="products")
    op.drop_column("products", "search_text")
    op.execute("DROP FUNCTION IF EXISTS immutable_unaccent(text)")
    # Extensions stay installed: other objects may depend on them and
    # dropping them is an operator decision, not a schema rollback.
