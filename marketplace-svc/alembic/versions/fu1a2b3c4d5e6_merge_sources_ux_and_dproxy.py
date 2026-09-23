"""Merge heads: sources UX (fr) and DProxy internal seller (ft)

Revision ID: fu1a2b3c4d5e6
Revises: fr1a2b3c4d5e6, ft1a2b3c4d5e6
Create Date: 2026-09-23

feat/igbm-sources-ux and feat/dproxy-internal-seller both branched from
fo1a2b3c4d5e6. Their schema changes touch different tables, so the merge
has no operations of its own.
"""

revision = "fu1a2b3c4d5e6"
down_revision = ("fr1a2b3c4d5e6", "ft1a2b3c4d5e6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
