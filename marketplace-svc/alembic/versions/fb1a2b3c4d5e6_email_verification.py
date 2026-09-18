"""Email verification: accounts.email_verified_at, link tokens, auth policy config

Existing accounts are backfilled as verified at their creation time so the
new purchase/deposit/withdraw gate never locks out a current customer.

Revision ID: fb1a2b3c4d5e6
Revises: fa1a2b3c4d5e6
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "fb1a2b3c4d5e6"
down_revision = "fa1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(sa.text("UPDATE accounts SET email_verified_at = created_at WHERE email_verified_at IS NULL"))

    op.create_table(
        "email_verification_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_email_verification_tokens_hash"),
    )
    op.create_index("ix_email_verification_tokens_account_id", "email_verification_tokens", ["account_id"])

    op.create_table(
        "auth_runtime_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("require_email_verification", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("verification_link_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    # Row 1 is seeded lazily from env (EMAIL_VERIFICATION_REQUIRED) by auth.settings.


def downgrade() -> None:
    op.drop_table("auth_runtime_config")
    op.drop_index("ix_email_verification_tokens_account_id", table_name="email_verification_tokens")
    op.drop_table("email_verification_tokens")
    op.drop_column("accounts", "email_verified_at")
