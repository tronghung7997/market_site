"""affiliate_clicks: visitor_id + ip columns for click dedup

A click is deduplicated per (affiliate, visitor_id) — or per (affiliate, ip)
when the client sends no visitor_id — within a 24h window, so page refreshes
no longer inflate click counts.

Revision ID: k1a2b3c4d5e6
Revises: j1a2b3c4d5e6
Create Date: 2026-07-02
"""
import sqlalchemy as sa
from alembic import op

revision = "k1a2b3c4d5e6"
down_revision = "j1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "affiliate_clicks",
        sa.Column("visitor_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "affiliate_clicks",
        sa.Column("ip", sa.String(length=45), nullable=True),
    )
    op.create_index(
        "ix_affiliate_clicks_visitor_id", "affiliate_clicks", ["visitor_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_affiliate_clicks_visitor_id", table_name="affiliate_clicks")
    op.drop_column("affiliate_clicks", "ip")
    op.drop_column("affiliate_clicks", "visitor_id")
