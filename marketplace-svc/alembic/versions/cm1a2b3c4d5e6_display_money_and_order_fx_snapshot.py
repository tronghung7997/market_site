"""display_money_config + orders.display_fx_rate_snapshot

Display-only USD: VND remains ledger currency. Captures the FX rate used
for buyer-facing ≈USD at order creation so history does not drift when
admin changes the live rate.

Revision ID: cm1a2b3c4d5e6
Revises: cl1a2b3c4d5e6
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa

revision = "cm1a2b3c4d5e6"
down_revision = "cl1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "display_money_config",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("display_fx_rate", sa.Integer(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "orders",
        sa.Column("display_fx_rate_snapshot", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("orders", "display_fx_rate_snapshot")
    op.drop_table("display_money_config")
