"""add partial-refund/replace/extend-warranty dispute resolution types

Admin could previously only fully refund or fully reject a dispute.
Adds 3 more granular resolutions to disputestatus.

Revision ID: n1a2b3c4d5e6
Revises: m1a2b3c4d5e6
Create Date: 2026-07-15
"""
from alembic import op

revision = "n1a2b3c4d5e6"
down_revision = "m1a2b3c4d5e6"
branch_labels = None
depends_on = None

NEW_VALUES = ["resolved_partial_refund", "resolved_replace", "resolved_extend_warranty"]


def upgrade() -> None:
    for value in NEW_VALUES:
        op.execute(f"ALTER TYPE disputestatus ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # Postgres has no DROP VALUE for enums; downgrading would require
    # recreating the type, which is unsafe if rows already use the new
    # values. No-op — matches convention of other additive migrations here.
    pass
