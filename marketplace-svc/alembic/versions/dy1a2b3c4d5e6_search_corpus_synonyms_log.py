"""search: widen product corpus (variants, category, description), synonyms, query log

Revision ID: dy1a2b3c4d5e6
Revises: dx1a2b3c4d5e6
Create Date: 2026-09-17

``products.search_text`` used to be a generated column over the product's own
title/highlight, so nothing from other tables could be found: variant ("phân
loại"/"gói") names and the category name. (The seller's shop name is left out
on purpose: a generic shop name would make every product of that shop match
it; sellers have their own result group.) A generated
column cannot read other tables, so it becomes a plain column kept in sync by
triggers on every table that feeds it. The GIN trigram index moves with it.

``search_synonyms`` lets "fb" find "facebook" and "tk" find "tài khoản";
``search_query_log`` records what people searched for and how many products
came back, so zero-result queries can be reviewed.
"""

import sqlalchemy as sa
from alembic import op


revision = "dy1a2b3c4d5e6"
down_revision = "dx1a2b3c4d5e6"
branch_labels = None
depends_on = None


# Own columns first (highest ranking weight for prefix matches), then the
# related text. Every piece is unaccented + lower-cased in one go.
PRODUCT_SEARCH_TEXT_FN = """
CREATE OR REPLACE FUNCTION product_search_text(p products) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT immutable_unaccent(lower(
    coalesce(p.title, '') || ' ' ||
    coalesce(p.i18n->'vi'->>'title', '') || ' ' ||
    coalesce(p.i18n->'en'->>'title', '') || ' ' ||
    coalesce(p.highlight_text, '') || ' ' ||
    coalesce(p.i18n->'vi'->>'highlight_text', '') || ' ' ||
    coalesce(p.i18n->'en'->>'highlight_text', '') || ' ' ||
    coalesce((
      SELECT c.name || ' ' || coalesce(c.i18n->'vi'->>'name', '') || ' ' || coalesce(c.i18n->'en'->>'name', '')
      FROM categories c WHERE c.id = p.category_id
    ), '') || ' ' ||
    coalesce((
      SELECT string_agg(
        v.name || ' ' || coalesce(v.i18n->'vi'->>'name', '') || ' ' || coalesce(v.i18n->'en'->>'name', ''),
        ' ' ORDER BY v.sort_order, v.id
      )
      FROM product_variants v WHERE v.product_id = p.id AND v.is_active
    ), '') || ' ' ||
    coalesce(p.public_key, '') || ' ' ||
    left(coalesce(p.description, ''), 500)
  ))
$$;
"""

PRODUCTS_TRIGGER_FN = """
CREATE OR REPLACE FUNCTION products_search_text_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := product_search_text(NEW);
  RETURN NEW;
END $$;
"""

VARIANTS_TRIGGER_FN = """
CREATE OR REPLACE FUNCTION product_variants_search_text_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products p SET search_text = product_search_text(p)
  WHERE p.id = coalesce(NEW.product_id, OLD.product_id);
  IF TG_OP = 'UPDATE' AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    UPDATE products p SET search_text = product_search_text(p) WHERE p.id = OLD.product_id;
  END IF;
  RETURN NULL;
END $$;
"""

CATEGORIES_TRIGGER_FN = """
CREATE OR REPLACE FUNCTION categories_search_text_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products p SET search_text = product_search_text(p) WHERE p.category_id = NEW.id;
  RETURN NULL;
END $$;
"""

# Restored on downgrade: the dx… generated-column expression.
LEGACY_PRODUCT_SEARCH_TEXT = (
    "immutable_unaccent(lower("
    "coalesce(title, '') || ' ' || "
    "coalesce(i18n->'vi'->>'title', '') || ' ' || "
    "coalesce(i18n->'en'->>'title', '') || ' ' || "
    "coalesce(highlight_text, '') || ' ' || "
    "coalesce(i18n->'vi'->>'highlight_text', '') || ' ' || "
    "coalesce(i18n->'en'->>'highlight_text', '')"
    "))"
)

