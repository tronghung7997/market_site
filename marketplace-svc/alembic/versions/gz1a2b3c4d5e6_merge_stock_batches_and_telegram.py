"""Merge heads: stock batches (gx) and seller Telegram bots (gy)

Revision ID: gz1a2b3c4d5e6
Revises: gx1a2b3c4d5e6, gy1a2b3c4d5e6
Create Date: 2026-09-28

feat/stock-format (gx: stock_batches, resources.batch_id) and
feat/seller-telegram-notify (gy: seller Telegram bot tables) both branched
from gw1a2b3c4d5e6. They touch different tables, so the merge has no
operations of its own.
"""

revision = "gz1a2b3c4d5e6"
down_revision = ("gx1a2b3c4d5e6", "gy1a2b3c4d5e6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
