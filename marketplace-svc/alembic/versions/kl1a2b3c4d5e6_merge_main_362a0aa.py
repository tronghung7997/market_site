"""merge heads: backlog 2026-10-07 (kj…) with main 362a0aa (tk… takedown)

main brought tk… (``takedown_requests`` / ``takedown_events``); the backlog
side ends at kj…. The two sides touch disjoint tables, so the merge needs no
schema change.

Revision ID: kl1a2b3c4d5e6
Revises: kj1a2b3c4d5e6, tk1a2b3c4d5e6
Create Date: 2026-10-09
"""

revision = "kl1a2b3c4d5e6"
down_revision = ("kj1a2b3c4d5e6", "tk1a2b3c4d5e6")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
