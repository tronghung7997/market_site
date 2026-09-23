"""Merge heads: sources/gateway (fv) and resource encryption (fx)

Revision ID: fy1a2b3c4d5e6
Revises: fv1a2b3c4d5e6, fx1a2b3c4d5e6
Create Date: 2026-09-23

feat/igbm-sources-ux (fr…fv) and main's resource encryption (fx) both
branched from fo1a2b3c4d5e6. fx rewrites resources.data; fp…fv touch
supplier, provider, proxy and gateway tables, so the merge has no
operations of its own.
"""

revision = "fy1a2b3c4d5e6"
down_revision = ("fv1a2b3c4d5e6", "fx1a2b3c4d5e6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
