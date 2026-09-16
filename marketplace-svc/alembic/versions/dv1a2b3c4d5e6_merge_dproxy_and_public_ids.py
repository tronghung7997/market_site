"""merge: DProxy M2M proxy_allocation.source (dk…) + public identifiers (du…)

feat/dproxy-m2m-purchase forked from dj1a2b3c4d5e6 with dk, while the
public-identifiers chain dm…du grew from the same base; this revision joins
them so the tree has a single head again. Production upgrades with one
``alembic upgrade head`` regardless of which branch it last deployed.

Revision ID: dv1a2b3c4d5e6
Revises: dk1a2b3c4d5e6, du1a2b3c4d5e6
Create Date: 2026-09-16
"""

revision = "dv1a2b3c4d5e6"
down_revision = ("dk1a2b3c4d5e6", "du1a2b3c4d5e6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
