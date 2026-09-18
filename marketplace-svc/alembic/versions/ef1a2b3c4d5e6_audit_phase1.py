"""Audit checklist phase 1: login history, content filter, affiliate config

- ``login_events``: per-attempt login / lock history with client IP + UA.
- ``content_filter_config``: admin-editable off-platform contact filter.
- ``affiliate_runtime_config``: commission as a share of the platform fee,
  attribution and earning windows (seeded from env).
- ``affiliate_commissions.fee_base_amount``: the fee a commission was computed on.
- ``site_pages``: seed the refund and dispute policy pages.

Revision ID: ef1a2b3c4d5e6
Revises: eb1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from src.site_pages.defaults import DEFAULT_PAGES

revision = "ef1a2b3c4d5e6"
down_revision = "eb1a2b3c4d5e6"
branch_labels = None
depends_on = None

_NEW_PAGES = ("refund", "dispute")
_DEFAULT_KEYWORDS = [
    "zalo", "telegram", "tele", "t.me", "whatsapp", "viber", "messenger",
    "facebook.com", "fb.com", "m.me", "skype", "discord", "wechat", "line.me",
]


def upgrade() -> None:
    op.create_table(
        "login_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("outcome", sa.String(length=24), nullable=False),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_login_events_account_created", "login_events", ["account_id", "created_at"])

    content = op.create_table(
        "content_filter_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("action", sa.String(length=8), nullable=False, server_default="block"),
        sa.Column("keywords", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("block_phone_numbers", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("block_links", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("mask_char", sa.String(length=1), nullable=False, server_default="*"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    op.bulk_insert(content, [{"id": 1, "keywords": _DEFAULT_KEYWORDS}])

    op.create_table(
        "affiliate_runtime_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("commission_percent_of_fee", sa.Float(), nullable=False, server_default="20"),
        sa.Column("attribution_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("earning_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_commissions_per_day", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    # Row 1 is seeded lazily from env by the service so a deploy that still
    # relies on DEFAULT_AFFILIATE_COMMISSION_PERCENT keeps its value.

    op.add_column("affiliate_commissions", sa.Column("fee_base_amount", sa.Integer(), nullable=True))

    site_pages = sa.table(
        "site_pages",
        sa.column("slug", sa.String), sa.column("sort_order", sa.Integer),
        sa.column("show_in_footer", sa.Boolean),
        sa.column("title_vi", sa.String), sa.column("title_en", sa.String),
        sa.column("body_vi", sa.Text), sa.column("body_en", sa.Text),
    )
    for slug in _NEW_PAGES:
        op.execute(
            postgresql.insert(site_pages)
            .values(slug=slug, show_in_footer=True, **DEFAULT_PAGES[slug])
            .on_conflict_do_nothing(index_elements=["slug"])
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM site_pages WHERE slug IN ('refund', 'dispute')"))
    op.drop_column("affiliate_commissions", "fee_base_amount")
    op.drop_table("affiliate_runtime_config")
    op.drop_table("content_filter_config")
    op.drop_index("ix_login_events_account_created", table_name="login_events")
    op.drop_table("login_events")
