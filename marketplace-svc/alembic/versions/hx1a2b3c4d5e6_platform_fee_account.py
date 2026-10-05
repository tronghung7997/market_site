"""Platform-fee wallet account is an admin setting (fee_runtime_config)

Revision ID: hx1a2b3c4d5e6
Revises: hw1a2b3c4d5e6
Create Date: 2026-10-05
"""
import sqlalchemy as sa
from alembic import op

revision = "hx1a2b3c4d5e6"
down_revision = "hw1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL keeps the historical default (account 1).
    op.add_column(
        "fee_runtime_config",
        sa.Column(
            "platform_account_id", sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="SET NULL", name="fk_fee_runtime_config_platform_account"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint("fk_fee_runtime_config_platform_account", "fee_runtime_config", type_="foreignkey")
    op.drop_column("fee_runtime_config", "platform_account_id")
