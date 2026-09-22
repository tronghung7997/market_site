"""Email verification no longer gates buying, deposits and withdrawals

Revision ID: fo1a2b3c4d5e6
Revises: fn1a2b3c4d5e6
Create Date: 2026-09-22

Product decision: an unverified mailbox may still trade. The policy row
seeded ``require_email_verification = true`` on existing deployments, so
flip it here; admins can turn it back on at Cài đặt › Tài khoản.
"""
from alembic import op

revision = "fo1a2b3c4d5e6"
down_revision = "fn1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE auth_runtime_config SET require_email_verification = false")


def downgrade() -> None:
    # Restore the previous default; the original per-deployment value is not kept.
    op.execute("UPDATE auth_runtime_config SET require_email_verification = true")
