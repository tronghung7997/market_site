"""site_pages: admin-editable footer/legal pages (markdown, vi/en)

Seeds the built-in slugs from src.site_pages.defaults so the storefront has
content on first boot. Admin edits afterwards live only in the table; the
seed is also the source for the admin "reset to default" action.

Revision ID: dw1a2b3c4d5e6
Revises: dv1a2b3c4d5e6
Create Date: 2026-09-16
"""
from alembic import op
import sqlalchemy as sa

from src.site_pages.defaults import DEFAULT_PAGES

revision = "dw1a2b3c4d5e6"
down_revision = "dv1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    table = op.create_table(
        "site_pages",
        sa.Column("slug", sa.String(length=64), primary_key=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("show_in_footer", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("title_vi", sa.String(length=160), nullable=False),
        sa.Column("title_en", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("body_vi", sa.Text(), nullable=False),
        sa.Column("body_en", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    op.bulk_insert(
        table,
        [{"slug": slug, "show_in_footer": True, **row} for slug, row in DEFAULT_PAGES.items()],
    )


def downgrade() -> None:
    op.drop_table("site_pages")
