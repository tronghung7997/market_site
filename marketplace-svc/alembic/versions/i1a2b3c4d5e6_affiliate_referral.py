"""affiliate/referral schema: account codes, commission rates, click/commission tables

Adds:
- accounts.affiliate_code (NOT NULL, unique, indexed) — backfilled for existing rows
- accounts.referred_by_id (nullable FK -> accounts.id)
- categories.commission_rate (nullable Float)
- products.commission_rate (nullable Float)
- 'affiliate_commission' value to the transactiontype enum
- affiliate_clicks table
- affiliate_commissions table

Revision ID: i1a2b3c4d5e6
Revises: h1c2d3e4f5g6
Create Date: 2026-07-01
"""
import secrets
import string

import sqlalchemy as sa
from alembic import op

revision = "i1a2b3c4d5e6"
down_revision = "h1c2d3e4f5g6"
branch_labels = None
depends_on = None

_ALPHABET = string.ascii_uppercase + string.digits


def _gen_code(bind, existing: set[str]) -> str:
    for _ in range(5):
        code = "".join(secrets.choice(_ALPHABET) for _ in range(8))
        if code not in existing:
            existing.add(code)
            return code
    raise RuntimeError("could not generate a unique affiliate_code after 5 attempts")


def upgrade() -> None:
    # 'affiliate_commission' value added to the transactiontype enum.
    # Postgres forbids ALTER TYPE ... ADD VALUE inside a transaction block;
    # run it in an autocommit block so the statement uses AUTOCOMMIT isolation.
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE transactiontype ADD VALUE IF NOT EXISTS 'affiliate_commission'"
        )

    # accounts.affiliate_code: add nullable first, backfill, then enforce NOT NULL + unique.
    # A server_default generates a fallback code for direct DB inserts that bypass
    # the application's register() flow (e.g. test fixtures); register() in Task 2
    # sets the code explicitly and overrides this default.
    op.add_column(
        "accounts",
        sa.Column(
            "affiliate_code",
            sa.String(length=8),
            nullable=True,
            server_default=sa.text(
                "upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8))"
            ),
        ),
    )
    op.add_column(
        "accounts",
        sa.Column("referred_by_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "accounts_referred_by_id_fkey", "accounts", "accounts", ["referred_by_id"], ["id"]
    )

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id FROM accounts ORDER BY id")).fetchall()
    existing: set[str] = set()
    for (account_id,) in rows:
        code = _gen_code(bind, existing)
        bind.execute(
            sa.text("UPDATE accounts SET affiliate_code = :code WHERE id = :id"),
            {"code": code, "id": account_id},
        )

    op.alter_column(
        "accounts", "affiliate_code", existing_type=sa.String(length=8), nullable=False
    )
    op.create_index(
        "ix_accounts_affiliate_code", "accounts", ["affiliate_code"], unique=True
    )

    op.add_column(
        "categories",
        sa.Column("commission_rate", sa.Float(), nullable=True),
    )
    op.add_column(
        "products",
        sa.Column("commission_rate", sa.Float(), nullable=True),
    )

    op.create_table(
        "affiliate_clicks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "affiliate_account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id"),
            nullable=False,
        ),
        sa.Column("path", sa.String(length=500), nullable=True),
        sa.Column("referrer", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_affiliate_clicks_affiliate_account_id",
        "affiliate_clicks",
        ["affiliate_account_id"],
    )

    op.create_table(
        "affiliate_commissions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("orders.id"),
            unique=True,
            nullable=False,
        ),
        sa.Column(
            "affiliate_account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id"),
            nullable=False,
        ),
        sa.Column(
            "buyer_account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id"),
            nullable=False,
        ),
        sa.Column("rate_percent", sa.Float(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_affiliate_commissions_affiliate_account_id",
        "affiliate_commissions",
        ["affiliate_account_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_affiliate_commissions_affiliate_account_id", table_name="affiliate_commissions"
    )
    op.drop_table("affiliate_commissions")
    op.drop_index(
        "ix_affiliate_clicks_affiliate_account_id", table_name="affiliate_clicks"
    )
    op.drop_table("affiliate_clicks")

    op.drop_column("products", "commission_rate")
    op.drop_column("categories", "commission_rate")

    op.drop_index("ix_accounts_affiliate_code", table_name="accounts")
    op.drop_constraint("accounts_referred_by_id_fkey", "accounts", type_="foreignkey")
    op.alter_column(
        "accounts", "affiliate_code", existing_type=sa.String(length=8), nullable=True
    )
    op.drop_column("accounts", "referred_by_id")
    op.drop_column("accounts", "affiliate_code")

    # Postgres does not support removing a value from an enum once added.
    # The 'affiliate_commission' value added to transactiontype in upgrade()
    # cannot be cleanly dropped without recreating the type and rewriting
    # every dependent column — left intentionally unchanged on downgrade.
