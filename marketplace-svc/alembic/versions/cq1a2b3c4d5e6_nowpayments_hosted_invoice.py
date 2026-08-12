"""Store NOWPayments hosted invoice identity on deposit intents.

Revision ID: cq1a2b3c4d5e6
Revises: cp1a2b3c4d5e6
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa


revision = "cq1a2b3c4d5e6"
down_revision = "cp1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("deposit_intents", sa.Column("now_invoice_id", sa.String(length=64), nullable=True))
    op.create_index(
        "ix_deposit_intents_now_invoice_id",
        "deposit_intents",
        ["now_invoice_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_deposit_intents_now_invoice_id", table_name="deposit_intents")
    op.drop_column("deposit_intents", "now_invoice_id")
