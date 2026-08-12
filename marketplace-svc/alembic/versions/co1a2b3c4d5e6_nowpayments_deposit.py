"""Multi-provider deposit intents + NOWPayments IPN events

Revision ID: co1a2b3c4d5e6
Revises: cn1a2b3c4d5e6
Create Date: 2026-08-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "co1a2b3c4d5e6"
down_revision = "cn1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "deposit_intents",
        sa.Column("provider", sa.String(length=32), nullable=False, server_default="payos"),
    )
    op.add_column("deposit_intents", sa.Column("pay_currency", sa.String(length=32), nullable=True))
    op.add_column("deposit_intents", sa.Column("now_payment_id", sa.String(length=64), nullable=True))
    op.add_column("deposit_intents", sa.Column("pay_address", sa.Text(), nullable=True))
    op.add_column(
        "deposit_intents",
        sa.Column("pay_amount", sa.Numeric(precision=24, scale=8), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("quoted_usd_amount", sa.Numeric(precision=18, scale=6), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("vnd_per_usd_snapshot", sa.Integer(), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("price_currency", sa.String(length=8), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("paid_crypto_amount", sa.Numeric(precision=24, scale=8), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("outcome_amount", sa.Numeric(precision=24, scale=8), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("outcome_currency", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "deposit_intents",
        sa.Column("external_reference", sa.String(length=128), nullable=True),
    )

    op.create_index("ix_deposit_intents_provider_status", "deposit_intents", ["provider", "status"])
    op.create_index(
        "ix_deposit_intents_now_payment_id",
        "deposit_intents",
        ["now_payment_id"],
        unique=True,
    )

    op.create_table(
        "nowpayments_ipn_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("payment_id", sa.String(length=64), nullable=False),
        sa.Column("payment_status", sa.String(length=32), nullable=False),
        sa.Column("order_id", sa.String(length=64), nullable=True),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("signature_valid", sa.Boolean(), nullable=False),
        sa.Column("raw", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "payment_id",
            "payment_status",
            "payload_hash",
            name="uq_nowpayments_ipn_payment_status_hash",
        ),
    )
    op.create_index(
        "ix_nowpayments_ipn_events_payment_id",
        "nowpayments_ipn_events",
        ["payment_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_nowpayments_ipn_events_payment_id", table_name="nowpayments_ipn_events")
    op.drop_table("nowpayments_ipn_events")
    op.drop_index("ix_deposit_intents_now_payment_id", table_name="deposit_intents")
    op.drop_index("ix_deposit_intents_provider_status", table_name="deposit_intents")
    op.drop_column("deposit_intents", "external_reference")
    op.drop_column("deposit_intents", "outcome_currency")
    op.drop_column("deposit_intents", "outcome_amount")
    op.drop_column("deposit_intents", "paid_crypto_amount")
    op.drop_column("deposit_intents", "price_currency")
    op.drop_column("deposit_intents", "vnd_per_usd_snapshot")
    op.drop_column("deposit_intents", "quoted_usd_amount")
    op.drop_column("deposit_intents", "pay_amount")
    op.drop_column("deposit_intents", "pay_address")
    op.drop_column("deposit_intents", "now_payment_id")
    op.drop_column("deposit_intents", "pay_currency")
    op.drop_column("deposit_intents", "provider")
