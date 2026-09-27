"""Seller application: onboarding answers from the 3-step wizard

Adds optional columns to ``seller_applications`` (seller type, intended
categories, experience, phone, warranty policy, referral source, the time the
applicant accepted the seller rules). Existing rows keep NULLs. The closed
value sets are enforced with CHECK constraints.

Revision ID: gj1a2b3c4d5e6
Revises: gi1a2b3c4d5e6
Create Date: 2026-09-27
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "gj1a2b3c4d5e6"
down_revision = "gi1a2b3c4d5e6"
branch_labels = None
depends_on = None

SELLER_TYPES = ("individual", "business")
SELLER_EXPERIENCE = ("none", "under_1y", "1_3y", "over_3y")
SELLER_REFERRAL_SOURCES = ("search", "social", "friend", "community", "ads", "other")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IS NULL OR {column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.add_column("seller_applications", sa.Column("seller_type", sa.String(20), nullable=True))
    op.add_column("seller_applications", sa.Column("category_ids", postgresql.JSONB(), nullable=True))
    op.add_column("seller_applications", sa.Column("experience", sa.String(20), nullable=True))
    op.add_column("seller_applications", sa.Column("phone", sa.String(32), nullable=True))
    op.add_column("seller_applications", sa.Column("warranty_policy", sa.String(1000), nullable=True))
    op.add_column("seller_applications", sa.Column("referral_source", sa.String(20), nullable=True))
    op.add_column("seller_applications", sa.Column("rules_accepted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("ck_seller_applications_seller_type", "seller_applications", _in("seller_type", SELLER_TYPES))
    op.create_check_constraint("ck_seller_applications_experience", "seller_applications", _in("experience", SELLER_EXPERIENCE))
    op.create_check_constraint(
        "ck_seller_applications_referral_source", "seller_applications", _in("referral_source", SELLER_REFERRAL_SOURCES),
    )


def downgrade() -> None:
    op.drop_constraint("ck_seller_applications_referral_source", "seller_applications", type_="check")
    op.drop_constraint("ck_seller_applications_experience", "seller_applications", type_="check")
    op.drop_constraint("ck_seller_applications_seller_type", "seller_applications", type_="check")
    for column in ("rules_accepted_at", "referral_source", "warranty_policy", "phone", "experience", "category_ids", "seller_type"):
        op.drop_column("seller_applications", column)
