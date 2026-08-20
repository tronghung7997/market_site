"""replace active PayOS rail with SePay Webhooks and VietQR

Revision ID: cu1a2b3c4d5e6
Revises: ct1a2b3c4d5e6
Create Date: 2026-08-19
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "cu1a2b3c4d5e6"
down_revision = "ct1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This is the active bank-rail toggle. Historical provider='payos' intents
    # and their event table remain intact for audit/cutover reconciliation.
    op.alter_column(
        "deposit_rail_config",
        "payos_enabled",
        new_column_name="sepay_enabled",
    )
    op.alter_column(
        "deposit_intents",
        "provider",
        server_default="sepay",
        existing_type=sa.String(length=32),
        existing_nullable=False,
    )

    op.add_column("deposit_intents", sa.Column("payment_code", sa.String(length=40), nullable=True))
    op.add_column("deposit_intents", sa.Column("bank_code", sa.String(length=32), nullable=True))
    op.add_column(
        "deposit_intents",
        sa.Column("bank_account_number", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("bank_account_name", sa.String(length=160), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("sepay_transaction_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("sepay_reference", sa.String(length=128), nullable=True),
    )
    op.create_index(
        "ix_deposit_intents_payment_code",
        "deposit_intents",
        ["payment_code"],
        unique=True,
    )
    op.create_index(
        "ix_deposit_intents_sepay_transaction_id",
        "deposit_intents",
        ["sepay_transaction_id"],
        unique=True,
    )

    op.create_table(
        "sepay_webhook_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("transaction_id", sa.String(length=64), nullable=False),
        sa.Column("payment_code", sa.String(length=40), nullable=True),
        sa.Column("reference", sa.String(length=128), nullable=True),
        sa.Column("account_number", sa.String(length=64), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="webhook"),
        sa.Column("signature_valid", sa.Boolean(), nullable=True),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("transaction_id", name="uq_sepay_events_transaction_id"),
    )
    op.create_index(
        "ix_sepay_webhook_events_payment_code",
        "sepay_webhook_events",
        ["payment_code"],
    )


def downgrade() -> None:
    op.drop_index("ix_sepay_webhook_events_payment_code", table_name="sepay_webhook_events")
    op.drop_table("sepay_webhook_events")
    op.drop_index("ix_deposit_intents_sepay_transaction_id", table_name="deposit_intents")
    op.drop_index("ix_deposit_intents_payment_code", table_name="deposit_intents")
    op.drop_column("deposit_intents", "sepay_reference")
    op.drop_column("deposit_intents", "sepay_transaction_id")
    op.drop_column("deposit_intents", "bank_account_name")
    op.drop_column("deposit_intents", "bank_account_number")
    op.drop_column("deposit_intents", "bank_code")
    op.drop_column("deposit_intents", "payment_code")
    op.alter_column(
        "deposit_intents",
        "provider",
        server_default="payos",
        existing_type=sa.String(length=32),
        existing_nullable=False,
    )
    op.alter_column(
        "deposit_rail_config",
        "sepay_enabled",
        new_column_name="payos_enabled",
    )
