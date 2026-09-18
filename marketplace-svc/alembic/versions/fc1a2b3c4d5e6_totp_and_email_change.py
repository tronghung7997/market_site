"""TOTP two-factor, email change links, admin/withdrawal 2FA policy, Turnstile key

Revision ID: fc1a2b3c4d5e6
Revises: fb1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "fc1a2b3c4d5e6"
down_revision = "fb1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("totp_secret", sa.Text(), nullable=True))
    op.add_column("accounts", sa.Column("totp_enabled_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("accounts", sa.Column("totp_backup_hashes", postgresql.JSONB(), nullable=True))
    op.add_column("email_verification_tokens", sa.Column("new_email", sa.String(length=255), nullable=True))
    op.add_column("auth_runtime_config", sa.Column("require_admin_2fa", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("auth_runtime_config", sa.Column("require_2fa_for_withdrawal", sa.Boolean(), nullable=False, server_default=sa.text("true")))
    op.add_column("auth_runtime_config", sa.Column("turnstile_site_key", sa.String(length=128), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("auth_runtime_config", "turnstile_site_key")
    op.drop_column("auth_runtime_config", "require_2fa_for_withdrawal")
    op.drop_column("auth_runtime_config", "require_admin_2fa")
    op.drop_column("email_verification_tokens", "new_email")
    op.drop_column("accounts", "totp_backup_hashes")
    op.drop_column("accounts", "totp_enabled_at")
    op.drop_column("accounts", "totp_secret")
