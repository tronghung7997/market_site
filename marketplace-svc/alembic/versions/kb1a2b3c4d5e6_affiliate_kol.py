"""affiliate / KOL: per-account terms, KOL-linked promo codes, attribution time

Revision ID: kb1a2b3c4d5e6
Revises: ie1a2b3c4d5e6
Create Date: 2026-10-07

- ``affiliate_account_overrides``: an admin-set commission % of the platform
  fee and/or earning window for one referrer (a KOL deal such as 20 %
  lifetime). NULL in a column = follow the programme default.
- ``promotions.affiliate_account_id``: the referrer a campaign belongs to.
  ``promotion_redemptions.affiliate_account_id`` snapshots it per order, so
  re-assigning a campaign later never moves commission of orders already
  placed.
- ``accounts.referred_at``: when the account was attributed to its referrer
  (sign-up through a ref link, or the first order with a KOL code). The
  earning window runs from here. Backfilled from ``created_at``.
- ``accounts.referred_via_promotion_id``: set when the attribution came from a
  KOL code instead of a ref link.
"""
from alembic import op
import sqlalchemy as sa

revision = "kb1a2b3c4d5e6"
down_revision = "ie1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "affiliate_account_overrides",
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("commission_percent_of_fee", sa.Float(), nullable=True),
        sa.Column("earning_days", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "commission_percent_of_fee IS NULL OR (commission_percent_of_fee >= 0 AND commission_percent_of_fee <= 100)",
            name="ck_affiliate_account_overrides_percent",
        ),
        sa.CheckConstraint(
            "earning_days IS NULL OR (earning_days >= 0 AND earning_days <= 3650)",
            name="ck_affiliate_account_overrides_earning_days",
        ),
    )

    op.add_column("promotions", sa.Column("affiliate_account_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_promotions_affiliate_account", "promotions", "accounts", ["affiliate_account_id"], ["id"],
    )
    op.create_index("ix_promotions_affiliate_account_id", "promotions", ["affiliate_account_id"])

    op.add_column("promotion_redemptions", sa.Column("affiliate_account_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_promotion_redemptions_affiliate_account", "promotion_redemptions", "accounts",
        ["affiliate_account_id"], ["id"],
    )
    op.create_index(
        "ix_promotion_redemptions_affiliate_account_id", "promotion_redemptions", ["affiliate_account_id"],
        postgresql_where=sa.text("affiliate_account_id IS NOT NULL"),
    )

    op.add_column("accounts", sa.Column("referred_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("accounts", sa.Column("referred_via_promotion_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_accounts_referred_via_promotion", "accounts", "promotions", ["referred_via_promotion_id"], ["id"],
    )
    op.execute("UPDATE accounts SET referred_at = created_at WHERE referred_by_id IS NOT NULL")


def downgrade() -> None:
    op.drop_constraint("fk_accounts_referred_via_promotion", "accounts", type_="foreignkey")
    op.drop_column("accounts", "referred_via_promotion_id")
    op.drop_column("accounts", "referred_at")
    op.drop_index("ix_promotion_redemptions_affiliate_account_id", table_name="promotion_redemptions")
    op.drop_constraint("fk_promotion_redemptions_affiliate_account", "promotion_redemptions", type_="foreignkey")
    op.drop_column("promotion_redemptions", "affiliate_account_id")
    op.drop_index("ix_promotions_affiliate_account_id", table_name="promotions")
    op.drop_constraint("fk_promotions_affiliate_account", "promotions", type_="foreignkey")
    op.drop_column("promotions", "affiliate_account_id")
    op.drop_table("affiliate_account_overrides")
