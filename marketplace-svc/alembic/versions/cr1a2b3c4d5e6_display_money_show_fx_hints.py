"""display_money_config: show_fx_hints

Admin toggle: when false, buyer UI hides FX rate / VND conversion hints
so a pure-USD experience can avoid revealing the VND ledger.

Revision ID: cr1a2b3c4d5e6
Revises: cq1a2b3c4d5e6
Create Date: 2026-08-14
"""
from alembic import op
import sqlalchemy as sa


revision = "cr1a2b3c4d5e6"
down_revision = "cq1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "display_money_config",
        sa.Column(
            "show_fx_hints",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("display_money_config", "show_fx_hints")
