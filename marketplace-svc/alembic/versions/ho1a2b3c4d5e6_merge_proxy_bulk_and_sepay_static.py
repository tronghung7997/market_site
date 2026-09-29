"""Merge heads: proxy bulk/promotions (hc) and SePay standing QR (hn)

Revision ID: ho1a2b3c4d5e6
Revises: hc1a2b3c4d5e6, hn1a2b3c4d5e6
Create Date: 2026-09-29

feat/proxy-bulk (ha→hb→hc: promotions, proxy allocation lines, dispute
proxy claims) and feat/sepay-static-qr-verify (hm→hn: account deposit
codes, strict email verification, retired SePay numbers, unmatched-transfer
resolution) both branched from gz1a2b3c4d5e6 and touch different columns,
so the merge has no operations of its own.
"""

revision = "ho1a2b3c4d5e6"
down_revision = ("hc1a2b3c4d5e6", "hn1a2b3c4d5e6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
