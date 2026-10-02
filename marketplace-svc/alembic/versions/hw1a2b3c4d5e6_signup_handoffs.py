"""Sign-up handoff: confirming the email signs in the browser that signed up

Revision ID: hw1a2b3c4d5e6
Revises: hv1a2b3c4d5e6
Create Date: 2026-10-02
"""
import sqlalchemy as sa
from alembic import op

revision = "hw1a2b3c4d5e6"
down_revision = "hv1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "signup_handoffs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("secret_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_signup_handoffs_account_id", "signup_handoffs", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_signup_handoffs_account_id", table_name="signup_handoffs")
    op.drop_table("signup_handoffs")
