"""merge heads: backlog 2026-10-07 integration (ki…) with main be7b342

main brought kp… (TopProxy IP changes), ux… (upstream exchange log) and ms…
(``product_variants.manual_stock``, ``orders.stock_held``); the integration
branch ends at ki… (hold floor, withdrawal source, open-ended fee promos).
The two sides touch disjoint tables and columns, so the merge needs no schema
change.

Revision ID: kj1a2b3c4d5e6
Revises: ki1a2b3c4d5e6, ms1a2b3c4d5e6
Create Date: 2026-10-09
"""

revision = "kj1a2b3c4d5e6"
down_revision = ("ki1a2b3c4d5e6", "ms1a2b3c4d5e6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
