"""merge: review moderation/auto-review (do…) + product public identifiers (dp…)

Both branches forked from dm1a2b3c4d5e6; this revision joins them so the
tree has a single head again.

Revision ID: dq1a2b3c4d5e6
Revises: do1a2b3c4d5e6, dp1a2b3c4d5e6
Create Date: 2026-09-15
"""

revision = "dq1a2b3c4d5e6"
down_revision = ("do1a2b3c4d5e6", "dp1a2b3c4d5e6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
