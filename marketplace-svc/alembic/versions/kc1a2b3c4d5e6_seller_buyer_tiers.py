"""Seller & buyer tiers: absolute tier fee, auto-tier state, fee promos,
buyer tiers, cashback.

Revision ID: kc1a2b3c4d5e6
Revises: ie1a2b3c4d5e6
Create Date: 2026-10-07

- ``seller_tier_config.fee_percent`` (absolute %, NULL = platform default)
  replaces ``fee_discount_pp``. Existing rows keep the fee sellers pay today:
  a tier without a discount inherits the platform default (NULL); a tier with
  one gets ``platform_fee_percent − discount`` (never below 0).
- ``seller_tier_state``: manual-tier lock and grace bookkeeping for the daily
  tier job. Every seller already above ``new`` was put there by an admin (the
  job did not exist), so those tiers start locked.
- ``seller_fee_promos``: per-seller fee override with an expiry (0 % offer).
- ``accounts.buyer_tier`` + ``buyer_tier_config`` + ``buyer_tier_events``.
- ``buyer_cashbacks`` and the ``cashback`` / ``cashback_clawback``
  transaction types (only added here, never used in this transaction).
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "kc1a2b3c4d5e6"
down_revision = "ie1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'cashback'")
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'cashback_clawback'")

    # ── seller tier fee: discount points → absolute percent ──────────────────
    op.add_column("seller_tier_config", sa.Column("fee_percent", sa.Float(), nullable=True))
    op.execute(
        """
        UPDATE seller_tier_config t
           SET fee_percent = GREATEST(0, f.platform_fee_percent - t.fee_discount_pp)
          FROM fee_runtime_config f
         WHERE f.id = 1 AND t.fee_discount_pp > 0
        """
    )
    op.drop_column("seller_tier_config", "fee_discount_pp")
    op.create_check_constraint(
        "ck_seller_tier_config_fee_percent", "seller_tier_config",
        "fee_percent IS NULL OR (fee_percent >= 0 AND fee_percent <= 100)",
    )

    # ── automatic seller tiers ───────────────────────────────────────────────
    op.create_table(
        "seller_tier_state",
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("locked_by_id", sa.Integer(), nullable=True),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("at_risk_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("at_risk_keys", postgresql.JSONB(), nullable=True),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.execute(
        """
        INSERT INTO seller_tier_state (account_id, locked, locked_at)
        SELECT id, true, now() FROM accounts WHERE seller_tier <> 'new'
        """
    )

    op.create_table(
        "seller_fee_promos",
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("fee_percent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("badge_tier", sa.String(20), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("granted_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("fee_percent >= 0 AND fee_percent <= 100", name="ck_seller_fee_promos_percent"),
        sa.CheckConstraint("badge_tier IS NULL OR badge_tier IN ('verified', 'trusted')", name="ck_seller_fee_promos_badge"),
    )

    # ── buyer tiers ──────────────────────────────────────────────────────────
    op.add_column("accounts", sa.Column("buyer_tier", sa.String(10), nullable=False, server_default="l1"))
    op.create_check_constraint("ck_accounts_buyer_tier", "accounts", "buyer_tier IN ('l1', 'l2', 'l3')")

    op.create_table(
        "buyer_tier_config",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("settings", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
    )
    op.create_table(
        "buyer_tier_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("old_tier", sa.String(10), nullable=False),
        sa.Column("new_tier", sa.String(10), nullable=False),
        sa.Column("criterion", sa.String(20), nullable=True),
        sa.Column("metric_value", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("old_tier IN ('l1', 'l2', 'l3')", name="ck_buyer_tier_events_old_tier"),
        sa.CheckConstraint("new_tier IN ('l1', 'l2', 'l3')", name="ck_buyer_tier_events_new_tier"),
        sa.CheckConstraint("old_tier != new_tier", name="ck_buyer_tier_events_changed"),
    )
    op.create_index("ix_buyer_tier_events_account", "buyer_tier_events", ["account_id", "created_at"])

    op.create_table(
        "buyer_cashbacks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("buyer_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tier", sa.String(10), nullable=False),
        sa.Column("rate_percent", sa.Float(), nullable=False),
        sa.Column("base_amount", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("clawed_back_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clawback_amount", sa.Integer(), nullable=True),
        sa.CheckConstraint("amount > 0", name="ck_buyer_cashbacks_amount"),
        sa.CheckConstraint("rate_percent > 0 AND rate_percent <= 100", name="ck_buyer_cashbacks_rate"),
    )
    op.create_index("ix_buyer_cashbacks_buyer", "buyer_cashbacks", ["buyer_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_buyer_cashbacks_buyer", table_name="buyer_cashbacks")
    op.drop_table("buyer_cashbacks")
    op.drop_index("ix_buyer_tier_events_account", table_name="buyer_tier_events")
    op.drop_table("buyer_tier_events")
    op.drop_table("buyer_tier_config")
    op.drop_constraint("ck_accounts_buyer_tier", "accounts", type_="check")
    op.drop_column("accounts", "buyer_tier")
    op.drop_table("seller_fee_promos")
    op.drop_table("seller_tier_state")

    op.drop_constraint("ck_seller_tier_config_fee_percent", "seller_tier_config", type_="check")
    op.add_column(
        "seller_tier_config",
        sa.Column("fee_discount_pp", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute(
        """
        UPDATE seller_tier_config t
           SET fee_discount_pp = GREATEST(0, ROUND(f.platform_fee_percent - t.fee_percent))::int
          FROM fee_runtime_config f
         WHERE f.id = 1 AND t.fee_percent IS NOT NULL
        """
    )
    op.drop_column("seller_tier_config", "fee_percent")
    # Postgres cannot drop a single enum value; 'cashback' / 'cashback_clawback' stay.
