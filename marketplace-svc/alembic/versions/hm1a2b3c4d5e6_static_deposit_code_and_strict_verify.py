"""Standing bank deposit code per account; strict email verification flag

Revision ID: hm1a2b3c4d5e6
Revises: gz1a2b3c4d5e6
Create Date: 2026-09-29

- accounts.deposit_code: one reusable SePay payment code per account, so the
  VietQR is static and any amount transferred with it is credited.
- accounts.must_verify_email: true only for sign-ups made under the strict
  flow; existing accounts default to false and keep their current access.
"""
import sqlalchemy as sa
from alembic import op

revision = "hm1a2b3c4d5e6"
down_revision = "gz1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("accounts", sa.Column("deposit_code", sa.String(length=40), nullable=True))
    op.create_unique_constraint("uq_accounts_deposit_code", "accounts", ["deposit_code"])
    op.add_column(
        "accounts",
        sa.Column("must_verify_email", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("accounts", "must_verify_email")
    op.drop_constraint("uq_accounts_deposit_code", "accounts", type_="unique")
    op.drop_column("accounts", "deposit_code")
