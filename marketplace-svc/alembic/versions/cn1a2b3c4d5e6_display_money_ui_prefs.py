"""display_money_config: default currency + switcher flags

Admin-managed UI prefs:
- display_currency_default (USD|VND)
- allow_user_toggle (currency switcher)
- allow_locale_toggle (language switcher)

Revision ID: cn1a2b3c4d5e6
Revises: cm1a2b3c4d5e6
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa

revision = "cn1a2b3c4d5e6"
down_revision = "cm1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "display_money_config",
        sa.Column(
            "display_currency_default",
            sa.String(length=3),
            nullable=False,
            server_default="USD",
        ),
    )
    op.add_column(
        "display_money_config",
        sa.Column(
            "allow_user_toggle",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "display_money_config",
        sa.Column(
            "allow_locale_toggle",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("display_money_config", "allow_locale_toggle")
    op.drop_column("display_money_config", "allow_user_toggle")
    op.drop_column("display_money_config", "display_currency_default")
