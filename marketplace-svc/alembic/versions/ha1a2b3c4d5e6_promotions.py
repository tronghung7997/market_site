"""Promo codes: promotions, promotion_redemptions, order snapshot, promo_subsidy

Revision ID: ha1a2b3c4d5e6
Revises: gz1a2b3c4d5e6
Create Date: 2026-09-28

Admin-run campaigns (``promotions``) a buyer applies at checkout. The order
keeps what the buyer paid in ``total_amount`` plus a snapshot of the code and
the discount; the platform pays the seller that discount at settlement as a
``promo_subsidy`` transaction. The new enum value is only added here, never
used, so it may share the transaction.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "ha1a2b3c4d5e6"
down_revision = "gz1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'promo_subsidy'")

    discount_type = postgresql.ENUM("percent", "fixed", name="promotion_discount_type", create_type=False)
    discount_type.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "promotions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("discount_type", discount_type, nullable=False),
        sa.Column("discount_value", sa.Integer(), nullable=False),
        sa.Column("max_discount_amount", sa.Integer(), nullable=True),
        sa.Column("min_order_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("usage_limit", sa.Integer(), nullable=True),
        sa.Column("per_buyer_limit", sa.Integer(), nullable=True, server_default="1"),
        sa.Column("budget_amount", sa.Integer(), nullable=True),
        sa.Column("category_ids", postgresql.ARRAY(sa.Integer()), nullable=False, server_default="{}"),
        sa.Column("new_buyers_only", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "(discount_type = 'percent' AND discount_value BETWEEN 1 AND 100)"
            " OR (discount_type = 'fixed' AND discount_value > 0)",
            name="ck_promotions_discount_value",
        ),
        sa.CheckConstraint("max_discount_amount IS NULL OR max_discount_amount > 0", name="ck_promotions_max_discount"),
        sa.CheckConstraint("min_order_amount >= 0", name="ck_promotions_min_order"),
        sa.CheckConstraint("usage_limit IS NULL OR usage_limit > 0", name="ck_promotions_usage_limit"),
        sa.CheckConstraint("per_buyer_limit IS NULL OR per_buyer_limit > 0", name="ck_promotions_per_buyer_limit"),
        sa.CheckConstraint("budget_amount IS NULL OR budget_amount > 0", name="ck_promotions_budget"),
        sa.CheckConstraint("ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at", name="ck_promotions_window"),
    )

    op.create_table(
        "promotion_redemptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("promotion_id", sa.Integer(), sa.ForeignKey("promotions.id"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=False, unique=True),
        sa.Column("buyer_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("discount_amount", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("discount_amount > 0", name="ck_promotion_redemptions_discount_positive"),
    )
    op.create_index(
        "ix_promotion_redemptions_promotion_buyer", "promotion_redemptions", ["promotion_id", "buyer_id"],
    )

    op.add_column("orders", sa.Column("promo_code", sa.String(32), nullable=True))
    op.add_column("orders", sa.Column("discount_amount", sa.Integer(), nullable=False, server_default="0"))
    op.create_check_constraint("ck_orders_discount_nonnegative", "orders", "discount_amount >= 0")


def downgrade() -> None:
    op.drop_constraint("ck_orders_discount_nonnegative", "orders", type_="check")
    op.drop_column("orders", "discount_amount")
    op.drop_column("orders", "promo_code")
    op.drop_index("ix_promotion_redemptions_promotion_buyer", table_name="promotion_redemptions")
    op.drop_table("promotion_redemptions")
    op.drop_table("promotions")
    postgresql.ENUM(name="promotion_discount_type").drop(op.get_bind(), checkfirst=True)
    # Postgres cannot drop a single enum value; 'promo_subsidy' stays.