# Folded (lower, no accents) — the query side folds the same way in Python.
SYNONYM_GROUPS: dict[str, tuple[str, ...]] = {
    "facebook": ("facebook", "fb"),
    "instagram": ("instagram", "ig", "insta"),
    "tiktok": ("tiktok", "tik tok"),
    "youtube": ("youtube", "yt", "ytb"),
    "google": ("google", "gg"),
    "telegram": ("telegram", "tele", "tg"),
    "zalo": ("zalo", "zl"),
    "whatsapp": ("whatsapp", "wa"),
    "tai khoan": ("tai khoan", "tk", "acc", "account", "nick"),
    "business manager": ("business manager", "bm"),
    "socks5": ("socks5", "sock5", "socks"),
    "ipv4": ("ipv4", "ip v4"),
    "ipv6": ("ipv6", "ip v6"),
    "dan cu": ("dan cu", "residential", "resi"),
    "xoay": ("xoay", "rotating", "rotate"),
    "chatgpt": ("chatgpt", "gpt", "openai"),
    "netflix": ("netflix", "nf"),
}


def upgrade() -> None:
    # --- products.search_text: generated column -> trigger-maintained column
    op.drop_index("ix_products_search_text_trgm", table_name="products")
    op.drop_column("products", "search_text")
    op.add_column(
        "products",
        sa.Column("search_text", sa.Text(), nullable=False, server_default=""),
    )
    op.execute(PRODUCT_SEARCH_TEXT_FN)
    op.execute(PRODUCTS_TRIGGER_FN)
    op.execute(VARIANTS_TRIGGER_FN)
    op.execute(CATEGORIES_TRIGGER_FN)
    op.execute(
        "CREATE TRIGGER trg_products_search_text "
        "BEFORE INSERT OR UPDATE OF title, highlight_text, i18n, description, category_id, public_key "
        "ON products FOR EACH ROW EXECUTE FUNCTION products_search_text_sync()"
    )
    op.execute(
        "CREATE TRIGGER trg_product_variants_search_text "
        "AFTER INSERT OR UPDATE OF name, i18n, is_active, product_id, sort_order OR DELETE "
        "ON product_variants FOR EACH ROW EXECUTE FUNCTION product_variants_search_text_sync()"
    )
    op.execute(
        "CREATE TRIGGER trg_categories_search_text "
        "AFTER UPDATE OF name, i18n ON categories "
        "FOR EACH ROW EXECUTE FUNCTION categories_search_text_sync()"
    )
    op.execute("UPDATE products p SET search_text = product_search_text(p)")
    op.create_index(
        "ix_products_search_text_trgm",
        "products",
        ["search_text"],
        postgresql_using="gin",
        postgresql_ops={"search_text": "gin_trgm_ops"},
    )

    # --- synonyms
    op.create_table(
        "search_synonyms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("group_key", sa.String(80), nullable=False),
        sa.Column("term", sa.String(80), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_search_synonyms_group_key", "search_synonyms", ["group_key"])
    op.bulk_insert(
        sa.table(
            "search_synonyms",
            sa.column("group_key", sa.String),
            sa.column("term", sa.String),
        ),
        [
            {"group_key": group, "term": term}
            for group, terms in SYNONYM_GROUPS.items()
            for term in terms
        ],
    )

    # --- query log
    op.create_table(
        "search_query_log",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("query", sa.String(80), nullable=False),
        sa.Column("locale", sa.String(8), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("result_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_search_query_log_created_at", "search_query_log", ["created_at"])


def downgrade() -> None:
    op.drop_table("search_query_log")
    op.drop_table("search_synonyms")

    op.execute("DROP TRIGGER IF EXISTS trg_categories_search_text ON categories")
    op.execute("DROP TRIGGER IF EXISTS trg_product_variants_search_text ON product_variants")
    op.execute("DROP TRIGGER IF EXISTS trg_products_search_text ON products")
    op.execute("DROP FUNCTION IF EXISTS categories_search_text_sync()")
    op.execute("DROP FUNCTION IF EXISTS product_variants_search_text_sync()")
    op.execute("DROP FUNCTION IF EXISTS products_search_text_sync()")
    op.execute("DROP FUNCTION IF EXISTS product_search_text(products)")

    op.drop_index("ix_products_search_text_trgm", table_name="products")
    op.drop_column("products", "search_text")
    op.add_column(
        "products",
        sa.Column("search_text", sa.Text(), sa.Computed(LEGACY_PRODUCT_SEARCH_TEXT, persisted=True), nullable=False),
    )
    op.create_index(
        "ix_products_search_text_trgm",
        "products",
        ["search_text"],
        postgresql_using="gin",
        postgresql_ops={"search_text": "gin_trgm_ops"},
    )
