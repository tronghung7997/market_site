"""PayOS deposits + withdraw bank info

Thiết kế: docs/superpowers/specs/2026-07-23-bank-payment-design.md.
- deposit_intents: id chính là orderCode gửi PayOS (map 1-1, không match memo).
- payos_webhook_events: sổ thô immutable, UNIQUE(payment_link_id, reference)
  làm idempotency cho webhook replay.
- withdraw_requests: snapshot thông tin ngân hàng + trạng thái 'paid'.
- transactiontype thêm 'deposit' (tách khỏi 'topup' admin gõ tay).

Revision ID: ae1a2b3c4d5e6
Revises: ad1a2b3c4d5e6
Create Date: 2026-07-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ae1a2b3c4d5e6"
down_revision = "ad1a2b3c4d5e6"
branch_labels = None
depends_on = None

_INTENT_STATUS = sa.Enum("pending", "paid", "cancelled", "expired", name="depositintentstatus")


def upgrade() -> None:
    # Enum mới phải ADD VALUE ngoài transaction dùng nó (xem v1a2b3c4d5e6)
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'deposit'")
    op.execute("ALTER TYPE withdrawstatus ADD VALUE IF NOT EXISTS 'paid'")

    op.create_table(
        "deposit_intents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("status", _INTENT_STATUS, nullable=False, server_default="pending"),
        sa.Column("payment_link_id", sa.String(length=64), nullable=True, unique=True),
        sa.Column("checkout_url", sa.Text(), nullable=True),
        sa.Column("qr_code", sa.Text(), nullable=True),
        sa.Column("paid_amount", sa.Integer(), nullable=True),
        sa.Column("payos_reference", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_deposit_intents_account_status", "deposit_intents", ["account_id", "status"])
    op.create_index("ix_deposit_intents_status_created", "deposit_intents", ["status", "created_at"])

    op.create_table(
        "payos_webhook_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("payment_link_id", sa.String(length=64), nullable=False),
        sa.Column("order_code", sa.BigInteger(), nullable=False),
        sa.Column("reference", sa.String(length=100), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("raw", postgresql.JSONB(), nullable=False),
        sa.Column("signature_valid", sa.Boolean(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("payment_link_id", "reference", name="uq_payos_events_link_reference"),
    )

    op.add_column("withdraw_requests", sa.Column("bank_bin", sa.String(length=20), nullable=True))
    op.add_column("withdraw_requests", sa.Column("bank_name", sa.String(length=100), nullable=True))
    op.add_column("withdraw_requests", sa.Column("bank_account_number", sa.String(length=50), nullable=True))
    op.add_column("withdraw_requests", sa.Column("bank_account_holder", sa.String(length=100), nullable=True))
    op.add_column("withdraw_requests", sa.Column("payout_reference", sa.String(length=100), nullable=True))
    op.add_column("withdraw_requests", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("withdraw_requests", "paid_at")
    op.drop_column("withdraw_requests", "payout_reference")
    op.drop_column("withdraw_requests", "bank_account_holder")
    op.drop_column("withdraw_requests", "bank_account_number")
    op.drop_column("withdraw_requests", "bank_name")
    op.drop_column("withdraw_requests", "bank_bin")
    op.drop_table("payos_webhook_events")
    op.drop_index("ix_deposit_intents_status_created", table_name="deposit_intents")
    op.drop_index("ix_deposit_intents_account_status", table_name="deposit_intents")
    op.drop_table("deposit_intents")
    _INTENT_STATUS.drop(op.get_bind(), checkfirst=True)
    # Enum value 'deposit'/'paid' không drop được trên Postgres — vô hại khi để lại.
