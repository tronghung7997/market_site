"""Marketplace-wide two-factor switch (ships off) and dormant 2FA policies

Revision ID: ei1a2b3c4d5e6
Revises: eh1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "ei1a2b3c4d5e6"
down_revision = "eh1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "auth_runtime_config",
        sa.Column("mfa_feature_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # The policies only bite once the switch is on; start both off so turning
    # the feature on later is an explicit, separate decision.
    op.alter_column("auth_runtime_config", "require_admin_2fa", server_default=sa.text("false"))
    op.alter_column("auth_runtime_config", "require_2fa_for_withdrawal", server_default=sa.text("false"))
    op.execute(sa.text("UPDATE auth_runtime_config SET require_admin_2fa = false, require_2fa_for_withdrawal = false"))


def downgrade() -> None:
    op.alter_column("auth_runtime_config", "require_admin_2fa", server_default=sa.text("true"))
    op.alter_column("auth_runtime_config", "require_2fa_for_withdrawal", server_default=sa.text("true"))
    op.drop_column("auth_runtime_config", "mfa_feature_enabled")
